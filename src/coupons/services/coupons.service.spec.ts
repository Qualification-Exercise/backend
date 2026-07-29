import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Coupon } from '@/coupons/entities/coupon.entity';
import { CouponsService } from '@/coupons/services/coupons.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';

const OWNER = 'user-1';
const STRANGER = 'user-2';
const AT = new Date('2026-07-08T22:48:36.000Z');
const REF = '0xref-1';

const coupon = (over: Partial<Coupon> = {}): Coupon =>
  ({
    id: '11111111-2222-3333-4444-555555555555',
    paymentRef: REF,
    code: 'AGQX-H1TA-8Z1D-1C0P',
    userId: OWNER,
    amount: '499955000000000',
    asset: 'USDT',
    status: 'ISSUED',
    createdAt: AT,
    updatedAt: AT,
    expiresAt: null,
    ...over,
  }) as Coupon;

const payment = (over: Partial<Payment> = {}): Payment =>
  ({
    id: 'pay-1',
    paymentRef: REF,
    srcChainId: 11155111,
    txHash: '0xabc',
    outputIndex: 285,
    blockNumber: 11232373,
    token: 'usdt',
    amount: '0.01',
    userId: OWNER,
    status: 'confirmed',
    transferredAt: AT,
    createdAt: AT,
    ...over,
  }) as Payment;

const snapshot = (): PriceSnapshot =>
  ({
    paymentRef: REF,
    asset: 'USDT',
    quote: 'USD',
    price: '0.99991',
    source: 'bitfinex',
    providerTimestamp: AT,
  }) as PriceSnapshot;

async function build(
  options: {
    coupons?: Coupon[];
    payments?: Payment[];
    snapshots?: PriceSnapshot[];
    confirmations?: number | null;
  } = {},
) {
  const couponRows = options.coupons ?? [coupon()];
  const paymentRows = options.payments ?? [payment()];
  const snapshotRows = options.snapshots ?? [snapshot()];

  const matches = (
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ) => Object.entries(where).every(([key, value]) => row[key] === value);

  const moduleRef = await Test.createTestingModule({
    providers: [
      CouponsService,
      {
        provide: getRepositoryToken(Coupon),
        useValue: {
          findOne: jest.fn(
            async ({ where }: { where: Record<string, unknown> }) =>
              couponRows.find((row) => matches(row as never, where)),
          ),
          query: jest.fn(async () => []),
        },
      },
      {
        provide: getRepositoryToken(Payment),
        useValue: {
          find: jest.fn(async () => paymentRows),
          findOne: jest.fn(
            async ({ where }: { where: Record<string, unknown> }) =>
              paymentRows.find((row) => matches(row as never, where)),
          ),
        },
      },
      {
        provide: getRepositoryToken(PriceSnapshot),
        useValue: { find: jest.fn(async () => snapshotRows) },
      },
      {
        provide: getRepositoryToken(IndexerCursor),
        useValue: { find: jest.fn(async () => []) },
      },
      {
        provide: ConfirmationPolicy,
        useValue: {
          confirmations: jest.fn(async () =>
            options.confirmations === undefined
              ? 138_000
              : options.confirmations,
          ),
          depthFor: jest.fn(() => 12),
        },
      },
    ],
  }).compile();

  return moduleRef.get(CouponsService);
}

describe('CouponsService.findById', () => {
  it('returns the coupon with its source payment, USD value and confirmations', async () => {
    const service = await build();

    const found = await service.findById(OWNER, coupon().id);

    expect(found).toMatchObject({
      code: 'AGQX-H1TA-8Z1D-1C0P',
      status: 'ISSUED',
      utlAmount: '499955000000000',
      claimable: true,
    });
    expect(found.sourcePayment).toEqual({
      srcChainId: 11155111,
      txHash: '0xabc',
      outputIndex: 285,
      asset: 'USDT',
      amount: '10000', // 0.01 USD₮ in its smallest unit
      usdValue: '0.009999',
      confirmations: 138_000,
      requiredConfirmations: 12,
    });
  });

  it("404s on another user's coupon rather than 403", async () => {
    const service = await build();

    await expect(service.findById(STRANGER, coupon().id)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404s on a malformed id instead of letting Postgres 500', async () => {
    const service = await build();

    await expect(service.findById(OWNER, 'not-a-uuid')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('resolves the synthetic id the list hands out for a pending payment', async () => {
    const service = await build({
      coupons: [],
      payments: [payment({ status: 'pending' })],
      snapshots: [],
      confirmations: 4,
    });

    const found = await service.findById(OWNER, `pending:${REF}`);

    expect(found).toMatchObject({
      status: 'PENDING',
      code: null,
      utlAmount: null,
      claimable: false,
    });
    // The pair MOB-15 renders as "4 / 12".
    expect(found.sourcePayment).toMatchObject({
      confirmations: 4,
      requiredConfirmations: 12,
    });
  });

  it("404s on another user's pending payment", async () => {
    const service = await build({
      coupons: [],
      payments: [payment({ status: 'pending' })],
    });

    await expect(service.findById(STRANGER, `pending:${REF}`)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('CouponsService.findByCode', () => {
  it('resolves the caller own code, case-insensitively', async () => {
    const service = await build();

    await expect(
      service.findByCode(OWNER, ' agqx-h1ta-8z1d-1c0p '),
    ).resolves.toMatchObject({ code: 'AGQX-H1TA-8Z1D-1C0P' });
  });

  it("404s on another user's code — never 403, which would confirm it exists", async () => {
    const service = await build();

    const error = await service
      .findByCode(STRANGER, 'AGQX-H1TA-8Z1D-1C0P')
      .catch((err) => err);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual({
      error: { code: 'COUPON_NOT_FOUND', message: 'Unknown coupon or code' },
    });
  });

  it('answers an unknown code identically to a foreign one', async () => {
    const service = await build();

    const foreign = await service
      .findByCode(STRANGER, 'AGQX-H1TA-8Z1D-1C0P')
      .catch((err) => err.getResponse());
    const unknown = await service
      .findByCode(STRANGER, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ')
      .catch((err) => err.getResponse());

    expect(foreign).toEqual(unknown);
  });
});

describe('CouponsService claimability', () => {
  it.each([
    ['ISSUED', true],
    ['PENDING_ATTESTATION', false],
    ['CLAIMED', false],
    ['ORPHANED', false],
    ['EXPIRED', false],
  ])('marks %s as claimable=%s', async (status, expected) => {
    const service = await build({
      coupons: [coupon({ status: status as Coupon['status'] })],
    });

    const found = await service.findById(OWNER, coupon().id);
    expect(found.claimable).toBe(expected);
  });

  it('is not claimable once the expiry has passed', async () => {
    const service = await build({
      coupons: [coupon({ expiresAt: new Date(Date.now() - 1000) })],
    });

    await expect(service.findById(OWNER, coupon().id)).resolves.toMatchObject({
      claimable: false,
    });
  });
});

describe('CouponsService.list', () => {
  it('rejects a cursor it did not issue', async () => {
    const service = await build();

    await expect(
      service.list(OWNER, { cursor: 'not-base64-json' }),
    ).rejects.toThrow(BadRequestException);
  });
});
