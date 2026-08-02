import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';

import { paymentRef } from '@/chains';
import {
  IndexerService,
  type ITransfer,
  type ITransferQuery,
} from '@/indexer/services/indexer.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PaymentPollerService } from '@/payments/services/payment-poller.service';
import { Wallet } from '@/wallets/entities/wallet.entity';

function fixture(name: string): ITransfer[] {
  const path = resolve(
    __dirname,
    '../../../test/fixtures/indexer',
    `${name}.json`,
  );
  return JSON.parse(readFileSync(path, 'utf8')).transfers;
}

const SEPOLIA = 11155111;
const BITCOIN = 4294967298;

const sepoliaTransfers = fixture('sepolia-usdt-merchant');
const bitcoinTransfers = fixture('bitcoin-btc-merchant');

const SEPOLIA_MERCHANT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const BITCOIN_MERCHANT = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const KNOWN_PAYER = '0x64998cb8F2c9a6A9293c47c24Bf4535E003e57d3';

const PG_UNIQUE_VIOLATION = '23505';

function merchant(over: Partial<Merchant> = {}): Merchant {
  return {
    id: 'm-1',
    name: 'Demo merchant',
    srcChainId: SEPOLIA,
    address: SEPOLIA_MERCHANT,
    token: 'usdt',
    priority: 100,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Merchant;
}

function paymentRepo(seed: Partial<Payment>[] = []) {
  const rows: Partial<Payment>[] = [...seed];
  const key = (p: Partial<Payment>) =>
    `${p.srcChainId}:${p.txHash}:${p.outputIndex}`;

  return {
    rows,
    insert: jest.fn(async (row: Partial<Payment>) => {
      if (rows.some((existing) => key(existing) === key(row))) {
        throw Object.assign(new Error('duplicate key'), {
          code: PG_UNIQUE_VIOLATION,
        });
      }
      rows.push({ id: `p-${rows.length}`, ...row });
    }),
    update: jest.fn(
      async (where: Partial<Payment>, patch: Partial<Payment>) => {
        for (const row of rows) {
          const match = where.id
            ? row.id === where.id
            : key(row) === key(where as Partial<Payment>);
          if (match) Object.assign(row, patch);
        }
      },
    ),
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((row) => {
        if (
          where.srcChainId !== undefined &&
          row.srcChainId !== where.srcChainId
        ) {
          return false;
        }
        if (
          where.merchantAddress !== undefined &&
          row.merchantAddress !== where.merchantAddress
        ) {
          return false;
        }
        const status = where.status as
          { _value?: string[] } | string | undefined;
        if (typeof status === 'string' && row.status !== status) return false;
        if (typeof status === 'object' && status?._value) {
          if (!status._value.includes(row.status as string)) return false;
        }
        const block = where.blockNumber as { _value?: number } | undefined;
        if (
          block?._value !== undefined &&
          Number(row.blockNumber) > block._value
        ) {
          return false;
        }
        return true;
      }),
    ),
  };
}

function cursorRepo(seed: Partial<IndexerCursor>[] = []) {
  const rows = [...seed];
  return {
    rows,
    findOne: jest.fn(async ({ where }: { where: Partial<IndexerCursor> }) =>
      rows.find(
        (row) =>
          row.srcChainId === where.srcChainId &&
          row.token === where.token &&
          row.address === where.address,
      ),
    ),
    // Mirrors TypeORM: field initialisers apply, column defaults do not.
    create: jest.fn((init: Partial<IndexerCursor>) =>
      Object.assign(new IndexerCursor(), init),
    ),
    save: jest.fn(async (cursor: Partial<IndexerCursor>) => {
      if (!rows.includes(cursor as IndexerCursor)) rows.push(cursor);
      return cursor;
    }),
  };
}

async function build(options: {
  merchants: Merchant[];
  transfers: ITransfer[][];
  payments?: ReturnType<typeof paymentRepo>;
  cursors?: ReturnType<typeof cursorRepo>;
  wallets?: Partial<Wallet>[];
  confirmed?: boolean;
}) {
  const payments = options.payments ?? paymentRepo();
  const cursors = options.cursors ?? cursorRepo();
  const walletRows = (options.wallets ?? []).map((w) => ({
    verified: true,
    ...w,
  }));
  const batch = jest.fn((queries: ITransferQuery[]): Promise<ITransfer[][]> =>
    Promise.resolve(queries.map((_, i) => options.transfers[i] ?? [])),
  );

  const config = {
    get: (key: string) =>
      ({
        PAYMENT_POLL_INTERVAL_MS: 0,
        PAYMENT_POLL_PAGE_SIZE: 50,
        PAYMENT_POLL_MAX_MERCHANTS: 20,
      })[key],
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      PaymentPollerService,
      { provide: IndexerService, useValue: { batchTokenTransfers: batch } },
      {
        provide: ConfirmationPolicy,
        useValue: { isConfirmed: async () => options.confirmed ?? false },
      },
      {
        provide: getRepositoryToken(Merchant),
        useValue: { find: jest.fn(async () => options.merchants) },
      },
      { provide: getRepositoryToken(Payment), useValue: payments },
      { provide: getRepositoryToken(IndexerCursor), useValue: cursors },
      {
        provide: getRepositoryToken(Wallet),
        useValue: {
          findOne: jest.fn(
            async ({ where }: { where: Partial<Wallet> }) =>
              walletRows.find(
                (w) =>
                  w.address === where.address &&
                  w.verified === where.verified &&
                  (w.srcChainId === undefined ||
                    Number(w.srcChainId) === Number(where.srcChainId)),
              ) ?? null,
          ),
        },
      },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();

  return {
    service: moduleRef.get(PaymentPollerService),
    payments,
    cursors,
    batch,
  };
}

describe('PaymentPollerService', () => {
  it('records a merchant payment keyed by the BE-03 paymentRef', async () => {
    const { service, payments } = await build({
      merchants: [merchant()],
      transfers: [sepoliaTransfers],
      wallets: [{ userId: 'user-1', address: KNOWN_PAYER }],
    });

    await service.tick();

    expect(payments.rows).toHaveLength(sepoliaTransfers.length);
    const first = payments.rows[0];
    expect(first.paymentRef).toBe(
      paymentRef(
        SEPOLIA,
        sepoliaTransfers[0].transactionHash,
        sepoliaTransfers[0].logIndex!,
      ),
    );
    expect(first).toMatchObject({
      srcChainId: SEPOLIA,
      outputIndex: sepoliaTransfers[0].logIndex,
      blockNumber: sepoliaTransfers[0].blockNumber,
      userId: 'user-1',
      status: 'pending',
    });
  });

  it('ingests nothing new when the poll window overlaps what was already seen', async () => {
    const payments = paymentRepo();
    const cursors = cursorRepo();
    const wallets = [{ userId: 'user-1', address: KNOWN_PAYER }];

    const first = await build({
      merchants: [merchant()],
      transfers: [sepoliaTransfers.slice(0, 1)],
      payments,
      cursors,
      wallets,
    });
    await first.service.tick();
    expect(payments.rows).toHaveLength(1);

    // Second poll returns the same transfer again plus one newer one.
    const second = await build({
      merchants: [merchant()],
      transfers: [sepoliaTransfers],
      payments,
      cursors,
      wallets,
    });
    await second.service.tick();

    // One insert on the first tick, exactly one more on the overlapping second.
    expect(payments.rows).toHaveLength(2);
    expect(payments.insert).toHaveBeenCalledTimes(2);
  });

  it('treats a duplicate transfer as a no-op, not a second payment', async () => {
    const payments = paymentRepo();
    const wallets = [{ userId: 'user-1', address: KNOWN_PAYER }];

    // A fresh cursor each time: the poller re-offers transfers it already stored.
    for (let i = 0; i < 3; i++) {
      const { service } = await build({
        merchants: [merchant()],
        transfers: [sepoliaTransfers],
        payments,
        cursors: cursorRepo(),
        wallets,
      });
      await service.tick();
    }

    expect(payments.rows).toHaveLength(sepoliaTransfers.length);
    expect(payments.insert).toHaveBeenCalledTimes(sepoliaTransfers.length * 3);
  });

  it('records a payment from an unmapped address as ignored, not retried', async () => {
    const { service, payments } = await build({
      merchants: [merchant()],
      transfers: [sepoliaTransfers],
      wallets: [], // nobody has mapped the payer
    });

    await service.tick();

    expect(payments.rows.every((p) => p.status === 'ignored')).toBe(true);
    expect(payments.rows.every((p) => p.userId === null)).toBe(true);
  });

  it('does not attribute a payment to an unverified address', async () => {
    const { service, payments } = await build({
      merchants: [merchant()],
      transfers: [sepoliaTransfers],
      wallets: [{ userId: 'user-1', address: KNOWN_PAYER, verified: false }],
    });

    await service.tick();

    expect(payments.rows.every((p) => p.userId === null)).toBe(true);
    expect(payments.rows.every((p) => p.status === 'ignored')).toBe(true);
  });

  it('orphans a payment the indexer stops reporting', async () => {
    const stored = {
      id: 'p-gone',
      paymentRef: '0xdead',
      srcChainId: SEPOLIA,
      txHash: '0xvanished',
      outputIndex: 0,
      blockNumber: sepoliaTransfers[0].blockNumber,
      merchantAddress: SEPOLIA_MERCHANT,
      status: 'pending' as const,
    };
    const payments = paymentRepo([stored]);

    const { service } = await build({
      merchants: [merchant()],
      transfers: [sepoliaTransfers],
      payments,
      wallets: [{ userId: 'user-1', address: KNOWN_PAYER }],
    });
    await service.tick();

    expect(payments.rows.find((p) => p.id === 'p-gone')?.status).toBe(
      'orphaned',
    );
  });

  it('orphans a payment the indexer moves to a different block', async () => {
    const moved = {
      id: 'p-moved',
      paymentRef: '0xbeef',
      srcChainId: SEPOLIA,
      txHash: sepoliaTransfers[0].transactionHash,
      outputIndex: sepoliaTransfers[0].logIndex!,
      blockNumber: sepoliaTransfers[0].blockNumber - 5,
      merchantAddress: SEPOLIA_MERCHANT,
      status: 'confirmed' as const,
    };
    const payments = paymentRepo([moved]);

    const { service } = await build({
      merchants: [merchant()],
      transfers: [sepoliaTransfers],
      payments,
      wallets: [{ userId: 'user-1', address: KNOWN_PAYER }],
    });
    await service.tick();

    expect(payments.rows.find((p) => p.id === 'p-moved')?.status).toBe(
      'orphaned',
    );
  });

  it('splits two outputs of one UTXO transaction into two distinct payments', async () => {
    const sameTx = bitcoinTransfers.filter(
      (t) => t.transactionHash === bitcoinTransfers[0].transactionHash,
    );
    expect(sameTx).toHaveLength(2); // the recorded fixture really does carry both

    const { service, payments } = await build({
      merchants: [
        merchant({
          srcChainId: BITCOIN,
          address: BITCOIN_MERCHANT,
          token: 'btc',
        }),
      ],
      transfers: [sameTx],
      wallets: [{ userId: 'user-1', address: sameTx[0].from }],
    });
    await service.tick();

    expect(payments.rows).toHaveLength(2);
    expect(payments.rows.map((p) => p.outputIndex)).toEqual([0, 1]);

    const refs = payments.rows.map((p) => p.paymentRef);
    expect(new Set(refs).size).toBe(2);
    expect(refs[0]).toBe(paymentRef(BITCOIN, sameTx[0].transactionHash, 0));
    expect(refs[1]).toBe(paymentRef(BITCOIN, sameTx[1].transactionHash, 1));
  });

  it('confirms a payment only once the chain head is deep enough', async () => {
    const payments = paymentRepo();
    const wallets = [{ userId: 'user-1', address: KNOWN_PAYER }];

    const shallow = await build({
      merchants: [merchant()],
      transfers: [sepoliaTransfers],
      payments,
      cursors: cursorRepo(),
      wallets,
      confirmed: false,
    });
    await shallow.service.tick();
    expect(payments.rows.every((p) => p.status === 'pending')).toBe(true);

    const deep = await build({
      merchants: [merchant()],
      transfers: [sepoliaTransfers],
      payments,
      cursors: cursorRepo(),
      wallets,
      confirmed: true,
    });
    await deep.service.tick();
    expect(payments.rows.every((p) => p.status === 'confirmed')).toBe(true);
  });

  it('skips a merchant the indexer cannot serve, and polls the rest', async () => {
    // ETH accrues and prices fine, but the indexer serves no `eth` token —
    // sending it would 400 the whole batch and stall every other merchant.
    const { service, batch, payments } = await build({
      merchants: [
        merchant({ id: 'm-eth', token: 'eth' }),
        merchant({ id: 'm-usdt' }),
      ],
      transfers: [sepoliaTransfers],
      wallets: [{ userId: 'user-1', address: KNOWN_PAYER }],
    });

    await service.tick();

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toEqual([
      {
        blockchain: 'sepolia',
        token: 'usdt',
        address: SEPOLIA_MERCHANT,
        limit: 50,
      },
    ]);
    expect(payments.rows).toHaveLength(sepoliaTransfers.length);
  });

  it('asks for one batch request covering every due merchant', async () => {
    const { service, batch } = await build({
      merchants: [
        merchant(),
        merchant({
          id: 'm-2',
          address: BITCOIN_MERCHANT,
          srcChainId: BITCOIN,
          token: 'btc',
        }),
      ],
      transfers: [sepoliaTransfers, bitcoinTransfers],
      wallets: [],
    });

    await service.tick();

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toEqual([
      {
        blockchain: 'sepolia',
        token: 'usdt',
        address: SEPOLIA_MERCHANT,
        limit: 50,
      },
      {
        blockchain: 'bitcoin',
        token: 'btc',
        address: BITCOIN_MERCHANT,
        limit: 50,
      },
    ]);
  });
});
