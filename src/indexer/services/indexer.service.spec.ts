import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';

import { IndexerService } from '@/indexer/services/indexer.service';

const SRC = resolve(__dirname, '../..');

function build(response: unknown) {
  const request = jest.fn(() => of({ data: response }));
  return Test.createTestingModule({
    providers: [
      IndexerService,
      { provide: HttpService, useValue: { request } },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            key === 'INDEXER_BASE_URL'
              ? 'https://indexer.test/api/v1/'
              : 'test-key',
        },
      },
    ],
  })
    .compile()
    .then((ref) => ({ service: ref.get(IndexerService), request }));
}

describe('IndexerService', () => {
  it('sends the API key and trims the trailing slash off the base URL', async () => {
    const { service, request } = await build({ transfers: [] });

    await service.tokenTransfers({
      blockchain: 'sepolia',
      token: 'usdt',
      address: '0xabc',
      limit: 10,
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://indexer.test/api/v1/sepolia/usdt/0xabc/token-transfers?limit=10',
        headers: { 'x-api-key': 'test-key' },
      }),
    );
  });

  it('rejects a response whose shape changed, instead of passing it downstream', async () => {
    const { service } = await build({
      transfers: [{ blockchain: 'sepolia', blockNumber: 'not-a-number' }],
    });

    await expect(
      service.tokenTransfers({
        blockchain: 'sepolia',
        token: 'usdt',
        address: '0xabc',
        limit: 10,
      }),
    ).rejects.toThrow();
  });

  it('refuses a batch response that does not line up with its queries', async () => {
    const { service } = await build([{ transfers: [] }]);

    await expect(
      service.batchTokenTransfers([
        { blockchain: 'sepolia', token: 'usdt', address: '0xa', limit: 10 },
        { blockchain: 'sepolia', token: 'usdt', address: '0xb', limit: 10 },
      ]),
    ).rejects.toThrow(/2 queries/);
  });

  it('is the only place in src/ that builds an indexer request', () => {
    // BE-07 acceptance criterion, kept honest by the build rather than by review.
    const hits = execSync(
      `grep -rlE "x-api-key|token-transfers|wdk-api" ${SRC} --include=*.ts || true`,
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .map((path) => path.replace(`${SRC}/`, ''))
      .filter((path) => !path.endsWith('.spec.ts'));

    expect(hits).toEqual(['indexer/services/indexer.service.ts']);
  });
});
