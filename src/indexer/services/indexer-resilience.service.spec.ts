/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpService } from '@nestjs/axios';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { of, throwError } from 'rxjs';

import { CounterService } from '@/common/metrics/counter.service';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import { IndexerService } from '@/indexer/services/indexer.service';

const QUERY = {
  blockchain: 'sepolia',
  token: 'usdt',
  address: '0xabc',
  limit: 10,
};

const httpError = (
  status?: number,
  data?: unknown,
  headers?: Record<string, string>,
) => ({ response: status ? { status, data, headers } : undefined });

async function build(
  behaviours: (unknown | { ok: unknown })[],
  options: { counters?: boolean } = {},
) {
  let call = 0;
  const request = jest.fn(() => {
    const behaviour = behaviours[Math.min(call++, behaviours.length - 1)];
    if (behaviour && typeof behaviour === 'object' && 'ok' in behaviour) {
      return of({ data: (behaviour as { ok: unknown }).ok });
    }
    return throwError(() => behaviour);
  });

  const counters = { increment: jest.fn() };
  const providers: any[] = [
    IndexerService,
    { provide: HttpService, useValue: { request } },
    {
      provide: ConfigService,
      useValue: {
        get: (key: string) =>
          key === 'INDEXER_BASE_URL' ? 'https://indexer.test/api' : 'test-key',
      },
    },
  ];
  if (options.counters !== false) {
    providers.push({ provide: CounterService, useValue: counters });
  }

  const ref = await Test.createTestingModule({ providers }).compile();
  return { service: ref.get(IndexerService), request, counters };
}

// Retries sleep with exponential backoff; fake timers would deadlock on the
// awaited sleep, so the backoff base (100ms) is simply allowed to elapse.
jest.setTimeout(20_000);

describe('IndexerService retries', () => {
  it('retries a 429 and succeeds on the next attempt', async () => {
    const { service, request, counters } = await build([
      httpError(429),
      { ok: { transfers: [] } },
    ]);

    await expect(service.tokenTransfers(QUERY)).resolves.toEqual({
      transfers: [],
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(counters.increment).toHaveBeenCalledWith('indexer.rate_limited');
  });

  it('honours a Retry-After header', async () => {
    const { service, request } = await build([
      httpError(429, undefined, { 'retry-after': '0' }),
      { ok: { transfers: [] } },
    ]);

    await expect(service.tokenTransfers(QUERY)).resolves.toEqual({
      transfers: [],
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('ignores an unparseable Retry-After and backs off instead', async () => {
    const { service } = await build([
      httpError(429, undefined, { 'retry-after': 'soon' }),
      { ok: { transfers: [] } },
    ]);

    await expect(service.tokenTransfers(QUERY)).resolves.toEqual({
      transfers: [],
    });
  });

  it('gives up on a persistent 429 with SERVICE_UNAVAILABLE', async () => {
    const { service, request } = await build([httpError(429)]);

    await expect(service.tokenTransfers(QUERY)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: { error: { code: EErrorCodes.INDEXER_RATE_LIMITED } },
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('retries a 5xx and gives up as INDEXER_UNAVAILABLE', async () => {
    const { service, request } = await build([httpError(503, { why: 'down' })]);

    await expect(service.tokenTransfers(QUERY)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: {
        error: {
          code: EErrorCodes.INDEXER_UNAVAILABLE,
          details: { status: 503, details: { why: 'down' } },
        },
      },
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('recovers when a 5xx clears before the retries run out', async () => {
    const { service } = await build([
      httpError(500),
      { ok: { transfers: [] } },
    ]);

    await expect(service.tokenTransfers(QUERY)).resolves.toEqual({
      transfers: [],
    });
  });

  it('fails a 4xx immediately without retrying', async () => {
    const { service, request } = await build([httpError(404, { why: 'gone' })]);

    await expect(service.tokenTransfers(QUERY)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { error: { code: EErrorCodes.INDEXER_REQUEST_FAILED } },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('fails a network error immediately', async () => {
    const { service, request } = await build([new Error('ECONNRESET')]);

    await expect(service.tokenTransfers(QUERY)).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      response: { error: { code: EErrorCodes.INDEXER_REQUEST_FAILED } },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('works without a counter service wired in', async () => {
    const { service } = await build([{ ok: { transfers: [] } }], {
      counters: false,
    });

    await expect(service.tokenTransfers(QUERY)).resolves.toEqual({
      transfers: [],
    });
  });
});

describe('IndexerService.tokenBalance', () => {
  it('reads a balance and URL-encodes the path segments', async () => {
    const { service, request } = await build([
      {
        ok: {
          tokenBalance: { blockchain: 'tron', token: 'usdt', amount: '5' },
        },
      },
    ]);

    await expect(
      service.tokenBalance({
        blockchain: 'tron',
        token: 'usdt',
        address: 'TR7/NHq',
      }),
    ).resolves.toMatchObject({ tokenBalance: { amount: '5' } });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://indexer.test/api/tron/usdt/TR7%2FNHq/token-balances',
      }),
    );
  });

  it('rejects a response that does not match the schema', async () => {
    const { service } = await build([{ ok: { tokenBalance: { amount: 5 } } }]);

    await expect(
      service.tokenBalance({
        blockchain: 'sepolia',
        token: 'usdt',
        address: '0x1',
      }),
    ).rejects.toThrow();
  });
});

describe('IndexerService.batchTokenTransfers', () => {
  it('short-circuits an empty batch without calling the indexer', async () => {
    const { service, request } = await build([{ ok: {} }]);

    await expect(service.batchTokenTransfers([])).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('uses the single-address route for a batch of one', async () => {
    const { service, request } = await build([{ ok: { transfers: [] } }]);

    await expect(service.batchTokenTransfers([QUERY])).resolves.toEqual([[]]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('posts a real batch and unwraps each entry', async () => {
    const { service, request } = await build([
      { ok: [{ transfers: [] }, { transfers: [] }] },
    ]);

    await expect(
      service.batchTokenTransfers([QUERY, { ...QUERY, address: '0xdef' }]),
    ).resolves.toEqual([[], []]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://indexer.test/api/batch/token-transfers',
      }),
    );
  });

  it('refuses a batch response that does not line up with the queries', async () => {
    const { service } = await build([{ ok: [{ transfers: [] }] }]);

    await expect(
      service.batchTokenTransfers([QUERY, { ...QUERY, address: '0xdef' }]),
    ).rejects.toThrow('Batch response has 1 entries for 2 queries');
  });

  it.each([0, -1, 1.5])('refuses a limit of %s', async (limit) => {
    const { service } = await build([{ ok: { transfers: [] } }]);

    await expect(service.tokenTransfers({ ...QUERY, limit })).rejects.toThrow(
      'Indexer query limit must be a positive integer',
    );
  });
});

describe('IndexerService.getBreakerState', () => {
  it('starts closed', async () => {
    const { service } = await build([{ ok: { transfers: [] } }]);

    expect(service.getBreakerState()).toBe('closed');
  });

  it('opens after enough retryable failures', async () => {
    const { service } = await build([httpError(503)]);

    // The breaker counts 5xx and network errors; 4xx never trips it.
    for (let i = 0; i < 12; i++) {
      await service.tokenTransfers(QUERY).catch(() => undefined);
      if (service.getBreakerState() === 'open') break;
    }

    expect(service.getBreakerState()).toBe('open');
  });
});
