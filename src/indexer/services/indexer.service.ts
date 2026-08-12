import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import type { Env } from '@/config/env';
import { apiError } from '@/common/api-error';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import { CounterService } from '@/common/metrics/counter.service';
import {
  COUNTER_INDEXER_ERRORS,
  COUNTER_INDEXER_RATE_LIMITED,
  COUNTER_INDEXER_REQUESTS,
} from '@/common/metrics/service-counter.entity';
import { CIRCUIT_BREAKER_CONFIG } from '@/indexer/constants/circuit-breaker.constants';
import type {
  ITransfer,
  ITransferQuery,
  IBalance,
  ITokenBalanceQuery,
} from '@/indexer/interfaces/indexer.interface';

/** Server-side cap: `body must NOT have more than 10 items`. */
const MAX_BATCH_QUERIES = 10;

const transferSchema = z.object({
  blockchain: z.string(),
  blockNumber: z.number().int().nonnegative(),
  transactionHash: z.string(),
  transferIndex: z.number().int().nonnegative(),
  token: z.string(),
  amount: z.string(),
  timestamp: z.number().int().nonnegative(),
  transactionIndex: z.number().int().nonnegative(),
  logIndex: z.number().int().nonnegative().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  label: z.string().optional(),
  metadata: z.unknown().nullable().optional(),
});

const transfersSchema = z.object({ transfers: z.array(transferSchema) });
// A batch entry for a pair the indexer cannot serve comes back without
// `transfers`. One such entry must not throw away the nine good ones next to
// it, so the entry is kept as-is here and sorted out by the caller.
const batchSchema = z.array(z.unknown());

const balanceSchema = z.object({
  blockchain: z.string(),
  token: z.string(),
  address: z.string().optional(),
  amount: z.string(),
  decimals: z.number().int().nonnegative().optional(),
  lastUpdated: z.number().int().nonnegative().optional(),
});
const balanceResponseSchema = z.object({ tokenBalance: balanceSchema });

function assertQuery(query: ITransferQuery): ITransferQuery {
  if (!Number.isInteger(query.limit) || query.limit <= 0) {
    throw new Error(
      `Indexer query limit must be a positive integer, got: ${query.limit}`,
    );
  }
  return query;
}

@Injectable()
export class IndexerService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxRetries = 3;
  private breaker: CircuitBreaker;
  private readonly logger = new Logger(IndexerService.name);
  private readonly warnedPairs = new Set<string>();

  constructor(
    private readonly http: HttpService,
    configService: ConfigService<Env, true>,
    @Optional() private readonly counters?: CounterService,
  ) {
    this.baseUrl = configService.get('INDEXER_BASE_URL').replace(/\/$/, '');
    this.apiKey = configService.get('INDEXER_API_KEY');

    this.breaker = new CircuitBreaker(this.doRequest.bind(this), {
      ...CIRCUIT_BREAKER_CONFIG,
      errorFilter: (err: unknown) => !this.isRetryableError(err),
    });
  }

  /** One address. Prefer `batchTokenTransfers` whenever more than one is due. */
  async tokenTransfers(
    query: ITransferQuery,
  ): Promise<{ transfers: ITransfer[] }> {
    const { blockchain, token, address, limit, fromTs, toTs } =
      assertQuery(query);
    const params = new URLSearchParams({ limit: String(limit) });
    if (fromTs !== undefined) params.append('fromTs', String(fromTs));
    if (toTs !== undefined) params.append('toTs', String(toTs));
    const encodedPath = [blockchain, token, address]
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const body = await this.request(
      'GET',
      `/${encodedPath}/token-transfers?${params}`,
    );
    return transfersSchema.parse(body);
  }

  async batchTokenTransfers(queries: ITransferQuery[]): Promise<ITransfer[][]> {
    if (queries.length === 0) return [];
    if (queries.length === 1) {
      const result = await this.tokenTransfers(queries[0]);
      return [result.transfers];
    }
    queries.forEach(assertQuery);

    const out: ITransfer[][] = [];
    // The indexer rejects a batch of more than MAX_BATCH_QUERIES items, so a
    // deployment with more wallets than that would never poll at all.
    for (let i = 0; i < queries.length; i += MAX_BATCH_QUERIES) {
      const chunk = queries.slice(i, i + MAX_BATCH_QUERIES);
      const body = await this.request('POST', '/batch/token-transfers', chunk);
      const parsed = batchSchema.parse(body);
      if (parsed.length !== chunk.length) {
        throw new Error(
          `Batch response has ${parsed.length} entries for ${chunk.length} queries`,
        );
      }
      out.push(...parsed.map((entry, j) => this.transfersOf(entry, chunk[j])));
    }
    return out;
  }

  /** An entry the indexer could not serve yields no transfers, not an outage. */
  private transfersOf(entry: unknown, query: ITransferQuery): ITransfer[] {
    const parsed = transfersSchema.safeParse(entry);
    if (parsed.success) return parsed.data.transfers;

    const key = `${query.blockchain}/${query.token}`;
    if (!this.warnedPairs.has(key)) {
      this.warnedPairs.add(key);
      this.logger.warn(
        `Batch entry for ${key} carries no transfers: ${JSON.stringify(entry)}`,
      );
    }
    return [];
  }

  async tokenBalance(
    query: ITokenBalanceQuery,
  ): Promise<{ tokenBalance: IBalance }> {
    const { blockchain, token, address } = query;
    const encodedPath = [blockchain, token, address]
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const body = await this.request('GET', `/${encodedPath}/token-balances`);
    return balanceResponseSchema.parse(body);
  }

  getBreakerState(): 'closed' | 'open' | 'half-open' {
    if (this.breaker.opened) return 'open';
    if (this.breaker.halfOpen) return 'half-open';
    return 'closed';
  }

  private request<IResponse>(
    method: 'GET' | 'POST',
    path: string,
    data?: unknown,
  ): Promise<IResponse> {
    return this.breaker.fire(method, path, data) as Promise<IResponse>;
  }

  private async doRequest<IResponse>(
    method: 'GET' | 'POST',
    path: string,
    data?: unknown,
  ): Promise<IResponse> {
    this.counters?.increment(COUNTER_INDEXER_REQUESTS);

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await firstValueFrom(
          this.http.request({
            method,
            url: `${this.baseUrl}${path}`,
            data,
            headers: { 'x-api-key': this.apiKey },
            timeout: 15_000,
          }),
        );
        return response.data as IResponse;
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response
          ?.status;
        const errorBody = (err as { response?: { data?: unknown } }).response
          ?.data;

        // 429: rate limited, retry with backoff
        if (status === 429) {
          this.counters?.increment(COUNTER_INDEXER_RATE_LIMITED);
          if (attempt < this.maxRetries) {
            const retryAfterSec = this.parseRetryAfter(err);
            const delayMs = retryAfterSec
              ? retryAfterSec * 1000
              : this.exponentialBackoffMs(attempt);
            await this.sleep(delayMs);
            continue;
          }
          this.counters?.increment(COUNTER_INDEXER_ERRORS);
          throw new HttpException(
            apiError(
              EErrorCodes.INDEXER_RATE_LIMITED,
              'Indexer rate limit exceeded after retries',
            ),
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }

        // 5xx: server error, retry with backoff
        if (status && status >= 500 && status < 600) {
          if (attempt < this.maxRetries) {
            const delayMs = this.exponentialBackoffMs(attempt);
            await this.sleep(delayMs);
            continue;
          }
          this.counters?.increment(COUNTER_INDEXER_ERRORS);
          throw new HttpException(
            apiError(
              EErrorCodes.INDEXER_UNAVAILABLE,
              'Indexer unavailable after retries',
              { status, details: errorBody },
            ),
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }

        // 4xx (not 429): client error, fail immediately
        if (status && status >= 400 && status < 500) {
          this.counters?.increment(COUNTER_INDEXER_ERRORS);
          throw new HttpException(
            apiError(
              EErrorCodes.INDEXER_REQUEST_FAILED,
              'Indexer request failed',
              { status, details: errorBody },
            ),
            HttpStatus.BAD_REQUEST,
          );
        }

        // Other error, fail immediately
        this.counters?.increment(COUNTER_INDEXER_ERRORS);
        throw new HttpException(
          apiError(
            EErrorCodes.INDEXER_REQUEST_FAILED,
            'Indexer request failed',
            { details: errorBody },
          ),
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    throw new HttpException(
      apiError(
        EErrorCodes.INDEXER_REQUEST_FAILED,
        'Indexer request failed after retries',
      ),
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private isRetryableError(err: unknown): boolean {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (!status) return true; // Network error, counts against breaker
    if (status === 429) return true; // Rate limit, counts against breaker
    if (status >= 500) return true; // Server error, counts against breaker
    return false; // 4xx (not 429) does not count against breaker
  }

  private parseRetryAfter(err: unknown): number | null {
    const retryAfterHeader = (
      err as { response?: { headers?: Record<string, string> } }
    ).response?.headers?.['retry-after'];
    if (!retryAfterHeader) return null;
    const parsed = parseInt(retryAfterHeader, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private exponentialBackoffMs(attempt: number): number {
    const baseMs = 100;
    const maxMs = 10_000;
    const delayMs = baseMs * Math.pow(2, attempt - 1);
    const jitterMs = Math.random() * delayMs;
    return Math.min(delayMs + jitterMs, maxMs);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
