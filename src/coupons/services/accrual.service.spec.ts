import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AlertService } from '@/common/alerts/alert.service';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { AccrualService } from '@/coupons/services/accrual.service';
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';

const PG_UNIQUE_VIOLATION = '23505';
const AT = new Date('2026-07-08T22:48:36.000Z');

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
    transferredAt: AT,
    lastSeenAt: AT,
    confirmedAt: AT,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  } as Payment;
}

function snapshot(over: Partial<PriceSnapshot> = {}): PriceSnapshot {
  return {
    id: 'snap-1',
    paymentRef: '0xref-1',
    asset: 'USDT',
    quote: 'USD',
    price: '0.99991',
    source: 'bitfinex',
    providerTimestamp: AT,
    ingestedAt: AT,
    ...over,
  } as PriceSnapshot;
}

function couponRepo(seed: Partial<Coupon>[] = []) {
  const rows = [...seed];
  const openStates = [
    'PENDING',
    'ISSUED',
    'PENDING_ATTESTATION',
    'ATTESTED',
    'CLAIM_SUBMITTED',
  ];

  const builder = (mode: 'open' | 'claimed') => ({
    where: () => builderFor(mode),
    andWhere: () => builderFor(mode),
    getMany: async () =>
      rows.filter((row) =>
        mode === 'open'
          ? openStates.includes(row.status as string)
          : row.status === 'CLAIMED',
      ),
  });
  const builderFor = (mode: 'open' | 'claimed') => builder(mode);

  let nextMode: 'open' | 'claimed' = 'open';

  return {
    rows,
    create: jest.fn((init: Partial<Coupon>) => ({ ...init })),
    insert: jest.fn(async (row: Partial<Coupon>) => {
      if (rows.some((existing) => existing.paymentRef === row.paymentRef)) {
        throw Object.assign(new Error('duplicate paymentRef'), {
          code: PG_UNIQUE_VIOLATION,
        });
      }
      rows.push({ id: `c-${rows.length}`, ...row });
    }),
    update: jest.fn(async (where: { id: string }, patch: Partial<Coupon>) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (row) Object.assign(row, patch);
    }),
    findOne: jest.fn(async ({ where }: { where: { paymentRef: string } }) =>
      rows.find((row) => row.paymentRef === where.paymentRef),
    ),
    createQueryBuilder: jest.fn(() => {
      // voidOrphaned asks for open coupons first, then already-claimed ones.
      const mode = nextMode;
      nextMode = mode === 'open' ? 'claimed' : 'open';
      return builder(mode);
    }),
  };
}

async function build(options: {
  due?: Payment[];
  snapshots?: PriceSnapshot[];
  coupons?: ReturnType<typeof couponRepo>;
  utlUsdRate?: string;
  cashbackBps?: number;
  alertService?: Partial<AlertService>;
}) {
  const coupons = options.coupons ?? couponRepo();
  const snapshots = options.snapshots ?? [snapshot()];

  const paymentBuilder = {
    where: () => paymentBuilder,
    andWhere: () => paymentBuilder,
    orderBy: () => paymentBuilder,
    limit: () => paymentBuilder,
    getMany: async () => options.due ?? [],
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      AccrualService,
      { provide: getRepositoryToken(Coupon), useValue: coupons },
      {
        provide: getRepositoryToken(Payment),
        useValue: { createQueryBuilder: () => paymentBuilder },
      },
      {
        provide: getRepositoryToken(PriceSnapshot),
        useValue: {
          findOne: jest.fn(
            async ({ where }: { where: { paymentRef: string } }) =>
              snapshots.find((row) => row.paymentRef === where.paymentRef),
          ),
        },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            ({
              ACCRUAL_POLL_INTERVAL_MS: 0,
              ACCRUAL_BATCH_SIZE: 50,
              UTL_USD_RATE: options.utlUsdRate ?? '1',
              CASHBACK_BPS: options.cashbackBps ?? 500,
            })[key],
        },
      },
      {
        provide: AlertService,
        useValue: options.alertService ?? { raise: jest.fn() },
      },
    ],
  }).compile();

  return { service: moduleRef.get(AccrualService), coupons };
}

describe('AccrualService', () => {
  it('issues exactly one coupon per confirmed, priced payment', async () => {
    const { service, coupons } = await build({ due: [payment()] });

    await service.tick();

    expect(coupons.rows).toHaveLength(1);
    expect(coupons.rows[0]).toMatchObject({
      paymentRef: '0xref-1',
      userId: 'user-1',
      asset: 'USDT',
      status: 'ISSUED',
      // The golden vector: 0.01 USD₮ at 0.99991, 5 %, $1/UTL.
      amount: '499955000000000',
    });
    expect(coupons.rows[0].code).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/,
    );
  });

  it('never issues a second coupon for the same paymentRef', async () => {
    const coupons = couponRepo();
    const first = await build({ due: [payment()], coupons });
    await first.service.tick();

    const second = await build({ due: [payment()], coupons });
    await second.service.tick();

    expect(coupons.rows).toHaveLength(1);
  });

  it('uses the configured UTL rate rather than a literal', async () => {
    const { service, coupons } = await build({
      due: [payment()],
      utlUsdRate: '2',
    });

    await service.tick();

    // Same payment, twice the UTL price, half the coupon (floored).
    expect(coupons.rows[0].amount).toBe('249977500000000');
  });

  it('uses the configured cashback rate rather than a literal', async () => {
    const { service, coupons } = await build({
      due: [payment()],
      cashbackBps: 1000,
    });

    await service.tick();

    expect(coupons.rows[0].amount).toBe('999910000000000');
  });

  it('waits rather than accruing a payment with no price snapshot', async () => {
    const { service, coupons } = await build({
      due: [payment({ paymentRef: '0xunpriced' })],
      snapshots: [],
    });

    await service.tick();

    expect(coupons.rows).toHaveLength(0);
  });

  it('refuses to accrue an asset it has no precision for', async () => {
    const { service, coupons } = await build({
      due: [payment()],
      snapshots: [snapshot({ asset: 'DOGE' })],
    });

    await service.tick();

    expect(coupons.rows).toHaveLength(0);
  });

  it('voids the coupon of an orphaned payment before a claim can reach it', async () => {
    const coupons = couponRepo([
      {
        id: 'c-open',
        paymentRef: '0xref-1',
        code: 'AAAA-BBBB-CCCC-DDDD',
        status: 'ISSUED',
        amount: '499955000000000',
      },
    ]);
    const { service } = await build({ coupons });

    await service.tick();

    expect(coupons.rows[0].status).toBe('ORPHANED');
  });

  it('alerts instead of voiding when the orphaned payment was already claimed', async () => {
    const coupons = couponRepo([
      {
        id: 'c-paid',
        paymentRef: '0xref-1',
        code: 'AAAA-BBBB-CCCC-DDDD',
        status: 'CLAIMED',
        amount: '499955000000000',
        asset: 'USDT',
      },
    ]);
    const mockAlert = jest.fn();
    const { service } = await build({
      coupons,
      alertService: { raise: mockAlert },
    });
    const logged: string[] = [];
    jest
      .spyOn(service['logger'], 'error')
      .mockImplementation((msg) => logged.push(String(msg)));

    await service.tick();

    // The money is gone; pretending otherwise hides the incident.
    expect(coupons.rows[0].status).toBe('CLAIMED');
    expect(logged.join()).toContain(
      'security_event=coupon.orphaned_after_claim',
    );
    expect(mockAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'payment.orphaned_after_claim',
        severity: 'critical',
        context: expect.objectContaining({ couponId: 'c-paid' }),
      }),
    );
  });
});
