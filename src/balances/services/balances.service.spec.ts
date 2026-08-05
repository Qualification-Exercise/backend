import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BalanceCache } from '@/balances/entities/balance-cache.entity';
import { BalancesService } from '@/balances/services/balances.service';
import { EChainKind } from '@/chains/chain-kind.enum';
import { IndexerService } from '@/indexer/services/indexer.service';
import { Wallet } from '@/wallets/entities/wallet.entity';

const USER = 'user-1';
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TTL_MS = 60_000;

const cached = (over: Partial<BalanceCache> = {}): BalanceCache =>
  ({
    id: 'bal-1',
    userId: USER,
    srcChainId: 1,
    token: 'usdt',
    address: ADDRESS,
    amount: '1000000',
    decimals: 6,
    observedAt: new Date(Date.now() - 1_000),
    ...over,
  }) as BalanceCache;

async function build(
  options: {
    rows?: BalanceCache[];
    wallets?: Partial<Wallet>[];
    balance?: { amount: string; decimals?: number };
    indexerError?: unknown;
    walletsError?: unknown;
  } = {},
) {
  const balances = {
    find: jest.fn(async () => options.rows ?? []),
    upsert: jest.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_row: Partial<BalanceCache>, _conflict: string[]) => undefined,
    ),
  };

  const indexer = {
    tokenBalance: jest.fn(async () => {
      if (options.indexerError) throw options.indexerError;
      return {
        tokenBalance: options.balance ?? { amount: '5000000', decimals: 6 },
      };
    }),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      BalancesService,
      { provide: getRepositoryToken(BalanceCache), useValue: balances },
      {
        provide: getRepositoryToken(Wallet),
        useValue: {
          find: jest.fn(async () => {
            if (options.walletsError) throw options.walletsError;
            return options.wallets ?? [];
          }),
        },
      },
      { provide: IndexerService, useValue: indexer },
      { provide: ConfigService, useValue: { get: jest.fn(() => TTL_MS) } },
    ],
  }).compile();

  return { service: moduleRef.get(BalancesService), balances, indexer };
}

describe('BalancesService.list', () => {
  it('answers from the cache with the age of each row', async () => {
    const observedAt = new Date(Date.now() - 1_000);
    const { service, indexer } = await build({
      rows: [cached({ observedAt })],
    });

    const result = await service.list(USER);

    expect(result).toMatchObject({ ttlSeconds: 60 });
    expect(result.items[0]).toMatchObject({
      srcChainId: 1,
      chain: EChainKind.EVM,
      token: 'USDT',
      amount: '1000000',
      decimals: 6,
      observedAt: observedAt.toISOString(),
      stale: false,
    });
    // Fresh cache: the read must not reach the indexer at all.
    expect(indexer.tokenBalance).not.toHaveBeenCalled();
  });

  it('marks a row past the TTL stale and refreshes it in the background', async () => {
    const { service, indexer } = await build({
      rows: [cached({ observedAt: new Date(Date.now() - TTL_MS - 1_000) })],
      wallets: [{ userId: USER, chain: EChainKind.EVM, address: ADDRESS }],
    });

    const result = await service.list(USER);

    expect(result.items[0].stale).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(indexer.tokenBalance).toHaveBeenCalled();
  });

  it('returns an empty list for a user with nothing cached', async () => {
    const { service } = await build({ rows: [] });

    await expect(service.list(USER)).resolves.toEqual({
      items: [],
      ttlSeconds: 60,
    });
  });
});

describe('BalancesService.refresh', () => {
  it('stores one row per token of the chains the user has wallets on', async () => {
    const { service, balances } = await build({
      wallets: [{ userId: USER, chain: EChainKind.EVM, address: ADDRESS }],
    });

    await service.refresh(USER);

    // Every EVM chain in the registry, one upsert per token it indexes.
    expect(balances.upsert.mock.calls.length).toBeGreaterThan(0);
    const [row, conflict] = balances.upsert.mock.calls[0];
    expect(row).toMatchObject({
      userId: USER,
      address: ADDRESS,
      amount: '5000000',
      decimals: 6,
    });
    expect(conflict).toEqual(['userId', 'srcChainId', 'token']);
  });

  it('stores a null decimals when the indexer omits it', async () => {
    const { service, balances } = await build({
      wallets: [{ userId: USER, chain: EChainKind.EVM, address: ADDRESS }],
      balance: { amount: '1' },
    });

    await service.refresh(USER);

    expect(balances.upsert.mock.calls[0][0]).toMatchObject({ decimals: null });
  });

  it('skips a token the indexer cannot answer for instead of failing the run', async () => {
    const { service, balances } = await build({
      wallets: [{ userId: USER, chain: EChainKind.EVM, address: ADDRESS }],
      indexerError: new Error('404'),
    });

    await expect(service.refresh(USER)).resolves.toBeUndefined();
    expect(balances.upsert).not.toHaveBeenCalled();
  });

  it('survives a database failure', async () => {
    const { service } = await build({ walletsError: new Error('db down') });

    await expect(service.refresh(USER)).resolves.toBeUndefined();
  });

  it('does not start a second refresh while one is in flight', async () => {
    const { service, indexer } = await build({
      wallets: [{ userId: USER, chain: EChainKind.EVM, address: ADDRESS }],
    });

    const first = service.refresh(USER);
    const second = service.refresh(USER);
    await Promise.all([first, second]);

    const callsAfterBoth = indexer.tokenBalance.mock.calls.length;
    await service.refresh(USER);
    // The second call returned immediately; the third ran a full pass.
    expect(indexer.tokenBalance.mock.calls.length).toBe(callsAfterBoth * 2);
  });

  it('does nothing for a user with no wallets', async () => {
    const { service, indexer } = await build({ wallets: [] });

    await service.refresh(USER);

    expect(indexer.tokenBalance).not.toHaveBeenCalled();
  });
});
