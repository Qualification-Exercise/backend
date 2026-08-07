import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository, type EntityManager } from 'typeorm';

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  resolvePageLimit,
} from '@/common/pagination/keyset-cursor';
import { MINUTE_MS, hoursToMs } from '@/common/time';
import { isUniqueViolation } from '@/common/database/pg-errors';
import { IntervalLoop } from '@/common/scheduling/interval-loop';
import { EChainKind } from '@/chains/chain-kind.enum';
import { ClaimChallenge } from '@/claims/entities/claim-challenge.entity';
import { AttestationEntity } from '@/attestations/entities/attestation.entity';
import { ClaimEntity } from '@/claims/entities/claim.entity';
import type { CreateClaimDTO } from '@/claims/dtos/create-claim.dto';
import type { ListClaimsDTO } from '@/claims/dtos/list-claims.dto';
import {
  EClaimFailureReason,
  EClaimStatus,
} from '@/claims/enums/claim-status.enum';
import { apiError } from '@/common/api-error';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import type { Env } from '@/config/env';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { ECouponStatus } from '@/coupons/enums/coupon-status.enum';
import {
  IdempotencyService,
  hashRequest,
} from '@/idempotency/services/idempotency.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { claimMessage, verifyOwnership } from '@/wallets/address';
import { WalletsService } from '@/wallets/services/wallets.service';
import { SettlementEntity } from '@/settlements/entities/settlement.entity';

const CHALLENGE_TTL_MS = 5 * MINUTE_MS;

export interface IClaimChallengeResponse {
  challengeId: string;
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface IClaimCreatedResponse {
  claimId: string;
  couponId: string;
  status: EClaimStatus;
  paymentRef: string;
  amount: string;
}

export interface IClaimResponse {
  claimId: string;
  couponId: string;
  status: EClaimStatus;
  chainId: number;
  txHash: string | null;
  paymentRef: string;
  amount: string;
  attestations: { have: number; need: number };
  confirmations: number | null;
  failureReason: EClaimFailureReason | null;
  failureDetail: string | null;
  updatedAt: string;
}

export interface IClaimPreviewResponse {
  claimable: { id: string; code: string | null; utlAmount: string }[];
  totalUtl: string;
  chainId: number;
  cooldown: { active: boolean; nextClaimAt: string | null };
}

interface ICouponRow {
  id: string;
  code: string | null;
  paymentRef: string;
  amount: string;
  userId: string;
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

function normalizeCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

@Injectable()
export class ClaimsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClaimsService.name);
  private readonly chainId: number;
  private readonly threshold: number;
  private readonly cooldownHours: number;
  private readonly deadlineSeconds: number;
  private readonly sweepIntervalMs: number;
  private readonly loop = new IntervalLoop(this.logger);

  constructor(
    @InjectRepository(ClaimEntity)
    private readonly claims: Repository<ClaimEntity>,
    @InjectRepository(AttestationEntity)
    private readonly attestations: Repository<AttestationEntity>,
    @InjectRepository(SettlementEntity)
    private readonly settlements: Repository<SettlementEntity>,
    @InjectRepository(ClaimChallenge)
    private readonly challenges: Repository<ClaimChallenge>,
    private readonly wallets: WalletsService,
    private readonly idempotency: IdempotencyService,
    private readonly confirmations: ConfirmationPolicy,
    configService: ConfigService<Env, true>,
  ) {
    this.chainId = configService.get('REWARD_CHAIN_ID');
    this.threshold = configService.get('ATTESTATION_THRESHOLD');
    this.cooldownHours = configService.get('CLAIM_COOLDOWN_HOURS');
    this.deadlineSeconds = configService.get('CLAIM_DEADLINE_SECONDS');
    this.sweepIntervalMs = configService.get('CLAIM_SWEEP_INTERVAL_MS');
  }

  onModuleInit() {
    const message = 'Claim deadline sweep disabled';
    if (this.loop.disabled(this.sweepIntervalMs, message)) return;

    this.loop.start(this.sweepIntervalMs, () => this.sweepOverdue());
  }

  onModuleDestroy() {
    this.loop.stop();
  }

  async createChallenge(
    userId: string,
    coupon: string,
  ): Promise<IClaimChallengeResponse> {
    await this.challenges.delete({ userId, expiresAt: LessThan(new Date()) });

    const challenge = await this.challenges.save(
      this.challenges.create({
        userId,
        nonce: `0x${randomBytes(32).toString('hex')}`,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        consumedAt: null,
      }),
    );

    return {
      challengeId: challenge.id,
      nonce: challenge.nonce,
      message: claimMessage(challenge.nonce, normalizedForLookup(coupon)),
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  private async consumeChallenge(
    userId: string,
    challengeId: string,
  ): Promise<string> {
    const claimed = await this.challenges
      .createQueryBuilder()
      .update(ClaimChallenge)
      .set({ consumedAt: new Date() })
      .where('id = :challengeId', { challengeId })
      .andWhere('"userId" = :userId', { userId })
      .andWhere('"consumedAt" IS NULL')
      .andWhere('"expiresAt" > now()')
      .returning('nonce')
      .execute();

    const nonce = claimed.raw?.[0]?.nonce as string | undefined;
    if (!nonce) {
      throw new BadRequestException(
        apiError(
          EErrorCodes.CHALLENGE_INVALID,
          'Challenge is unknown, already used, expired, or belongs to another user',
        ),
      );
    }
    return nonce;
  }

  async create(
    userId: string,
    dto: CreateClaimDTO,
    idempotencyKey: string | undefined,
  ): Promise<IClaimCreatedResponse> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException(
        apiError(
          EErrorCodes.IDEMPOTENCY_KEY_REQUIRED,
          'POST /claims requires an Idempotency-Key header',
        ),
      );
    }
    if (!dto.couponId === !dto.code) {
      throw new BadRequestException(
        apiError(
          EErrorCodes.INVALID_REQUEST,
          'Send exactly one of couponId or code',
        ),
      );
    }

    return this.idempotency.run(
      userId,
      idempotencyKey.trim(),
      hashRequest({
        couponId: dto.couponId ?? null,
        code: dto.code ?? null,
        challengeId: dto.challengeId,
      }),
      (em) => this.claimOne(em, userId, dto),
    );
  }

  private async claimOne(
    em: EntityManager,
    userId: string,
    dto: CreateClaimDTO,
  ): Promise<IClaimCreatedResponse> {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);

    await this.assertNotInCooldown(em, userId);
    const coupon = await this.resolveCoupon(em, userId, dto);

    const recipient = await this.proveAndResolveRecipient(
      em,
      userId,
      dto,
      coupon,
    );

    const moved: unknown[] = await em.query(
      `UPDATE coupons SET status = $1, "updatedAt" = now()
        WHERE id = $2 AND "userId" = $3 AND status = $4
          AND ("expiresAt" IS NULL OR "expiresAt" > now())
        RETURNING id`,
      [
        ECouponStatus.PENDING_ATTESTATION,
        coupon.id,
        userId,
        ECouponStatus.ISSUED,
      ],
    );
    if (moved.length === 0) throw this.notClaimable();

    const claim = em.create(ClaimEntity, {
      couponId: coupon.id,
      recipient,
      amount: coupon.amount,
      deadline: Math.floor(Date.now() / 1000) + this.deadlineSeconds,
      chainId: this.chainId,
      status: EClaimStatus.PENDING_ATTESTATION,
    });

    try {
      await em.save(claim);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw this.notClaimable();
      }
      throw err;
    }

    this.logger.log(
      `Claim ${claim.id} created for coupon ${coupon.id} amount=${coupon.amount}`,
    );

    return {
      claimId: claim.id,
      couponId: coupon.id,
      status: EClaimStatus.PENDING_ATTESTATION,
      paymentRef: coupon.paymentRef,
      amount: coupon.amount,
    };
  }

  private async assertNotInCooldown(
    em: EntityManager,
    userId: string,
  ): Promise<void> {
    const nextAt = await this.nextClaimAt(em, userId);
    if (!nextAt) return;

    throw new HttpException(
      apiError(
        EErrorCodes.CLAIM_COOLDOWN,
        `One claim per ${this.cooldownHours} h`,
        { nextClaimAt: nextAt.toISOString() },
      ),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async nextClaimAt(
    em: EntityManager,
    userId: string,
  ): Promise<Date | null> {
    if (this.cooldownHours <= 0) return null;

    const [row] = (await em.query(
      `SELECT c.created_at AS at
         FROM claims c
         JOIN coupons cp ON cp.id = c.coupon_id
        WHERE cp."userId" = $1 AND c.status <> $2
        ORDER BY c.created_at DESC
        LIMIT 1`,
      [userId, EClaimStatus.FAILED],
    )) as { at: Date }[];
    if (!row) return null;

    const nextAt = new Date(
      new Date(row.at).getTime() + hoursToMs(this.cooldownHours),
    );
    return nextAt.getTime() > Date.now() ? nextAt : null;
  }

  private async resolveCoupon(
    em: EntityManager,
    userId: string,
    dto: CreateClaimDTO,
  ): Promise<ICouponRow> {
    if (dto.couponId) {
      const coupon = await em.findOne(Coupon, {
        where: { id: dto.couponId, userId },
      });
      if (!coupon) throw this.couponNotFound();
      return coupon;
    }

    const coupon = await em.findOne(Coupon, {
      where: { code: normalizedForLookup(dto.code!) },
    });
    if (!coupon || !constantTimeEquals(coupon.userId, userId)) {
      throw this.couponNotFound();
    }
    return coupon;
  }

  private async proveAndResolveRecipient(
    em: EntityManager,
    userId: string,
    dto: CreateClaimDTO,
    coupon: ICouponRow,
  ): Promise<string> {
    const recipient = await this.resolveRecipient(em, userId);
    const nonce = await this.consumeChallenge(userId, dto.challengeId);
    const message = claimMessage(nonce, coupon.code ?? coupon.id);

    const proven = await verifyOwnership(
      recipient,
      message,
      dto.signature as `0x${string}`,
    );
    if (!proven) {
      this.logger.warn(
        `security_event=claim.signature_invalid userId=${userId} recipient=${recipient}`,
      );
      throw new BadRequestException(
        apiError(
          EErrorCodes.OWNERSHIP_PROOF_INVALID,
          'Signature does not prove control of the payout address',
        ),
      );
    }

    await this.wallets.confirmOwnership(em, userId, recipient);
    return recipient;
  }

  private async resolveRecipient(
    em: EntityManager,
    userId: string,
  ): Promise<string> {
    const [row] = (await em.query(
      `SELECT address FROM wallets
        WHERE "userId" = $1 AND chain = $2 AND "isPrimary"
        LIMIT 1`,
      [userId, EChainKind.EVM],
    )) as { address: string }[];

    if (!row) {
      throw new NotFoundException(
        apiError(
          EErrorCodes.WALLET_NOT_LINKED,
          'Link an EVM wallet before claiming',
        ),
      );
    }
    return row.address;
  }

  async findById(userId: string, claimId: string): Promise<IClaimResponse> {
    const claim = await this.claims
      .createQueryBuilder('claim')
      .innerJoinAndSelect('claim.coupon', 'coupon')
      .where('claim.id = :claimId', { claimId })
      .andWhere('coupon."userId" = :userId', { userId })
      .getOne();

    if (!claim) {
      throw new NotFoundException(
        apiError(EErrorCodes.CLAIM_NOT_FOUND, 'Unknown claim'),
      );
    }

    const [have, settlement] = await Promise.all([
      this.attestations.count({ where: { claimId: claim.id } }),
      this.settlements.findOne({
        where: { paymentRef: claim.coupon.paymentRef },
      }),
    ]);

    return {
      claimId: claim.id,
      couponId: claim.couponId,
      status: claim.status,
      chainId: Number(claim.chainId),
      txHash: claim.txHash,
      paymentRef: claim.coupon.paymentRef,
      amount: claim.amount,
      attestations: { have, need: this.threshold },
      confirmations: settlement
        ? await this.confirmations.confirmations(
            Number(claim.chainId),
            Number(settlement.blockNumber),
          )
        : null,
      failureReason: claim.failureReason,
      failureDetail: claim.failureDetail,
      updatedAt: claim.updatedAt.toISOString(),
    };
  }

  async preview(userId: string): Promise<IClaimPreviewResponse> {
    const em = this.claims.manager;

    const claimable = (await em.query(
      `SELECT id::text AS id, code, amount::text AS amount
         FROM coupons
        WHERE "userId" = $1 AND status = $2
          AND ("expiresAt" IS NULL OR "expiresAt" > now())
        ORDER BY "createdAt" DESC`,
      [userId, ECouponStatus.ISSUED],
    )) as { id: string; code: string | null; amount: string }[];

    const totalUtl = claimable.reduce(
      (sum, coupon) => sum + BigInt(coupon.amount),
      0n,
    );
    const nextAt = await this.nextClaimAt(em, userId);

    return {
      claimable: claimable.map((coupon) => ({
        id: coupon.id,
        code: coupon.code,
        utlAmount: coupon.amount,
      })),
      totalUtl: totalUtl.toString(),
      chainId: this.chainId,
      cooldown: {
        active: nextAt !== null,
        nextClaimAt: nextAt?.toISOString() ?? null,
      },
    };
  }

  async list(userId: string, query: ListClaimsDTO) {
    const limit = resolvePageLimit(query.limit);
    const after = query.cursor ? decodeKeysetCursor(query.cursor) : null;

    const qb = this.claims
      .createQueryBuilder('claim')
      .innerJoinAndSelect('claim.coupon', 'coupon')
      .where('coupon."userId" = :userId', { userId })
      .orderBy('claim.created_at', 'DESC')
      .addOrderBy('claim.id', 'DESC')
      .take(limit + 1);

    if (after) {
      qb.andWhere('(claim.created_at, claim.id) < (:at, :id)', after);
    }

    const rows = await qb.getMany();
    const page = rows.slice(0, limit);

    const counts = new Map<string, number>();
    if (page.length > 0) {
      const grouped = (await this.attestations
        .createQueryBuilder('a')
        .select('a.claimId', 'claimId')
        .addSelect('COUNT(*)', 'count')
        .where('a.claimId IN (:...ids)', { ids: page.map((c) => c.id) })
        .groupBy('a.claimId')
        .getRawMany()) as { claimId: string; count: string }[];
      for (const row of grouped) counts.set(row.claimId, Number(row.count));
    }

    return {
      items: page.map((claim) => ({
        claimId: claim.id,
        couponId: claim.couponId,
        status: claim.status,
        chainId: Number(claim.chainId),
        txHash: claim.txHash,
        paymentRef: claim.coupon.paymentRef,
        amount: claim.amount,
        attestations: {
          have: counts.get(claim.id) ?? 0,
          need: this.threshold,
        },
        failureReason: claim.failureReason,
        failureDetail: claim.failureDetail,
        updatedAt: claim.updatedAt.toISOString(),
      })),
      nextCursor:
        rows.length > limit
          ? encodeKeysetCursor(
              page[page.length - 1].createdAt,
              page[page.length - 1].id,
            )
          : null,
    };
  }

  async markAttested(claimId: string): Promise<void> {
    const have = await this.attestations.count({ where: { claimId } });
    if (have < this.threshold) return;
    await this.advance(
      claimId,
      [EClaimStatus.PENDING_ATTESTATION],
      EClaimStatus.ATTESTED,
      ECouponStatus.ATTESTED,
    );
  }

  async markSubmitted(
    claimId: string,
    txHash: string,
    txNonce?: number,
  ): Promise<void> {
    await this.advance(
      claimId,
      [EClaimStatus.ATTESTED],
      EClaimStatus.CLAIM_SUBMITTED,
      ECouponStatus.CLAIM_SUBMITTED,
      { txHash, txNonce: txNonce ?? null },
    );
  }

  async markClaimed(claimId: string): Promise<void> {
    await this.advance(
      claimId,
      [EClaimStatus.CLAIM_SUBMITTED],
      EClaimStatus.CLAIMED,
      ECouponStatus.CLAIMED,
    );
  }

  async fail(
    claimId: string,
    reason: EClaimFailureReason,
    detail?: string,
  ): Promise<void> {
    const moved = await this.advance(
      claimId,
      [
        EClaimStatus.PENDING_ATTESTATION,
        EClaimStatus.ATTESTED,
        EClaimStatus.CLAIM_SUBMITTED,
      ],
      EClaimStatus.FAILED,
      ECouponStatus.ISSUED,
      { failureReason: reason, failureDetail: detail ?? null },
    );
    if (!moved) return;

    this.logger.error(
      `security_event=claim.failed claimId=${claimId} reason=${reason}` +
        (detail ? ` detail=${detail}` : ''),
    );
  }

  async expire(claimId: string): Promise<void> {
    await this.advance(
      claimId,
      [EClaimStatus.ATTESTED],
      EClaimStatus.EXPIRED,
      ECouponStatus.ISSUED,
    );
  }

  async sweepOverdue(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const overdue = await this.claims
        .createQueryBuilder('claim')
        .select('claim.id', 'id')
        .addSelect('claim.status', 'status')
        .where('claim.status IN (:...open)', {
          open: [EClaimStatus.PENDING_ATTESTATION, EClaimStatus.ATTESTED],
        })
        .andWhere('claim.deadline < :now', { now })
        .limit(100)
        .getRawMany<{ id: string; status: EClaimStatus }>();

      for (const claim of overdue) {
        if (claim.status === EClaimStatus.PENDING_ATTESTATION) {
          await this.fail(claim.id, EClaimFailureReason.ATTESTATION_REJECTED);
        } else {
          await this.expire(claim.id);
        }
      }
    } catch (err) {
      this.logger.error(`Claim sweep failed: ${String(err)}`);
    }
  }

  private async advance(
    claimId: string,
    from: EClaimStatus[],
    to: EClaimStatus,
    couponTo: ECouponStatus,
    extra: Partial<ClaimEntity> = {},
  ): Promise<boolean> {
    return this.claims.manager.transaction(async (em) => {
      const result = await em
        .createQueryBuilder()
        .update(ClaimEntity)
        .set({ status: to, ...extra })
        .where('id = :claimId', { claimId })
        .andWhere('status IN (:...from)', { from })
        .returning('coupon_id')
        .execute();

      const couponId = result.raw?.[0]?.coupon_id as string | undefined;
      if (!couponId) return false;

      await em.query(
        `UPDATE coupons SET status = $1, "updatedAt" = now() WHERE id = $2`,
        [couponTo, couponId],
      );
      return true;
    });
  }

  private couponNotFound(): NotFoundException {
    return new NotFoundException(
      apiError(EErrorCodes.COUPON_NOT_FOUND, 'Unknown coupon or code'),
    );
  }

  private notClaimable(): ConflictException {
    return new ConflictException(
      apiError(
        EErrorCodes.COUPON_NOT_CLAIMABLE,
        'Coupon is expired, already claimed, or not in a claimable state',
      ),
    );
  }
}

function normalizedForLookup(code: string): string {
  const bare = normalizeCode(code);
  return bare.match(/.{1,4}/g)?.join('-') ?? bare;
}
