import { timingSafeEqual } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
} from '@/common/pagination/keyset-cursor';
import { apiError } from '@/common/api-error';
import { decimalsFor, toScaled, toWad } from '@/coupons/accrual';
import { Coupon } from '@/coupons/entities/coupon.entity';
import type { ListCouponsDTO } from '@/coupons/dtos/list-coupons.dto';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const PENDING_ID_PREFIX = 'pending:';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ISourcePayment {
  srcChainId: number;
  txHash: string;
  outputIndex: number;
  asset: string;
  amount: string;
  usdValue: string | null;
  confirmations: number | null;
  requiredConfirmations: number;
}

export interface ICouponResponse {
  id: string;
  code: string | null;
  status: string;
  sourcePayment: ISourcePayment | null;
  paymentRef: string;
  utlAmount: string | null;
  expiresAt: string | null;
  claimable: boolean;
}

interface IListRow {
  id: string;
  code: string | null;
  status: string;
  paymentRef: string;
  utlAmount: string | null;
  expiresAt: Date | null;
  sortAt: Date;
}

/**
 * USD at 1e18 → a fixed-precision decimal string, floored.
 *
 * Six places rather than two: the demo's payments are worth fractions of a cent,
 * and `"0.00"` would tell the user their cashback came from nothing. The client
 * decides how to display it — that is why amounts cross this API as strings.
 */
const USD_DECIMALS = 6n;

function formatUsd(usdWad: bigint): string {
  const scale = 10n ** USD_DECIMALS;
  const units = usdWad / 10n ** (18n - USD_DECIMALS);
  return `${units / scale}.${(units % scale).toString().padStart(Number(USD_DECIMALS), '0')}`;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

@Injectable()
export class CouponsService {
  constructor(
    @InjectRepository(Coupon)
    private readonly coupons: Repository<Coupon>,
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(PriceSnapshot)
    private readonly snapshots: Repository<PriceSnapshot>,
    @InjectRepository(IndexerCursor)
    private readonly cursors: Repository<IndexerCursor>,
    private readonly confirmations: ConfirmationPolicy,
  ) {}

  /**
   * The coupon screen.
   *
   * The list is a union of real coupons and the caller's payments that have not
   * reached the confirmation depth yet. Accrual only ever creates `ISSUED`
   * coupons, so `PENDING` exists purely as this projection — which is what lets
   * the app render "4 / 12 confirmations" instead of an indefinite spinner.
   */
  async list(userId: string, query: ListCouponsDTO) {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const after = query.cursor ? decodeKeysetCursor(query.cursor) : null;

    // Keyset pagination over (sortAt, id): a coupon issued mid-scroll cannot
    // shift a row from one page onto another, which offset paging would allow.
    const rows: IListRow[] = await this.coupons.query(
      `
      SELECT * FROM (
        SELECT c.id::text     AS id,
               c.code         AS code,
               c.status       AS status,
               c."paymentRef" AS "paymentRef",
               c.amount::text AS "utlAmount",
               c."expiresAt"  AS "expiresAt",
               c."createdAt"  AS "sortAt",
               c."userId"     AS "userId"
        FROM coupons c
        UNION ALL
        SELECT '${PENDING_ID_PREFIX}' || p."paymentRef",
               NULL, 'PENDING', p."paymentRef", NULL, NULL,
               p."createdAt", p."userId"
        FROM payments p
        WHERE p.status = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM coupons c2 WHERE c2."paymentRef" = p."paymentRef"
          )
      ) rows
      WHERE rows."userId" = $1
        AND ($2::text IS NULL OR rows.status = $2)
        AND ($3::timestamptz IS NULL OR (rows."sortAt", rows.id) < ($3, $4))
      ORDER BY rows."sortAt" DESC, rows.id DESC
      LIMIT $5
      `,
      [
        userId,
        query.status ?? null,
        after?.at ?? null,
        after?.id ?? '',
        limit + 1,
      ],
    );

    const page = rows.slice(0, limit);

    return {
      items: await this.decorate(page),
      indexerLag: { seconds: await this.indexerLagSeconds() },
      nextCursor:
        rows.length > limit
          ? encodeKeysetCursor(
              page[page.length - 1].sortAt,
              page[page.length - 1].id,
            )
          : null,
    };
  }

  async findById(userId: string, id: string): Promise<ICouponResponse> {
    // The list emits synthetic ids for pending payments, so the ids it hands out
    // must resolve here too rather than dead-ending on a 404.
    if (id.startsWith(PENDING_ID_PREFIX)) {
      return this.findPending(userId, id.slice(PENDING_ID_PREFIX.length));
    }
    // Anything that is not a uuid cannot be a coupon id. 404, not a 500 from
    // Postgres and not a 400 that would hint at what the ids look like.
    if (!UUID_RE.test(id)) throw this.notFound();

    // Scoped by userId in the query itself: another user's coupon is simply not
    // found, so there is no branch that could turn into a 403.
    const coupon = await this.coupons.findOne({ where: { id, userId } });
    if (!coupon) throw this.notFound();
    return (await this.decorate([this.toRow(coupon)]))[0];
  }

  private async findPending(
    userId: string,
    paymentRef: string,
  ): Promise<ICouponResponse> {
    const payment = await this.payments.findOne({
      where: { paymentRef, userId, status: 'pending' },
    });
    if (!payment) throw this.notFound();

    return (
      await this.decorate([
        {
          id: `${PENDING_ID_PREFIX}${paymentRef}`,
          code: null,
          status: 'PENDING',
          paymentRef,
          utlAmount: null,
          expiresAt: null,
          sortAt: payment.createdAt,
        },
      ])
    )[0];
  }

  async findByCode(userId: string, code: string): Promise<ICouponResponse> {
    const coupon = await this.coupons.findOne({
      where: { code: code.trim().toUpperCase() },
    });

    const owner = coupon?.userId ?? '';
    const mine = constantTimeEquals(owner, userId);
    if (!coupon || !mine) throw this.notFound();

    return (await this.decorate([this.toRow(coupon)]))[0];
  }

  private notFound(): NotFoundException {
    return new NotFoundException(
      apiError('COUPON_NOT_FOUND', 'Unknown coupon or code'),
    );
  }

  private toRow(coupon: Coupon): IListRow {
    return {
      id: coupon.id,
      code: coupon.code,
      status: coupon.status,
      paymentRef: coupon.paymentRef,
      utlAmount: coupon.amount,
      expiresAt: coupon.expiresAt,
      sortAt: coupon.createdAt,
    };
  }

  private async decorate(rows: IListRow[]): Promise<ICouponResponse[]> {
    if (rows.length === 0) return [];

    const refs = rows.map((row) => row.paymentRef);
    const [payments, snapshots] = await Promise.all([
      this.payments.find({ where: { paymentRef: In(refs) } }),
      this.snapshots.find({ where: { paymentRef: In(refs) } }),
    ]);
    const paymentByRef = new Map(payments.map((p) => [p.paymentRef, p]));
    const snapshotByRef = new Map(snapshots.map((s) => [s.paymentRef, s]));

    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        code: row.code,
        status: row.status,
        paymentRef: row.paymentRef,
        utlAmount: row.utlAmount,
        expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
        claimable: this.isClaimable(row),
        sourcePayment: await this.sourcePayment(
          paymentByRef.get(row.paymentRef),
          snapshotByRef.get(row.paymentRef),
        ),
      })),
    );
  }

  private isClaimable(row: IListRow): boolean {
    if (row.status !== 'ISSUED') return false;
    return !row.expiresAt || new Date(row.expiresAt).getTime() > Date.now();
  }

  private async sourcePayment(
    payment?: Payment,
    snapshot?: PriceSnapshot,
  ): Promise<ISourcePayment | null> {
    if (!payment) return null;

    const srcChainId = Number(payment.srcChainId);
    const asset = snapshot?.asset ?? payment.token.toUpperCase();
    let amount = payment.amount;
    let usdValue: string | null = null;

    try {
      const decimals = decimalsFor(asset);
      // Smallest unit, matching what the chain and the contract see.
      amount = toScaled(payment.amount, decimals).toString();
      if (snapshot) {
        usdValue = formatUsd(
          (toWad(payment.amount, decimals) * toWad(snapshot.price, 18)) /
            10n ** 18n,
        );
      }
    } catch {
      // An asset we cannot scale still lists; it just shows the raw amount.
    }

    return {
      srcChainId,
      txHash: payment.txHash,
      outputIndex: payment.outputIndex,
      asset,
      amount,
      usdValue,
      // Live, not stored: this is the number MOB-15 renders as "4 / 12".
      confirmations: await this.confirmations.confirmations(
        srcChainId,
        Number(payment.blockNumber),
      ),
      requiredConfirmations: this.confirmations.depthFor(srcChainId),
    };
  }

  private async indexerLagSeconds(): Promise<number | null> {
    const [latest] = await this.cursors.find({
      order: { lastPolledAt: 'DESC' },
      take: 1,
    });
    if (!latest?.lastPolledAt) return null;
    return Math.max(
      0,
      Math.round((Date.now() - latest.lastPolledAt.getTime()) / 1000),
    );
  }
}
