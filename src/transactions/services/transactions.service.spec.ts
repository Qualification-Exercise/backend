/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EChainKind } from '@/chains/chain-kind.enum';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import { IdempotencyService } from '@/idempotency/services/idempotency.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import type { CreateTransactionDTO } from '@/transactions/dtos/create-transaction.dto';
import { Transaction } from '@/transactions/entities/transaction.entity';
import { ETxSource, ETxStatus, ETxType } from '@/transactions/enums/tx.enum';
import { TransactionsService } from '@/transactions/services/transactions.service';
import { Wallet } from '@/wallets/entities/wallet.entity';

const USER = 'user-1';
const STRANGER = 'user-2';
const AT = new Date('2026-08-05T10:00:00.000Z');
const HASH = `0x${'ab'.repeat(32)}`;
const OWN_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const MERCHANT = '0x1234567890123456789012345678901234567890';

const PG_UNIQUE_VIOLATION = { code: '23505' };

const dto = (over: Partial<CreateTransactionDTO> = {}): CreateTransactionDTO =>
  ({
    chain: EChainKind.EVM,
    srcChainId: 1,
    txHash: HASH,
    direction: 'out',
    token: 'usdt',
    amount: '1000000',
    from: OWN_ADDRESS,
    to: MERCHANT,
    ...over,
  }) as CreateTransactionDTO;

const row = (over: Partial<Transaction> = {}): Transaction =>
  ({
    id: 'tx-1',
    userId: USER,
    walletId: 'wallet-1',
    chain: EChainKind.EVM,
    srcChainId: 1,
    txHash: HASH.toLowerCase(),
    outputIndex: 0,
    type: ETxType.TRANSFER,
    direction: 'out',
    token: 'USDT',
    amount: '1000000',
    usdValue: null,
    fromAddress: OWN_ADDRESS,
    toAddress: MERCHANT,
    feeToken: null,
    feeAmount: null,
    status: ETxStatus.PENDING,
    failureReason: null,
    confirmations: 0,
    requiredConfirmations: 12,
    blockHeight: null,
    claimId: null,
    source: ETxSource.CLIENT,
    broadcastAt: AT,
    occurredAt: AT,
    ...over,
  }) as Transaction;

interface IBuildOptions {
  rows?: Transaction[];
  wallets?: Partial<Wallet>[];
  cursors?: Partial<IndexerCursor>[];
  saveError?: unknown;
  sweepIntervalMs?: number;
  affected?: number;
  updateError?: unknown;
}

async function build(options: IBuildOptions = {}) {
  const rows = options.rows ?? [row()];
  const wallets = options.wallets ?? [
    {
      id: 'wallet-1',
      userId: USER,
      chain: EChainKind.EVM,
      address: OWN_ADDRESS,
    },
  ];

  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () => rows),
  };

  const saved: Transaction[] = [];
  const em = {
    create: jest.fn((_entity: unknown, data: Partial<Transaction>) => ({
      id: 'tx-new',
      ...data,
    })),
    save: jest.fn(async (entity: Transaction) => {
      if (options.saveError) throw options.saveError;
      saved.push(entity);
      return entity;
    }),
    // The unique key is scoped to the user, so the lookup after a collision is too.
    findOne: jest.fn(
      async (_entity: unknown, { where }: { where: { userId: string } }) =>
        rows.find((r) => r.userId === where.userId),
    ),
  };

  const transactions = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(
      async ({ where }: { where: { id: string; userId: string } }) =>
        rows.find((r) => r.id === where.id && r.userId === where.userId),
    ),
    update: jest.fn(
      async (
        _where: unknown,
        _patch: unknown,
      ): Promise<{ affected: number }> => {
        if (options.updateError) throw options.updateError;
        return { affected: options.affected ?? 0 };
      },
    ),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      TransactionsService,
      { provide: getRepositoryToken(Transaction), useValue: transactions },
      {
        provide: getRepositoryToken(Wallet),
        useValue: {
          findOne: jest.fn(
            async ({
              where,
            }: {
              where: { userId: string; chain: EChainKind };
            }) =>
              wallets.find(
                (w) => w.userId === where.userId && w.chain === where.chain,
              ),
          ),
        },
      },
      {
        provide: getRepositoryToken(IndexerCursor),
        useValue: { find: jest.fn(async () => options.cursors ?? []) },
      },
      {
        provide: ConfirmationPolicy,
        useValue: {
          depthFor: jest.fn(() => 12),
          confirmations: jest.fn(async () => 40),
        },
      },
      {
        provide: IdempotencyService,
        useValue: {
          run: jest.fn(
            async (
              _userId: string,
              _key: string,
              _hash: string,
              work: (em: unknown) => Promise<unknown>,
            ) => work(em),
          ),
        },
      },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) =>
            key === 'TX_OBSERVATION_TIMEOUT_MS'
              ? 900_000
              : (options.sweepIntervalMs ?? 0),
          ),
        },
      },
    ],
  }).compile();

  return {
    service: moduleRef.get(TransactionsService),
    transactions,
    em,
    qb,
    saved,
  };
}

describe('TransactionsService.record', () => {
  it('stores a device-reported transaction as PENDING from the client', async () => {
    const { service, saved } = await build();

    const result = await service.record(USER, dto(), 'key-1');

    expect(result.created).toBe(true);
    expect(result.item).toMatchObject({
      status: ETxStatus.PENDING,
      source: ETxSource.CLIENT,
      token: 'USDT',
      requiredConfirmations: 12,
      confirmations: 0,
    });
    // The hash is normalized before it is stored, so a checksum-cased or
    // 0x-less hash cannot create a second row for the same transaction.
    expect(saved[0].txHash).toBe(HASH.toLowerCase());
  });

  it('uppercases the fee token and defaults the type to TRANSFER', async () => {
    const { service } = await build();

    const result = await service.record(
      USER,
      dto({ fee: { token: 'eth', amount: '210000000000000' } }),
      'key-1',
    );

    expect(result.item.fee).toEqual({
      token: 'ETH',
      amount: '210000000000000',
    });
    expect(result.item.type).toBe(ETxType.TRANSFER);
  });

  it('honours an explicit broadcastAt and outputIndex', async () => {
    const { service, saved } = await build();

    await service.record(
      USER,
      dto({ broadcastAt: '2026-08-01T00:00:00.000Z', outputIndex: 3 }),
      'key-1',
    );

    expect(saved[0].outputIndex).toBe(3);
    expect(saved[0].occurredAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('requires an Idempotency-Key', async () => {
    const { service } = await build();

    await expect(service.record(USER, dto(), '   ')).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.IDEMPOTENCY_KEY_REQUIRED } },
    });
    await expect(service.record(USER, dto(), undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a txHash that is not 32 bytes of hex', async () => {
    const { service } = await build();

    await expect(
      service.record(USER, dto({ txHash: '0x123' }), 'key-1'),
    ).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.INVALID_TX_HASH } },
    });
  });

  it('rejects a chain that does not match its srcChainId', async () => {
    const { service } = await build();

    await expect(
      service.record(USER, dto({ chain: EChainKind.BITCOIN }), 'key-1'),
    ).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.UNSUPPORTED_CHAIN } },
    });
  });

  it('rejects an unknown srcChainId', async () => {
    const { service } = await build();

    await expect(
      service.record(USER, dto({ srcChainId: 999_999 }), 'key-1'),
    ).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.UNSUPPORTED_CHAIN } },
    });
  });

  it('refuses when the user has no wallet on that chain', async () => {
    const { service } = await build({ wallets: [] });

    await expect(service.record(USER, dto(), 'key-1')).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.WALLET_NOT_LINKED } },
    });
  });

  it('refuses an address that belongs to somebody else', async () => {
    const { service } = await build();

    await expect(
      service.record(USER, dto({ from: MERCHANT }), 'key-1'),
    ).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.WALLET_MISMATCH } },
    });
  });

  it('refuses a malformed address', async () => {
    const { service } = await build();

    await expect(
      service.record(USER, dto({ from: 'not-an-address' }), 'key-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checks the recipient instead of the sender on an inbound transfer', async () => {
    const { service } = await build();

    const result = await service.record(
      USER,
      dto({ direction: 'in', from: MERCHANT, to: OWN_ADDRESS }),
      'key-1',
    );

    expect(result.created).toBe(true);
  });

  it('returns the existing row when the same hash was already recorded', async () => {
    const { service, em } = await build({ saveError: PG_UNIQUE_VIOLATION });

    const result = await service.record(USER, dto(), 'key-1');

    expect(result.created).toBe(false);
    expect(result.item.id).toBe('tx-1');
    expect(em.findOne).toHaveBeenCalled();
  });

  it('does not hand somebody else’s row back on a hash collision', async () => {
    const { service } = await build({
      saveError: PG_UNIQUE_VIOLATION,
      rows: [row({ userId: STRANGER })],
    });

    await expect(service.record(USER, dto(), 'key-1')).rejects.toThrow(
      'Unique violation without a matching row',
    );
  });

  it('rethrows a database error that is not a unique violation', async () => {
    const { service } = await build({
      saveError: new Error('connection lost'),
    });

    await expect(service.record(USER, dto(), 'key-1')).rejects.toThrow(
      'connection lost',
    );
  });

  it('fails loudly if the unique violation has no matching row', async () => {
    const { service, em } = await build({ saveError: PG_UNIQUE_VIOLATION });
    em.findOne.mockResolvedValueOnce(undefined as never);

    await expect(service.record(USER, dto(), 'key-1')).rejects.toThrow(
      'Unique violation without a matching row',
    );
  });
});

describe('TransactionsService.list', () => {
  it('pages by ten and reports no next cursor on the last page', async () => {
    const { service } = await build();

    const result = await service.list(USER, {});

    expect(result.items).toHaveLength(1);
    expect(result.page).toEqual({ limit: 10, nextCursor: null });
  });

  it('caps the page size at ten and emits a cursor when more rows exist', async () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      row({ id: `tx-${i}`, occurredAt: new Date(AT.getTime() - i * 1000) }),
    );
    const { service } = await build({ rows });

    const result = await service.list(USER, { limit: 50 });

    expect(result.items).toHaveLength(10);
    expect(result.page.limit).toBe(10);
    expect(result.page.nextCursor).not.toBeNull();

    const decoded = JSON.parse(
      Buffer.from(result.page.nextCursor as string, 'base64url').toString(),
    );
    expect(decoded).toEqual({
      at: rows[9].occurredAt.toISOString(),
      id: 'tx-9',
    });
  });

  it('applies every filter it is given', async () => {
    const { service, qb } = await build();

    await service.list(USER, {
      chain: EChainKind.EVM,
      srcChainId: 1,
      type: ETxType.TRANSFER,
      status: ETxStatus.PENDING,
    });

    const clauses = qb.andWhere.mock.calls.map(([sql]) => sql as string);
    expect(clauses).toEqual([
      'tx.chain = :chain',
      'tx."srcChainId" = :srcChainId',
      'tx.type = :type',
      'tx.status = :status',
    ]);
  });

  it('resumes from a cursor it issued', async () => {
    const { service, qb } = await build();
    const cursor = Buffer.from(
      JSON.stringify({ at: AT.toISOString(), id: 'tx-1' }),
    ).toString('base64url');

    await service.list(USER, { cursor });

    expect(qb.andWhere).toHaveBeenCalledWith(
      '(tx."occurredAt", tx.id) < (:at, :id)',
      { at: AT.toISOString(), id: 'tx-1' },
    );
  });

  it.each([
    ['not base64 at all', '!!!not-base64!!!'],
    [
      'valid base64 of the wrong shape',
      Buffer.from('{"at":1}').toString('base64url'),
    ],
  ])('rejects a cursor we did not issue: %s', async (_label, cursor) => {
    const { service } = await build();

    await expect(service.list(USER, { cursor })).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.INVALID_CURSOR } },
    });
  });

  it('flags the indexer as stale when it has never polled', async () => {
    const { service } = await build({ cursors: [] });

    const result = await service.list(USER, {});

    expect(result.indexerLag).toEqual({ seconds: null, stale: true });
  });

  it('flags the indexer as stale once it lags more than ten minutes', async () => {
    const { service } = await build({
      cursors: [{ lastPolledAt: new Date(Date.now() - 601_000) }],
    });

    const result = await service.list(USER, {});

    expect(result.indexerLag.stale).toBe(true);
    expect(result.indexerLag.seconds).toBeGreaterThanOrEqual(601);
  });

  it('reports a fresh indexer as not stale', async () => {
    const { service } = await build({
      cursors: [{ lastPolledAt: new Date(Date.now() - 5_000) }],
    });

    const result = await service.list(USER, {});

    expect(result.indexerLag.stale).toBe(false);
  });

  it('counts confirmations from the block height once the chain has one', async () => {
    const { service } = await build({
      rows: [row({ blockHeight: 21_000_000, confirmations: 0 })],
    });

    const result = await service.list(USER, {});

    expect(result.items[0].confirmations).toBe(40);
  });
});

describe('TransactionsService.findById', () => {
  it('returns one transaction', async () => {
    const { service } = await build();

    await expect(service.findById(USER, 'tx-1')).resolves.toMatchObject({
      id: 'tx-1',
      txHash: HASH.toLowerCase(),
    });
  });

  it('hides another user’s transaction behind the same 404', async () => {
    const { service } = await build();

    await expect(service.findById(STRANGER, 'tx-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.findById(USER, 'nope')).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.TRANSACTION_NOT_FOUND } },
    });
  });
});

describe('TransactionsService.sweepUnobserved', () => {
  it('fails device rows the chain never showed', async () => {
    const { service, transactions } = await build({ affected: 3 });

    await service.sweepUnobserved();

    const [where, patch] = transactions.update.mock.calls[0];
    expect(where).toMatchObject({
      source: ETxSource.CLIENT,
      status: ETxStatus.PENDING,
    });
    expect(patch).toEqual({
      status: ETxStatus.FAILED,
      failureReason: 'NOT_OBSERVED',
    });
  });

  it('swallows a sweep failure so the timer keeps running', async () => {
    const { service } = await build({ updateError: new Error('db down') });

    await expect(service.sweepUnobserved()).resolves.toBeUndefined();
  });
});

describe('TransactionsService sweep timer', () => {
  afterEach(() => jest.useRealTimers());

  it('stays off when the interval is zero', async () => {
    const { service } = await build({ sweepIntervalMs: 0 });
    const spy = jest.spyOn(service, 'sweepUnobserved');

    service.onModuleInit();
    service.onModuleDestroy();

    expect(spy).not.toHaveBeenCalled();
  });

  it('sweeps on every tick and stops on shutdown', async () => {
    jest.useFakeTimers();
    const { service } = await build({ sweepIntervalMs: 1_000 });
    const spy = jest
      .spyOn(service, 'sweepUnobserved')
      .mockResolvedValue(undefined);

    service.onModuleInit();
    jest.advanceTimersByTime(2_000);
    expect(spy).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    jest.advanceTimersByTime(5_000);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
