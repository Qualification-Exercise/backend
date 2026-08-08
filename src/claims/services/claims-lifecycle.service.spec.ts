/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ClaimEntity } from '@/claims/entities/claim.entity';
import {
  EClaimFailureReason,
  EClaimStatus,
} from '@/claims/enums/claim-status.enum';
import { ClaimsService } from '@/claims/services/claims.service';
import { ECouponStatus } from '@/coupons/enums/coupon-status.enum';

const USER = 'user-1';
const AT = new Date('2026-08-05T10:00:00.000Z');

const claimRow = (over: Partial<ClaimEntity> = {}): ClaimEntity =>
  ({
    id: 'clm-1',
    couponId: 'cpn-1',
    status: EClaimStatus.PENDING_ATTESTATION,
    chainId: 11155111,
    txHash: null,
    amount: '1000000000000000000',
    failureReason: null,
    failureDetail: null,
    createdAt: AT,
    updatedAt: AT,
    coupon: { paymentRef: '0xref-1', userId: USER },
    ...over,
  }) as ClaimEntity;

interface IWorld {
  claims?: ClaimEntity[];
  claimable?: { id: string; code: string | null; amount: string }[];
  lastClaimAt?: Date | null;
  attestationCount?: number;
  settlement?: { blockNumber: number } | null;
  advanceRaw?: { coupon_id: string }[];
  overdue?: { id: string; status: EClaimStatus }[];
  sweepError?: unknown;
  cooldownHours?: number;
  sweepIntervalMs?: number;
  grouped?: { claimId: string; count: string }[];
}

function build(world: IWorld = {}) {
  const rows = world.claims ?? [claimRow()];
  const couponUpdates: unknown[][] = [];

  const em = {
    couponUpdates,
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM coupons')) return world.claimable ?? [];
      if (sql.includes('FROM claims c')) {
        return world.lastClaimAt ? [{ at: world.lastClaimAt }] : [];
      }
      if (sql.includes('UPDATE coupons')) {
        couponUpdates.push(params);
        return [];
      }
      throw new Error(`unexpected sql: ${sql}`);
    }),
    createQueryBuilder: () => {
      const qb: any = {
        execute: async () => ({
          raw: world.advanceRaw ?? [{ coupon_id: 'cpn-1' }],
        }),
      };
      qb.update = () => qb;
      qb.set = () => qb;
      qb.where = () => qb;
      qb.andWhere = () => qb;
      qb.returning = () => qb;
      return qb;
    },
  };

  const listQb: any = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () => rows),
    getOne: jest.fn(async () => rows[0] ?? null),
    getRawMany: jest.fn(async () => {
      if (world.sweepError) throw world.sweepError;
      return world.overdue ?? [];
    }),
  };

  const claims = {
    manager: {
      query: em.query,
      transaction: (cb: (m: any) => Promise<unknown>) => cb(em),
    },
    createQueryBuilder: jest.fn(() => listQb),
  };

  const attestationsQb: any = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(async () => world.grouped ?? []),
  };

  const attestations = {
    count: jest.fn(async () => world.attestationCount ?? 0),
    createQueryBuilder: jest.fn(() => attestationsQb),
  };
  const settlements = {
    findOne: jest.fn(async () => world.settlement ?? null),
  };
  const challenges = {
    delete: jest.fn(),
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn(async (row: Record<string, unknown>) => ({
      id: 'chl-1',
      ...row,
    })),
  };
  const confirmations = { confirmations: jest.fn(async () => 7) };
  const config = {
    get: (key: string) =>
      ({
        REWARD_CHAIN_ID: 11155111,
        ATTESTATION_THRESHOLD: 2,
        CLAIM_COOLDOWN_HOURS: world.cooldownHours ?? 24,
        CLAIM_DEADLINE_SECONDS: 3600,
        CLAIM_SWEEP_INTERVAL_MS: world.sweepIntervalMs ?? 0,
        RPC_URLS: '{}',
      })[key],
  };

  const service = new ClaimsService(
    claims as never,
    attestations as never,
    settlements as never,
    challenges as never,
    { confirmOwnership: jest.fn() } as never,
    { run: jest.fn() } as never,
    confirmations as never,
    config as never,
  );

  return { service, em, claims, attestations, listQb, challenges };
}

describe('ClaimsService.createChallenge', () => {
  it('issues a single-use nonce with the coupon code inside the message', async () => {
    const { service, challenges } = build();

    const challenge = await service.createChallenge(USER, 'aaaabbbbccccdddd');

    expect(challenge.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    // Grouped back into the printed form, so the message matches what the user
    // sees on the claim screen whichever way they typed the code.
    expect(challenge.message).toContain('AAAA-BBBB-CCCC-DDDD');
    expect(new Date(challenge.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // Expired challenges of this user are cleared on the way in.
    expect(challenges.delete).toHaveBeenCalled();
  });

  it('still issues a challenge when no coupon is named', async () => {
    const { service } = build();

    await expect(service.createChallenge(USER, '')).resolves.toMatchObject({
      challengeId: 'chl-1',
    });
  });
});

describe('ClaimsService.preview', () => {
  it('totals the claimable coupons and reports no cooldown', async () => {
    const { service } = build({
      claimable: [
        { id: 'cpn-1', code: 'AAAA', amount: '1000' },
        { id: 'cpn-2', code: null, amount: '2000' },
      ],
    });

    await expect(service.preview(USER)).resolves.toEqual({
      claimable: [
        { id: 'cpn-1', code: 'AAAA', utlAmount: '1000' },
        { id: 'cpn-2', code: null, utlAmount: '2000' },
      ],
      totalUtl: '3000',
      chainId: 11155111,
      cooldown: { active: false, nextClaimAt: null },
    });
  });

  it('reports the cooldown while the last claim is inside the window', async () => {
    const lastClaimAt = new Date(Date.now() - 3_600_000);
    const { service } = build({ claimable: [], lastClaimAt });

    const result = await service.preview(USER);

    expect(result.cooldown.active).toBe(true);
    expect(new Date(result.cooldown.nextClaimAt as string).getTime()).toBe(
      lastClaimAt.getTime() + 24 * 3_600_000,
    );
  });

  it('clears the cooldown once the window has passed', async () => {
    const { service } = build({
      claimable: [],
      lastClaimAt: new Date(Date.now() - 25 * 3_600_000),
    });

    await expect(service.preview(USER)).resolves.toMatchObject({
      cooldown: { active: false },
    });
  });

  it('has no cooldown at all when it is configured off', async () => {
    const { service } = build({
      claimable: [],
      lastClaimAt: new Date(),
      cooldownHours: 0,
    });

    await expect(service.preview(USER)).resolves.toMatchObject({
      cooldown: { active: false },
    });
  });
});

describe('ClaimsService.list', () => {
  it('returns the page with attestation progress attached', async () => {
    const { service } = build({
      grouped: [{ claimId: 'clm-1', count: '1' }],
    });

    const result = await service.list(USER, {});

    expect(result.items[0]).toMatchObject({
      claimId: 'clm-1',
      couponId: 'cpn-1',
      paymentRef: '0xref-1',
      attestations: { have: 1, need: 2 },
    });
    expect(result.nextCursor).toBeNull();
  });

  it('reports zero attestations for a claim nobody has signed', async () => {
    const { service } = build({ grouped: [] });

    const result = await service.list(USER, {});

    expect(result.items[0].attestations).toEqual({ have: 0, need: 2 });
  });

  it('caps the page at ten and emits a cursor when more remain', async () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      claimRow({
        id: `clm-${i}`,
        createdAt: new Date(AT.getTime() - i * 1000),
      }),
    );
    const { service } = build({ claims: rows });

    const result = await service.list(USER, { limit: 100 });

    expect(result.items).toHaveLength(10);
    const decoded = JSON.parse(
      Buffer.from(result.nextCursor as string, 'base64url').toString(),
    );
    expect(decoded.id).toBe('clm-9');
  });

  it('resumes from a cursor it issued', async () => {
    const { service, listQb } = build();
    const cursor = Buffer.from(
      JSON.stringify({ at: AT.toISOString(), id: 'clm-1' }),
    ).toString('base64url');

    await service.list(USER, { cursor });

    expect(listQb.andWhere).toHaveBeenCalledWith(
      '(claim.created_at, claim.id) < (:at, :id)',
      { at: AT.toISOString(), id: 'clm-1' },
    );
  });

  it('rejects a cursor we did not issue', async () => {
    const { service } = build();

    await expect(
      service.list(USER, { cursor: 'nonsense' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('skips the attestation query entirely on an empty page', async () => {
    const { service, attestations } = build({ claims: [] });

    const result = await service.list(USER, {});

    expect(result.items).toEqual([]);
    expect(attestations.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe('ClaimsService.findById', () => {
  it('counts settlement confirmations once the claim has settled', async () => {
    const { service } = build({
      claims: [claimRow({ status: EClaimStatus.CLAIMED, txHash: '0xdead' })],
      attestationCount: 2,
      settlement: { blockNumber: 20_000_000 },
    });

    await expect(service.findById(USER, 'clm-1')).resolves.toMatchObject({
      status: EClaimStatus.CLAIMED,
      txHash: '0xdead',
      attestations: { have: 2, need: 2 },
      confirmations: 7,
    });
  });

  it('has no confirmations before a settlement exists', async () => {
    const { service } = build({ settlement: null });

    await expect(service.findById(USER, 'clm-1')).resolves.toMatchObject({
      confirmations: null,
    });
  });

  it('404s on somebody else’s claim', async () => {
    const { service } = build({ claims: [] });

    await expect(service.findById(USER, 'clm-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ClaimsService state transitions', () => {
  it('holds a claim below the attestation threshold', async () => {
    const { service, em } = build({ attestationCount: 1 });

    await service.markAttested('clm-1');

    expect(em.couponUpdates).toEqual([]);
  });

  it('moves the coupon to ATTESTED once the threshold is met', async () => {
    const { service, em } = build({ attestationCount: 2 });

    await service.markAttested('clm-1');

    expect(em.couponUpdates[0]).toEqual([ECouponStatus.ATTESTED, 'cpn-1']);
  });

  it('records the relayer transaction on submit', async () => {
    const { service, em } = build();

    await service.markSubmitted('clm-1', '0xtx', 4);

    expect(em.couponUpdates[0]).toEqual([
      ECouponStatus.CLAIM_SUBMITTED,
      'cpn-1',
    ]);
  });

  it('accepts a submit without a nonce', async () => {
    const { service, em } = build();

    await service.markSubmitted('clm-1', '0xtx');

    expect(em.couponUpdates).toHaveLength(1);
  });

  it('marks the coupon CLAIMED on settlement', async () => {
    const { service, em } = build();

    await service.markClaimed('clm-1');

    expect(em.couponUpdates[0]).toEqual([ECouponStatus.CLAIMED, 'cpn-1']);
  });

  it('returns a failed claim’s coupon to ISSUED and logs it', async () => {
    const { service, em } = build();
    const error = jest.spyOn(service['logger'], 'error');

    await service.fail(
      'clm-1',
      EClaimFailureReason.ATTESTATION_REJECTED,
      'issuer said no',
    );

    expect(em.couponUpdates[0]).toEqual([ECouponStatus.ISSUED, 'cpn-1']);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('security_event=claim.failed'),
    );
  });

  it('stays silent when the claim was not in a failable state', async () => {
    const { service } = build({ advanceRaw: [] });
    const error = jest.spyOn(service['logger'], 'error');

    await service.fail('clm-1', EClaimFailureReason.ATTESTATION_REJECTED);

    expect(error).not.toHaveBeenCalled();
  });

  it('expires an attested claim that missed its deadline', async () => {
    const { service, em } = build();

    await service.expire('clm-1');

    expect(em.couponUpdates[0]).toEqual([ECouponStatus.ISSUED, 'cpn-1']);
  });
});

describe('ClaimsService.sweepOverdue', () => {
  it('fails the ones still waiting on signatures and expires the signed ones', async () => {
    const { service } = build({
      overdue: [
        { id: 'clm-a', status: EClaimStatus.PENDING_ATTESTATION },
        { id: 'clm-b', status: EClaimStatus.ATTESTED },
      ],
    });
    const fail = jest.spyOn(service, 'fail').mockResolvedValue(undefined);
    const expire = jest.spyOn(service, 'expire').mockResolvedValue(undefined);

    await service.sweepOverdue();

    expect(fail).toHaveBeenCalledWith(
      'clm-a',
      EClaimFailureReason.ATTESTATION_REJECTED,
    );
    expect(expire).toHaveBeenCalledWith('clm-b');
  });

  it('swallows a sweep failure so the timer survives', async () => {
    const { service } = build({ sweepError: new Error('db down') });

    await expect(service.sweepOverdue()).resolves.toBeUndefined();
  });
});

describe('ClaimsService sweep timer', () => {
  afterEach(() => jest.useRealTimers());

  it('stays off when the interval is zero', () => {
    const { service } = build({ sweepIntervalMs: 0 });
    const spy = jest.spyOn(service, 'sweepOverdue');

    service.onModuleInit();
    service.onModuleDestroy();

    expect(spy).not.toHaveBeenCalled();
  });

  it('sweeps on each tick until shutdown', () => {
    jest.useFakeTimers();
    const { service } = build({ sweepIntervalMs: 1_000 });
    const spy = jest
      .spyOn(service, 'sweepOverdue')
      .mockResolvedValue(undefined);

    service.onModuleInit();
    jest.advanceTimersByTime(3_000);
    expect(spy).toHaveBeenCalledTimes(3);

    service.onModuleDestroy();
    jest.advanceTimersByTime(3_000);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
