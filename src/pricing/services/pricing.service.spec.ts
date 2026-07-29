import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';
import { PriceSource, PriceUnavailableError } from '@/pricing/price-source';
import { PricingService } from '@/pricing/services/pricing.service';

const PAYMENT_AT = new Date('2026-04-06T15:28:36.000Z');
const PG_UNIQUE_VIOLATION = '23505';

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    paymentRef: '0xref-1',
    srcChainId: 11155111,
    txHash: '0xabc',
    outputIndex: 285,
    blockNumber: 11232373,
    token: 'usdt',
    amount: '0.01',
    fromAddress: '0xpayer',
    merchantAddress: '0xmerchant',
    userId: 'user-1',
    status: 'confirmed',
    transferredAt: PAYMENT_AT,
    lastSeenAt: PAYMENT_AT,
    confirmedAt: PAYMENT_AT,
    createdAt: PAYMENT_AT,
    updatedAt: PAYMENT_AT,
    ...over,
  } as Payment;
}

function snapshotRepo(seed: Partial<PriceSnapshot>[] = []) {
  const rows = [...seed];
  return {
    rows,
    create: jest.fn((init: Partial<PriceSnapshot>) => ({ ...init })),
    insert: jest.fn(async (row: Partial<PriceSnapshot>) => {
      if (rows.some((existing) => existing.paymentRef === row.paymentRef)) {
        throw Object.assign(new Error('duplicate key'), {
          code: PG_UNIQUE_VIOLATION,
        });
      }
      rows.push(row);
    }),
    findOne: jest.fn(async ({ where }: { where: { paymentRef: string } }) =>
      rows.find((row) => row.paymentRef === where.paymentRef),
    ),
  };
}

async function build(options: {
  due: Payment[];
  priceAt?: jest.Mock;
  snapshots?: ReturnType<typeof snapshotRepo>;
}) {
  const snapshots = options.snapshots ?? snapshotRepo();
  const priceAt =
    options.priceAt ??
    jest.fn(async () => ({
      price: '0.99991',
      source: 'bitfinex',
      providerTimestamp: new Date(PAYMENT_AT.getTime() - 3600_000),
    }));

  const queryBuilder = {
    where: () => queryBuilder,
    andWhere: () => queryBuilder,
    orderBy: () => queryBuilder,
    limit: () => queryBuilder,
    getMany: async () => options.due,
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      PricingService,
      { provide: PriceSource, useValue: { priceAt } },
      {
        provide: getRepositoryToken(Payment),
        useValue: { createQueryBuilder: () => queryBuilder },
      },
      { provide: getRepositoryToken(PriceSnapshot), useValue: snapshots },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            ({ PRICING_POLL_INTERVAL_MS: 0, PRICING_BATCH_SIZE: 25 })[key],
        },
      },
    ],
  }).compile();

  return { service: moduleRef.get(PricingService), snapshots, priceAt };
}

describe('PricingService', () => {
  it('freezes one snapshot per paymentRef with source and provider timestamp', async () => {
    const { service, snapshots } = await build({ due: [payment()] });

    await service.tick();

    expect(snapshots.rows).toHaveLength(1);
    expect(snapshots.rows[0]).toMatchObject({
      paymentRef: '0xref-1',
      asset: 'USDT',
      quote: 'USD',
      price: '0.99991',
      source: 'bitfinex',
    });
    expect(snapshots.rows[0].providerTimestamp).toBeInstanceOf(Date);
  });

  it('prices USD₮ through the same path as BTC, not as a hardcoded 1:1', async () => {
    const priceAt = jest.fn(async (asset: string) => ({
      price: asset === 'BTC' ? '62204' : '0.99991',
      source: 'bitfinex',
      providerTimestamp: PAYMENT_AT,
    }));
    const snapshots = snapshotRepo();

    const { service } = await build({
      due: [
        payment({ token: 'usdt', paymentRef: '0xref-usdt' }),
        payment({ token: 'btc', paymentRef: '0xref-btc' }),
      ],
      priceAt,
      snapshots,
    });
    await service.tick();

    expect(priceAt.mock.calls.map((call) => call[0])).toEqual(['USDT', 'BTC']);
    expect(snapshots.rows.map((row) => row.price)).toEqual([
      '0.99991',
      '62204',
    ]);
    // Same code path, and USD₮ is not silently 1.
    expect(snapshots.rows[0].price).not.toBe('1');
  });

  it('prices at the payment timestamp, not at the moment of accrual', async () => {
    const { service, priceAt } = await build({ due: [payment()] });

    await service.tick();

    expect(priceAt).toHaveBeenCalledWith('USDT', PAYMENT_AT);
  });

  it('leaves the payment unpriced when the provider is down', async () => {
    const priceAt = jest.fn(async () => {
      throw new PriceUnavailableError('bitfinex unreachable');
    });
    const { service, snapshots } = await build({ due: [payment()], priceAt });

    await service.tick();

    // The coupon waits. It never accrues at a guessed price.
    expect(snapshots.rows).toHaveLength(0);
    expect(snapshots.insert).not.toHaveBeenCalled();
  });

  it('keeps pricing the rest of the batch when one payment has no price', async () => {
    const priceAt = jest.fn(async (asset: string) => {
      if (asset === 'BTC') throw new PriceUnavailableError('no series');
      return {
        price: '0.99991',
        source: 'bitfinex',
        providerTimestamp: PAYMENT_AT,
      };
    });
    const { service, snapshots } = await build({
      due: [
        payment({ token: 'btc', paymentRef: '0xref-btc' }),
        payment({ token: 'usdt', paymentRef: '0xref-usdt' }),
      ],
      priceAt,
    });

    await service.tick();

    expect(snapshots.rows.map((row) => row.paymentRef)).toEqual(['0xref-usdt']);
  });

  it('never writes a second snapshot for a paymentRef', async () => {
    const snapshots = snapshotRepo();
    const first = await build({ due: [payment()], snapshots });
    await first.service.tick();

    const second = await build({ due: [payment()], snapshots });
    await second.service.tick();

    expect(snapshots.rows).toHaveLength(1);
    expect(snapshots.rows[0].price).toBe('0.99991');
  });

  it('rejects a token with no asset mapping instead of pricing it as something else', async () => {
    const { service, snapshots } = await build({
      due: [payment({ token: 'doge' })],
    });

    await service.tick();

    expect(snapshots.rows).toHaveLength(0);
  });
});
