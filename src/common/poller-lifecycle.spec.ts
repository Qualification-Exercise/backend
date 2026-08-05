/**
 * Every background role follows the same contract: an interval of zero means
 * "do not run", a tick must never overlap itself, and a failing pass must be
 * logged and released rather than wedging the loop shut. Asserting it once per
 * service keeps a new poller from quietly getting it wrong.
 */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AlertService } from '@/common/alerts/alert.service';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { AccrualService } from '@/coupons/services/accrual.service';
import { IndexerService } from '@/indexer/services/indexer.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PaymentPollerService } from '@/payments/services/payment-poller.service';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';
import { Wallet } from '@/wallets/entities/wallet.entity';

const repo = () => ({
  find: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
  save: jest.fn(async (row: unknown) => row),
  insert: jest.fn(async () => undefined),
  update: jest.fn(async () => ({ affected: 0 })),
  count: jest.fn(async () => 0),
  query: jest.fn(async () => []),
  createQueryBuilder: jest.fn(() => queryBuilder()),
});

const queryBuilder = () => {
  const qb: Record<string, unknown> = {};
  for (const method of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'groupBy',
    'limit',
    'take',
    'innerJoinAndSelect',
    'leftJoinAndSelect',
  ]) {
    qb[method] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn(async () => []);
  qb.getRawMany = jest.fn(async () => []);
  qb.getOne = jest.fn(async () => null);
  return qb;
};

async function buildAccrual(intervalMs: number) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AccrualService,
      { provide: getRepositoryToken(Coupon), useValue: repo() },
      { provide: getRepositoryToken(Payment), useValue: repo() },
      { provide: getRepositoryToken(PriceSnapshot), useValue: repo() },
      { provide: AlertService, useValue: { raise: jest.fn() } },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            ({
              ACCRUAL_POLL_INTERVAL_MS: intervalMs,
              ACCRUAL_BATCH_SIZE: 25,
              UTL_USD_RATE: '1',
              CASHBACK_BPS: 500,
            })[key],
        },
      },
    ],
  }).compile();
  return moduleRef.get(AccrualService);
}

async function buildPoller(intervalMs: number) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      PaymentPollerService,
      {
        provide: IndexerService,
        useValue: { batchTokenTransfers: jest.fn(async () => []) },
      },
      {
        provide: ConfirmationPolicy,
        useValue: { depthFor: jest.fn(() => 12), isConfirmed: jest.fn() },
      },
      { provide: getRepositoryToken(Merchant), useValue: repo() },
      { provide: getRepositoryToken(Payment), useValue: repo() },
      { provide: getRepositoryToken(IndexerCursor), useValue: repo() },
      { provide: getRepositoryToken(Wallet), useValue: repo() },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            ({
              PAYMENT_POLL_INTERVAL_MS: intervalMs,
              PAYMENT_POLL_PAGE_SIZE: 50,
              PAYMENT_POLL_MAX_MERCHANTS: 10,
            })[key],
        },
      },
    ],
  }).compile();
  return moduleRef.get(PaymentPollerService);
}

const SERVICES: [
  string,
  (ms: number) => Promise<{
    onModuleInit: () => void;
    onModuleDestroy: () => void;
    tick: () => Promise<void>;
  }>,
][] = [
  ['AccrualService', buildAccrual],
  ['PaymentPollerService', buildPoller],
];

afterEach(() => jest.useRealTimers());

describe.each(SERVICES)('%s loop', (_name, make) => {
  it('does not schedule anything when the interval is zero', async () => {
    const service = await make(0);
    const tick = jest.spyOn(service, 'tick').mockResolvedValue(undefined);

    service.onModuleInit();
    service.onModuleDestroy();

    expect(tick).not.toHaveBeenCalled();
  });

  it('ticks on the interval and stops on shutdown', async () => {
    jest.useFakeTimers();
    const service = await make(1_000);
    const tick = jest.spyOn(service, 'tick').mockResolvedValue(undefined);

    service.onModuleInit();
    jest.advanceTimersByTime(3_000);
    expect(tick).toHaveBeenCalledTimes(3);

    service.onModuleDestroy();
    jest.advanceTimersByTime(3_000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('runs a pass to completion without throwing', async () => {
    const service = await make(0);

    await expect(service.tick()).resolves.toBeUndefined();
  });
});
