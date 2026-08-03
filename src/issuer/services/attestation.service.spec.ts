import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { EClaimStatus } from '@/claims/enums/claim-status.enum';
import { ENTITLEMENT_TYPES, entitlementDomain } from '@/issuer/entitlement';
import type { IssuerConfig } from '@/issuer/issuer-config';
import { AttestationService } from '@/issuer/services/attestation.service';
import { VerificationError } from '@/common/chain/payment-verifier.service';
import { createIssuerSigner, type WdkLoader } from '@/issuer/signer';

const KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const CONTRACT = '0x5Dfc68FD44CCD83DD10cF5aA4B060AAe1602fb13';
const CHAIN_ID = 11155111;
const USER = 'user-1';
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const PAYMENT_REF =
  '0x07929c9918f907be174b61694275e3c084db7007b1f05f62d6d0975577377466';

const GOLDEN: {
  vectors: {
    note: string;
    paymentAmount: string;
    asset: string;
    assetUsdPrice: string;
    utlUsdRate: string;
    cashbackBps: number;
    amount: string;
  }[];
} = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../test/fixtures/accrual/golden-amounts.json'),
    'utf8',
  ),
);

const USDT_VECTOR = GOLDEN.vectors.find(
  (v) => v.asset === 'USDT' && v.utlUsdRate === '1' && v.cashbackBps === 500,
)!;

/**
 * Jest's CommonJS runtime cannot import the ESM `@tetherto/wdk-wallet-evm`, so
 * these tests drive the same code path with a stand-in account. The real WDK
 * signer is exercised by `npm run verify:signer` under plain node.
 */
function fakeWdk(): WdkLoader {
  return async () => ({
    WalletAccountEvm: {
      fromPrivateKey(key: string) {
        const account = privateKeyToAccount(key as `0x${string}`);
        return {
          getAddress: async () => account.address,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          signTypedData: (data: any) =>
            account.signTypedData({ ...data, primaryType: 'Entitlement' }),
          signTransaction: async () => {
            throw new Error('an issuer key never signs a transaction');
          },
        };
      },
    },
  });
}

const PAID_AT = new Date('2026-04-06T14:28:36.000Z');

interface IWorld {
  snapshotPrice?: string;
  snapshotAt?: Date;
  ownPrice?: string;
  claimAmount?: string;
  wallet?: string | null;
  recentClaim?: boolean;
  alreadyAttested?: number;
  verifyError?: string;
}

function build(world: IWorld = {}) {
  const signer = createIssuerSigner(`env:${KEY}`, {
    allowPlaintextKey: true,
    loadWdk: fakeWdk(),
  });
  const config = {
    id: 'issuer-a',
    chainId: CHAIN_ID,
    verifyingContract: CONTRACT,
    toleranceBps: 100,
    priceWindowSeconds: 6 * 3600,
    cooldownHours: 24,
    utlUsdRate: USDT_VECTOR.utlUsdRate,
    cashbackBps: USDT_VECTOR.cashbackBps,
    priceProvider: 'bitfinex',
    signer,
  } as unknown as IssuerConfig;

  const inserted: Record<string, unknown>[] = [];
  const attestations = {
    insert: jest.fn(async (row: Record<string, unknown>) => {
      if (inserted.some((r) => r.claimId === row.claimId)) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      inserted.push(row);
    }),
    createQueryBuilder: () => {
      const qb = {
        innerJoin: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getCount: async () => world.alreadyAttested ?? 0,
      };
      return qb;
    },
  };

  const verifier = {
    verify: jest.fn(async () => {
      if (world.verifyError) throw new VerificationError(world.verifyError);
    }),
  };

  const bitfinex = {
    priceAt: jest.fn(async () => ({
      price: world.ownPrice ?? USDT_VECTOR.assetUsdPrice,
      source: 'bitfinex',
      providerTimestamp: PAID_AT,
    })),
  };

  const service = new AttestationService(
    config,
    verifier as never,
    bitfinex as never,
    { priceAt: jest.fn() } as never,
    attestations as never,
    {
      findOne: async () => ({
        paymentRef: PAYMENT_REF,
        srcChainId: CHAIN_ID,
        token: 'usdt',
        amount: USDT_VECTOR.paymentAmount,
        transferredAt: PAID_AT,
        userId: USER,
      }),
    } as never,
    { find: async () => [] } as never,
    {
      findOne: async () => ({
        price: world.snapshotPrice ?? USDT_VECTOR.assetUsdPrice,
        providerTimestamp: world.snapshotAt ?? PAID_AT,
      }),
    } as never,
    {
      findOne: async () =>
        world.wallet === null ? null : { address: world.wallet ?? RECIPIENT },
    } as never,
    {
      query: async () => (world.recentClaim ? [{ id: 'clm-old' }] : []),
    } as never,
  );

  const claim = {
    id: 'clm-1',
    couponId: 'cpn-1',
    recipient: RECIPIENT,
    amount: world.claimAmount ?? USDT_VECTOR.amount,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    chainId: CHAIN_ID,
    status: EClaimStatus.PENDING_ATTESTATION,
    coupon: { paymentRef: PAYMENT_REF, userId: USER },
  };

  return { service, claim: claim as never, inserted, attestations, signer };
}

describe('AttestationService', () => {
  it('signs an entitlement recoverable to this issuer, one row per claim', async () => {
    const { service, claim, inserted, signer } = build();

    const outcome = await service.attest(claim);

    expect(outcome).toEqual({ signed: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      claimId: 'clm-1',
      issuerAddress: privateKeyToAccount(KEY).address,
      chainId: String(CHAIN_ID),
    });

    const recovered = await recoverTypedDataAddress({
      domain: entitlementDomain({
        chainId: CHAIN_ID,
        verifyingContract: CONTRACT,
      }),
      types: ENTITLEMENT_TYPES,
      primaryType: 'Entitlement',
      message: {
        recipient: RECIPIENT,
        amount: BigInt(USDT_VECTOR.amount),
        paymentRef: PAYMENT_REF,
        deadline: BigInt((claim as unknown as { deadline: number }).deadline),
      },
      signature: inserted[0].signature as `0x${string}`,
    });
    expect(recovered).toBe(signer.address);
  });

  it('is idempotent on the UNIQUE (claim_id, issuer_address) constraint', async () => {
    const { service, claim, inserted } = build();

    await service.attest(claim);
    await expect(service.attest(claim)).resolves.toEqual({ signed: true });

    expect(inserted).toHaveLength(1);
  });

  it('reproduces the BE-09 golden amount byte for byte', async () => {
    for (const vector of GOLDEN.vectors.filter((v) => v.asset === 'USDT')) {
      const { service, claim } = build();
      const config = service['config'] as unknown as {
        utlUsdRate: string;
        cashbackBps: number;
      };
      config.utlUsdRate = vector.utlUsdRate;
      config.cashbackBps = vector.cashbackBps;

      const payments = service['payments'] as unknown as {
        findOne: () => Promise<unknown>;
      };
      payments.findOne = async () => ({
        paymentRef: PAYMENT_REF,
        srcChainId: CHAIN_ID,
        token: 'usdt',
        amount: vector.paymentAmount,
        transferredAt: PAID_AT,
        userId: USER,
      });
      const snapshots = service['snapshots'] as unknown as {
        findOne: () => Promise<unknown>;
      };
      snapshots.findOne = async () => ({
        price: vector.assetUsdPrice,
        providerTimestamp: PAID_AT,
      });
      const bitfinex = service['bitfinex'] as unknown as {
        priceAt: () => Promise<unknown>;
      };
      bitfinex.priceAt = async () => ({
        price: vector.assetUsdPrice,
        source: 'bitfinex',
        providerTimestamp: PAID_AT,
      });
      (claim as unknown as { amount: string }).amount = vector.amount;

      await expect(service.attest(claim)).resolves.toEqual({ signed: true });
    }
  });

  it('refuses an amount that is one wei off the recomputation', async () => {
    const { service, claim, inserted } = build({
      claimAmount: (BigInt(USDT_VECTOR.amount) + 1n).toString(),
    });

    const outcome = await service.attest(claim);

    expect(outcome.signed).toBe(false);
    expect(outcome.reason).toMatch(/AMOUNT_MISMATCH/);
    expect(inserted).toHaveLength(0);
  });

  it('accepts a snapshot inside the tolerance band', async () => {
    // +0.5 % — the snapshot and this issuer's provider are not the same feed.
    const { service, claim } = build({
      ownPrice: '1',
      snapshotPrice: '1.005',
      claimAmount: '502500000000000',
    });
    await expect(service.attest(claim)).resolves.toEqual({ signed: true });
  });

  it('refuses a snapshot outside the tolerance band', async () => {
    const { service, claim, inserted } = build({
      ownPrice: '1',
      snapshotPrice: '1.02',
    });

    const outcome = await service.attest(claim);

    expect(outcome.signed).toBe(false);
    expect(outcome.reason).toMatch(/PRICE_OUT_OF_BAND/);
    expect(inserted).toHaveLength(0);
  });

  it("refuses a snapshot timestamped outside the payment's window", async () => {
    const { service, claim } = build({
      snapshotAt: new Date(PAID_AT.getTime() + 8 * 3600_000),
    });

    const outcome = await service.attest(claim);

    expect(outcome.signed).toBe(false);
    expect(outcome.reason).toMatch(/PRICE_WINDOW/);
  });

  it('refuses when the recipient is not the mapped wallet', async () => {
    const { service, claim } = build({
      wallet: '0x2222222222222222222222222222222222222222',
    });

    const outcome = await service.attest(claim);

    expect(outcome.signed).toBe(false);
    expect(outcome.reason).toMatch(/RECIPIENT_MISMATCH/);
  });

  it('refuses when the user has no verified wallet at all', async () => {
    const { service, claim } = build({ wallet: null });
    await expect(service.attest(claim)).resolves.toMatchObject({
      signed: false,
      reason: expect.stringMatching(/NO_WALLET/),
    });
  });

  it('re-checks the rate limit itself rather than trusting the API', async () => {
    const { service, claim } = build({ recentClaim: true });

    const outcome = await service.attest(claim);

    expect(outcome.signed).toBe(false);
    expect(outcome.reason).toMatch(/RATE_LIMIT/);
  });

  it('refuses to sign twice for one payment, whatever the claim id', async () => {
    const { service, claim } = build({ alreadyAttested: 1 });

    const outcome = await service.attest(claim);

    expect(outcome.signed).toBe(false);
    expect(outcome.reason).toMatch(/ALREADY_ATTESTED/);
  });

  it('passes the chain verifier disagreement straight through', async () => {
    const { service, claim, inserted } = build({
      verifyError: 'REORG: block hash no longer canonical',
    });

    const outcome = await service.attest(claim);

    expect(outcome.signed).toBe(false);
    expect(outcome.reason).toMatch(/REORG/);
    expect(inserted).toHaveLength(0);
  });
});
