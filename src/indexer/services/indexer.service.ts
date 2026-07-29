import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import type { Env } from '@/config/env';

const transferSchema = z.object({
  blockchain: z.string(),
  blockNumber: z.number().int().nonnegative(),
  transactionHash: z.string(),
  transferIndex: z.number().int().nonnegative(),
  token: z.string(),
  amount: z.string(),
  timestamp: z.number().int(),
  transactionIndex: z.number().int().nonnegative(),
  logIndex: z.number().int().nonnegative().nullable(),
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  metadata: z.unknown().nullable().optional(),
});

const transfersSchema = z.object({ transfers: z.array(transferSchema) });
const batchSchema = z.array(transfersSchema);

export type ITransfer = z.infer<typeof transferSchema>;

export interface ITransferQuery {
  blockchain: string;
  token: string;
  address: string;
  limit: number;
}

function assertQuery(query: ITransferQuery): ITransferQuery {
  if (!Number.isInteger(query.limit) || query.limit <= 0) {
    throw new Error(
      `Indexer query limit must be a positive integer, got: ${query.limit}`,
    );
  }
  return query;
}

const MIN_REQUEST_GAP_MS = 1_250;

@Injectable()
export class IndexerService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly http: HttpService,
    configService: ConfigService<Env, true>,
  ) {
    this.baseUrl = configService.get('INDEXER_BASE_URL').replace(/\/$/, '');
    this.apiKey = configService.get('INDEXER_API_KEY');
  }

  /** One address. Prefer `batchTokenTransfers` whenever more than one is due. */
  async tokenTransfers(query: ITransferQuery): Promise<ITransfer[]> {
    const { blockchain, token, address, limit } = assertQuery(query);
    const body = await this.request(
      'GET',
      `/${blockchain}/${token}/${address}/token-transfers?limit=${limit}`,
    );
    return transfersSchema.parse(body).transfers;
  }

  async batchTokenTransfers(queries: ITransferQuery[]): Promise<ITransfer[][]> {
    if (queries.length === 0) return [];
    if (queries.length === 1) return [await this.tokenTransfers(queries[0])];
    queries.forEach(assertQuery);

    const body = await this.request('POST', '/batch/token-transfers', queries);
    const parsed = batchSchema.parse(body);
    if (parsed.length !== queries.length) {
      throw new Error(
        `Batch response has ${parsed.length} entries for ${queries.length} queries`,
      );
    }
    return parsed.map((entry) => entry.transfers);
  }

  private request(
    method: 'GET' | 'POST',
    path: string,
    data?: unknown,
  ): Promise<unknown> {
    // Serialise through one queue so concurrent callers cannot burst the budget.
    const result = this.queue.then(async () => {
      const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();

      const response = await firstValueFrom(
        this.http.request({
          method,
          url: `${this.baseUrl}${path}`,
          data,
          headers: { 'x-api-key': this.apiKey },
          timeout: 15_000,
        }),
      );
      return response.data;
    });

    // Keep the chain alive even when one request rejects.
    this.queue = result.catch(() => undefined);
    return result;
  }
}
