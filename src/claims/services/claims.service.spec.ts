/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { privateKeyToAccount } from 'viem/accounts';

import { ClaimEntity } from '@/claims/entities/claim.entity';
import { claimMessage } from '@/wallets/address';
import {
  EClaimFailureReason,
  EClaimStatus,
} from '@/claims/enums/claim-status.enum';
import { ClaimsService } from '@/claims/services/claims.service';
import { ECouponStatus } from '@/coupons/enums/coupon-status.enum';

const USER = 'user-1';
const OTHER_USER = 'user-2';
const KEY = 'idem-1';
const CHALLENGE_ID = '2f0c9d9e-6e2a-4a1e-9c66-7a1f0b4d2e11';
const NONCE = `0x${'ab'.repeat(32)}`;

const owner = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const stranger = privateKeyToAccount(
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
);
const COUPON = {
  id: 'cpn-1',
  userId: USER,
  code: 'AAAA-BBBB-CCCC-DDDD',
  paymentRef: '0xref',
  amount: '1000000000000000000',
};

interface IWorld {
  coupon?: typeof COUPON & { claimable?: boolean };
  wallet?: string | null;
  lastClaimAt?: Date | null;
  duplicateClaim?: boolean;
  challengeSpent?: boolean;
}

function fakeEm(world: IWorld) {
  const saved: Partial<ClaimEntity>[] = [];
  const couponUpdates: string[] = [];

  const em = {
    saved,
    couponUpdates,
    query: async (sql: string): Promise<any[]> => {
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('FROM claims c')) {
        return world.lastClaimAt ? [{ at: world.lastClaimAt }] : [];
      }
      if (sql.includes('UPDATE coupons')) {
        const ok = world.coupon && world.coupon.claimable !== false;
        if (ok) couponUpdates.push(ECouponStatus.PENDING_ATTESTATION);
        return ok ? [{ id: world.coupon!.id }] : [];
      }
      if (sql.includes('FROM wallets')) {
        if (world.wallet === null) return [];
        return [{ address: world.wallet ?? owner.address }];
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
    findOne: async (
      _entity: unknown,
      opts: { where: Record<string, string> },
    ) => {
      if (!world.coupon) return null;
      const { id, userId, code } = opts.where;
      if (id)
        return id === world.coupon.id && userId === world.coupon.userId
          ? world.coupon
          : null;
      return code === world.coupon.code ? world.coupon : null;
    },
    create: (_entity: unknown, data: Partial<ClaimEntity>) => ({
      id: 'clm-1',
      ...data,
    }),
    save: async (claim: Partial<ClaimEntity>) => {
      if (world.duplicateClaim) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      saved.push(claim);
      return claim;
    },
  };
  return em;
}

function build(world: IWorld = {}) {
  const em = fakeEm(world);
  const attestations = { count: jest.fn().mockResolvedValue(0) };
  const settlements = { findOne: jest.fn().mockResolvedValue(null) };
  const claims = {
    manager: {
      transaction: (cb: (m: any) => Promise<unknown>) => cb(em),
    },
    createQueryBuilder: jest.fn(),
  };
  const challenges = {
    delete: jest.fn(),
    save: jest.fn(async (row: Record<string, unknown>) => ({
      id: CHALLENGE_ID,
      ...row,
    })),
    create: jest.fn((row: Record<string, unknown>) => row),
    createQueryBuilder: () => {
      const qb: any = {
        execute: async () => ({
          raw: world.challengeSpent ? [] : [{ nonce: NONCE }],
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
  const wallets = { confirmOwnership: jest.fn().mockResolvedValue(undefined) };
  const idempotency = {
    run: jest.fn(
      (
        _u: string,
        _k: string,
        _h: string,
        work: (m: any) => Promise<unknown>,
      ) => work(em),
    ),
  };
  const confirmations = { confirmations: jest.fn().mockResolvedValue(3) };
  const config = {
    get: (key: string) =>
      ({
        REWARD_CHAIN_ID: 11155111,
        ATTESTATION_THRESHOLD: 2,
        CLAIM_COOLDOWN_HOURS: 24,
        CLAIM_DEADLINE_SECONDS: 3600,
        CLAIM_SWEEP_INTERVAL_MS: 0,
      })[key],
  };

  const service = new ClaimsService(
    claims as never,
    attestations as never,
    settlements as never,
    challenges as never,
    wallets as never,
    idempotency as never,
    confirmations as never,
    config as never,
  );
  return {
    service,
    em,
    claims,
    attestations,
    settlements,
    idempotency,
    challenges,
    wallets,
  };
}

describe('ClaimsService.create', () => {
  const ok: IWorld = { coupon: COUPON };
  let signature: string;
  let foreignSignature: string;

  beforeAll(async () => {
    const message = claimMessage(NONCE, COUPON.code);
    signature = await owner.signMessage({ message });
    foreignSignature = await stranger.signMessage({ message });
  });

  const signed = (over: Record<string, unknown> = {}) => ({
    couponId: COUPON.id,
    challengeId: CHALLENGE_ID,
    signature,
    ...over,
  });

  it('creates one claim carrying the coupon paymentRef and amount unchanged', async () => {
    const { service, em } = build({ ...ok });

    const result = await service.create(USER, signed(), KEY);

    expect(result).toMatchObject({
      claimId: 'clm-1',
      couponId: COUPON.id,
      status: EClaimStatus.PENDING_ATTESTATION,
      paymentRef: COUPON.paymentRef,
      amount: COUPON.amount,
    });
    // Recipient resolved server-side and frozen on the claim.
    expect(em.saved[0]).toMatchObject({
      recipient: owner.address,
      amount: COUPON.amount,
      chainId: 11155111,
    });
    // The coupon moved with the claim, in the same transaction.
    expect(em.couponUpdates).toEqual([ECouponStatus.PENDING_ATTESTATION]);
  });

  it('routes the request through the idempotency key it was given', async () => {
    const { service, idempotency } = build({ ...ok });

    await service.create(USER, signed(), ` ${KEY} `);

    expect(idempotency.run).toHaveBeenCalledWith(
      USER,
      KEY,
      expect.any(String),
      expect.any(Function),
    );
  });

  it('refuses a request with no Idempotency-Key', async () => {
    const { service } = build({ ...ok });
    await expect(service.create(USER, signed(), undefined)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses both identifiers at once, and neither', async () => {
    const { service } = build({ ...ok });
    await expect(
      service.create(USER, signed({ code: COUPON.code }), KEY),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create(USER, signed({ couponId: undefined }), KEY),
    ).rejects.toThrow(BadRequestException);
  });

  it('resolves a manually typed code however the user grouped it', async () => {
    const { service } = build({ ...ok });
    const result = await service.create(
      USER,
      // Typed without dashes and in lower case: the signature is over the
      // canonical code, so the same signature still works.
      signed({ couponId: undefined, code: 'aaaabbbbccccdddd' }),
      KEY,
    );
    expect(result.couponId).toBe(COUPON.id);
  });

  it("404s on another user's coupon rather than 403", async () => {
    const { service } = build({ ...ok });
    await expect(service.create(OTHER_USER, signed(), KEY)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409s when the coupon is no longer claimable — the state change is the check', async () => {
    const { service, em } = build({
      coupon: { ...COUPON, claimable: false },
    });

    await expect(service.create(USER, signed(), KEY)).rejects.toThrow(
      ConflictException,
    );
    expect(em.saved).toHaveLength(0);
  });

  it('409s when a concurrent claim already took the coupon', async () => {
    const { service } = build({ ...ok, duplicateClaim: true });
    await expect(service.create(USER, signed(), KEY)).rejects.toThrow(
      ConflictException,
    );
  });

  it('404s WALLET_NOT_LINKED when the user has no verified EVM wallet', async () => {
    const { service, em } = build({ coupon: COUPON, wallet: null });
    await expect(service.create(USER, signed(), KEY)).rejects.toThrow(
      NotFoundException,
    );
    expect(em.saved).toHaveLength(0);
  });

  it('refuses a signature from an address that is not the payout wallet', async () => {
    const { service, em, wallets } = build({ ...ok });

    await expect(
      service.create(USER, signed({ signature: foreignSignature }), KEY),
    ).rejects.toThrow(BadRequestException);
    expect(em.saved).toHaveLength(0);
    expect(wallets.confirmOwnership).not.toHaveBeenCalled();
  });

  it('refuses a spent or expired challenge', async () => {
    const { service, em } = build({ ...ok, challengeSpent: true });

    await expect(service.create(USER, signed(), KEY)).rejects.toThrow(
      BadRequestException,
    );
    expect(em.saved).toHaveLength(0);
  });

  it('marks the proven address verified — a signature outranks a declaration', async () => {
    const { service, wallets } = build({ ...ok });

    await service.create(USER, signed(), KEY);

    expect(wallets.confirmOwnership).toHaveBeenCalledWith(
      expect.anything(),
      USER,
      owner.address,
    );
  });

  it('429-equivalent: refuses a second claim inside the cooldown, with nextClaimAt', async () => {
    const { service, em } = build({
      ...ok,
      lastClaimAt: new Date(Date.now() - 60_000),
    });

    await expect(service.create(USER, signed(), KEY)).rejects.toMatchObject({
      status: 429,
      response: {
        error: {
          code: 'CLAIM_COOLDOWN',
          details: { nextClaimAt: expect.any(String) },
        },
      },
    });
    expect(em.saved).toHaveLength(0);
  });

  it('lets a claim through once the cooldown has elapsed', async () => {
    const { service } = build({
      ...ok,
      lastClaimAt: new Date(Date.now() - 25 * 3_600_000),
    });
    await expect(service.create(USER, signed(), KEY)).resolves.toMatchObject({
      claimId: 'clm-1',
    });
  });
});

describe('ClaimsService.findById', () => {
  function withClaim(claim: unknown) {
    const built = build();
    const qb = {
      innerJoinAndSelect: () => qb,
      where: () => qb,
      andWhere: () => qb,
      getOne: async () => claim,
    };
    built.claims.createQueryBuilder.mockReturnValue(qb);
    return built;
  }

  const claim = {
    id: 'clm-1',
    couponId: COUPON.id,
    status: EClaimStatus.PENDING_ATTESTATION,
    chainId: 11155111,
    txHash: null,
    amount: COUPON.amount,
    failureReason: null,
    updatedAt: new Date('2026-08-03T10:00:00.000Z'),
    coupon: { paymentRef: COUPON.paymentRef },
  };

  it('exposes attestation progress so the app can show "1 of K"', async () => {
    const built = withClaim(claim);
    built.attestations.count.mockResolvedValue(1);

    const result = await built.service.findById(USER, 'clm-1');

    expect(result).toMatchObject({
      claimId: 'clm-1',
      status: EClaimStatus.PENDING_ATTESTATION,
      paymentRef: COUPON.paymentRef,
      amount: COUPON.amount,
      attestations: { have: 1, need: 2 },
      confirmations: null,
      updatedAt: '2026-08-03T10:00:00.000Z',
    });
  });

  it('counts confirmations once the settlement event has been seen', async () => {
    const built = withClaim({ ...claim, status: EClaimStatus.CLAIM_SUBMITTED });
    built.settlements.findOne.mockResolvedValue({ blockNumber: 100 });

    const result = await built.service.findById(USER, 'clm-1');

    expect(result.confirmations).toBe(3);
  });

  it("404s on another user's claim rather than 403", async () => {
    const built = withClaim(null);
    await expect(built.service.findById(USER, 'clm-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ClaimsService state machine', () => {
  function withUpdate(couponId: string | undefined) {
    const built = build();
    const qb: any = {
      execute: async () => ({ raw: couponId ? [{ coupon_id: couponId }] : [] }),
    };
    qb.update = () => qb;
    qb.set = jest.fn(() => qb);
    qb.where = () => qb;
    qb.andWhere = jest.fn(() => qb);
    qb.returning = () => qb;
    const em = {
      createQueryBuilder: () => qb,
      query: jest.fn().mockResolvedValue([]),
    };
    built.claims.manager.transaction = (cb: (m: unknown) => Promise<unknown>) =>
      cb(em);
    return { ...built, qb, em };
  }

  it('marks a claim ATTESTED only once the threshold is met', async () => {
    const built = withUpdate(COUPON.id);
    built.attestations.count.mockResolvedValue(1);

    await built.service.markAttested('clm-1');
    expect(built.qb.set).not.toHaveBeenCalled();

    built.attestations.count.mockResolvedValue(2);
    await built.service.markAttested('clm-1');
    expect(built.qb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: EClaimStatus.ATTESTED }),
    );
  });

  it('fails terminally: stores the reason, releases the coupon, raises an alert', async () => {
    const built = withUpdate(COUPON.id);
    const logged: string[] = [];
    jest
      .spyOn(built.service['logger'], 'error')
      .mockImplementation((msg) => logged.push(String(msg)));

    await built.service.fail('clm-1', EClaimFailureReason.ATTESTATION_REJECTED);

    expect(built.qb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: EClaimStatus.FAILED,
        failureReason: EClaimFailureReason.ATTESTATION_REJECTED,
      }),
    );
    // The coupon goes back to ISSUED — the user is not left holding a dead one.
    expect(built.em.query).toHaveBeenCalledWith(expect.any(String), [
      ECouponStatus.ISSUED,
      COUPON.id,
    ]);
    expect(logged.join()).toContain('security_event=claim.failed');
  });

  it('does not alert or touch the coupon when the claim was already terminal', async () => {
    const built = withUpdate(undefined);
    const logged: string[] = [];
    jest
      .spyOn(built.service['logger'], 'error')
      .mockImplementation((msg) => logged.push(String(msg)));

    await built.service.fail('clm-1', EClaimFailureReason.ATTESTATION_REJECTED);

    expect(built.em.query).not.toHaveBeenCalled();
    expect(logged).toHaveLength(0);
  });

  it('only advances from the legal predecessor state', async () => {
    const built = withUpdate(COUPON.id);

    await built.service.markSubmitted('clm-1', '0xtx', 7);

    expect(built.qb.andWhere).toHaveBeenCalledWith('status IN (:...from)', {
      from: [EClaimStatus.ATTESTED],
    });
    expect(built.qb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: EClaimStatus.CLAIM_SUBMITTED,
        txHash: '0xtx',
        txNonce: 7,
      }),
    );
  });
});
