import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Coupon } from '@/coupons/entities/coupon.entity';
import { CouponsService } from '@/coupons/services/coupons.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';

const USER = 'user-1';
const STRANGER = 'user-2';
const AT = new Date('2026-08-05T10:00:00.000Z');
const REF = '0xref-1';
const COUPON_ID = '11111111-2222-3333-4444-555555555555';

const listRow = (over: Record<string, unknown> = {}) => ({
  id: COUPON_ID,
  code: 'AGQX-H1TA-8Z1D-1C0P',
  status: 'ISSUED',
  paymentRef: REF,
  utlAmount: '499955000000000',
  expiresAt: null,
  sortAt: AT,
  userId: USER,
  ...over,
});

async function build(
  options: {
    rows?: Record<string, unknown>[];
    coupon?: Partial<Coupon> | null;
    payment?: Partial<Payment> | null;
    cursors?: { lastPolledAt: Date }[];
  } = {},
) {
  const query = jest.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_sql: string, _params: unknown[]) => options.rows ?? [],
  );

  const moduleRef = await Test.createTestingModule({
    providers: [
      CouponsService,
      {
        provide: getRepositoryToken(Coupon),
        useValue: {
          query,
          findOne: jest.fn(async () =>
            options.coupon === undefined ? null : options.coupon,
          ),
        },
      },
      {
        provide: getRepositoryToken(Payment),
        useValue: {
          find: jest.fn(async () => []),
          findOne: jest.fn(async () =>
            options.payment === undefined ? null : options.payment,
          ),
        },
      },
      {
        provide: getRepositoryToken(PriceSnapshot),
        useValue: { find: jest.fn(async () => []) },
      },
      {
        provide: getRepositoryToken(IndexerCursor),
        useValue: { find: jest.fn(async () => options.cursors ?? []) },
      },
      {
        provide: ConfirmationPolicy,
        useValue: {
          confirmations: jest.fn(async () => 5),
          depthFor: jest.fn(() => 12),
        },
      },
    ],
  }).compile();

  return { service: moduleRef.get(CouponsService), query };
}

describe('CouponsService.list', () => {
  it('returns the page with no cursor when the rows fit', async () => {
    const { service } = await build({ rows: [listRow()] });

    const result = await service.list(USER, {});

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('caps the page size and emits a cursor when more rows exist', async () => {
    const rows = Array.from({ length: 101 }, (_, i) =>
      listRow({ id: `${COUPON_ID}-${i}`, sortAt: new Date(AT.getTime() - i) }),
    );
    const { service, query } = await build({ rows });

    const result = await service.list(USER, { limit: 999 });

    // The page size the client asks for cannot exceed the server's maximum.
    const limitParam = query.mock.calls[0][1] as unknown[];
    expect(result.items.length).toBe(100);
    expect(limitParam[4]).toBe(result.items.length + 1);
    expect(result.nextCursor).not.toBeNull();
  });

  it('passes the status filter and the cursor into the query', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ at: AT.toISOString(), id: COUPON_ID }),
    ).toString('base64url');
    const { service, query } = await build({ rows: [] });

    await service.list(USER, { status: 'ISSUED', cursor } as never);

    const params = query.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(USER);
    expect(params[1]).toBe('ISSUED');
    expect(params[2]).toBe(AT.toISOString());
    expect(params[3]).toBe(COUPON_ID);
  });

  it('sends nulls rather than empty filters when nothing was asked for', async () => {
    const { service, query } = await build({ rows: [] });

    await service.list(USER, {});

    const params = query.mock.calls[0][1] as unknown[];
    expect(params[1]).toBeNull();
    expect(params[2]).toBeNull();
    expect(params[3]).toBe('');
  });

  it('rejects a cursor we did not issue', async () => {
    const { service } = await build();

    await expect(service.list(USER, { cursor: 'nope' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.list(USER, {
        cursor: Buffer.from('{"at":1}').toString('base64url'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports the indexer lag alongside the page', async () => {
    const { service } = await build({
      rows: [],
      cursors: [{ lastPolledAt: new Date(Date.now() - 30_000) }],
    });

    const result = await service.list(USER, {});

    expect(result.indexerLag.seconds).toBeGreaterThanOrEqual(30);
  });

  it('reports an unknown lag when the indexer has never polled', async () => {
    const { service } = await build({ rows: [], cursors: [] });

    await expect(service.list(USER, {})).resolves.toMatchObject({
      indexerLag: { seconds: null },
    });
  });
});

describe('CouponsService.findById', () => {
  it('resolves the synthetic id the list hands out for a pending payment', async () => {
    const { service } = await build({
      payment: { paymentRef: REF, userId: USER, createdAt: AT },
    });

    await expect(
      service.findById(USER, `pending:${REF}`),
    ).resolves.toMatchObject({
      status: 'PENDING',
      paymentRef: REF,
      code: null,
    });
  });

  it('404s a synthetic id whose payment is not this user’s', async () => {
    const { service } = await build({ payment: null });

    await expect(
      service.findById(USER, `pending:${REF}`),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s an id that cannot be a coupon id at all', async () => {
    // Not a 500 from Postgres, and not a 400 that would leak the id format.
    const { service } = await build();

    await expect(service.findById(USER, 'not-a-uuid')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('CouponsService.findByCode', () => {
  it('uppercases and trims the code before looking it up', async () => {
    const { service } = await build({
      coupon: {
        id: COUPON_ID,
        userId: USER,
        code: 'AGQX-H1TA-8Z1D-1C0P',
        paymentRef: REF,
        amount: '1',
        status: 'ISSUED',
        createdAt: AT,
        expiresAt: null,
      },
    });

    await expect(
      service.findByCode(USER, '  agqx-h1ta-8z1d-1c0p  '),
    ).resolves.toMatchObject({ code: 'AGQX-H1TA-8Z1D-1C0P' });
  });

  it('gives the same 404 for an unknown code and somebody else’s coupon', async () => {
    const unknown = await build({ coupon: null });
    await expect(
      unknown.service.findByCode(USER, 'NOPE'),
    ).rejects.toBeInstanceOf(NotFoundException);

    const foreign = await build({
      coupon: {
        id: COUPON_ID,
        userId: STRANGER,
        code: 'AGQX',
        paymentRef: REF,
        amount: '1',
        status: 'ISSUED',
        createdAt: AT,
        expiresAt: null,
      },
    });
    await expect(
      foreign.service.findByCode(USER, 'AGQX'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
