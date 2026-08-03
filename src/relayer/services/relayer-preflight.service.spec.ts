import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

import { ENTITLEMENT_TYPES, entitlementDomain } from '@/issuer/entitlement';
import type { RelayerConfig } from '@/relayer/relayer-config';
import {
  AlreadySettledError,
  PreflightError,
  RelayerPreflightService,
} from '@/relayer/services/relayer-preflight.service';

const CONTRACT = '0x5Dfc68FD44CCD83DD10cF5aA4B060AAe1602fb13';
const CHAIN_ID = 11155111;
const ISSUER_ROLE = `0x${'11'.repeat(32)}` as Hex;
const PAYMENT_REF =
  '0x07929c9918f907be174b61694275e3c084db7007b1f05f62d6d0975577377466';
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const AMOUNT = '5000000000000000000';
const DEADLINE = Math.floor(Date.now() / 1000) + 3600;

const ISSUER_A = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const ISSUER_B = privateKeyToAccount(
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
);

const claim = {
  id: 'clm-1',
  recipient: RECIPIENT,
  amount: AMOUNT,
  deadline: DEADLINE,
  chainId: CHAIN_ID,
  coupon: { paymentRef: PAYMENT_REF },
} as never;

const message = {
  recipient: RECIPIENT as Hex,
  amount: BigInt(AMOUNT),
  paymentRef: PAYMENT_REF as Hex,
  deadline: BigInt(DEADLINE),
};

async function sign(account: typeof ISSUER_A): Promise<Hex> {
  return account.signTypedData({
    domain: entitlementDomain({
      chainId: CHAIN_ID,
      verifyingContract: CONTRACT,
    }),
    types: ENTITLEMENT_TYPES,
    primaryType: 'Entitlement',
    message,
  });
}

interface IChain {
  paused?: boolean;
  nullifierUsed?: boolean;
  threshold?: bigint;
  perClaimCap?: bigint;
  epochCap?: bigint;
  minted?: bigint;
  issuers?: string[];
}

function build(chain: IChain = {}) {
  const config = {
    verifyingContract: CONTRACT,
    deadlineMarginSeconds: 120,
  } as unknown as RelayerConfig;

  const issuers = (chain.issuers ?? [ISSUER_A.address, ISSUER_B.address]).map(
    (a) => a.toLowerCase(),
  );

  const client = {
    readContract: async ({
      functionName,
      args,
    }: {
      functionName: string;
      args?: readonly unknown[];
    }) => {
      switch (functionName) {
        case 'paused':
          return chain.paused ?? false;
        case 'nullifierUsed':
          return chain.nullifierUsed ?? false;
        case 'threshold':
          return chain.threshold ?? 2n;
        case 'perClaimCap':
          return chain.perClaimCap ?? 100n * 10n ** 18n;
        case 'epochCap':
          return chain.epochCap ?? 1000n * 10n ** 18n;
        case 'currentEpoch':
          return 20_000n;
        case 'mintedInEpoch':
          return chain.minted ?? 0n;
        case 'ISSUER_ROLE':
          return ISSUER_ROLE;
        case 'hasRole':
          return issuers.includes(String(args?.[1]).toLowerCase());
        default:
          throw new Error(`unexpected call: ${functionName}`);
      }
    },
  };

  return {
    service: new RelayerPreflightService(config),
    client: client as never,
  };
}

describe('RelayerPreflightService', () => {
  let sigA: Hex;
  let sigB: Hex;

  beforeAll(async () => {
    sigA = await sign(ISSUER_A);
    sigB = await sign(ISSUER_B);
  });

  const attestations = () =>
    [
      { issuerAddress: ISSUER_A.address, signature: sigA },
      { issuerAddress: ISSUER_B.address, signature: sigB },
    ] as never;

  it('returns signatures sorted strictly ascending by signer', async () => {
    const { service, client } = build();

    const { signatures, signers } = await service.check(
      client,
      claim,
      attestations(),
    );

    expect(signatures).toHaveLength(2);
    const ordered = [...signers].sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : 1,
    );
    expect(signers).toEqual(ordered);
    expect(BigInt(signers[0])).toBeLessThan(BigInt(signers[1]));
  });

  it('drops a duplicate signer rather than letting it fill the threshold', async () => {
    const { service, client } = build({ threshold: 2n });

    await expect(
      service.check(client, claim, [
        { issuerAddress: ISSUER_A.address, signature: sigA },
        { issuerAddress: ISSUER_A.address, signature: sigA },
      ] as never),
    ).rejects.toThrow(/NOT_ENOUGH_SIGNATURES/);
  });

  it('drops a signature from an address the contract no longer accepts', async () => {
    const { service, client } = build({
      issuers: [ISSUER_A.address],
      threshold: 2n,
    });

    await expect(service.check(client, claim, attestations())).rejects.toThrow(
      /NOT_ENOUGH_SIGNATURES/,
    );
  });

  it('drops a signature that does not recover to the issuer we recorded', async () => {
    const { service, client } = build({ threshold: 2n });

    await expect(
      service.check(client, claim, [
        { issuerAddress: ISSUER_A.address, signature: sigA },
        // B's signature filed under someone else's name.
        { issuerAddress: RECIPIENT, signature: sigB },
      ] as never),
    ).rejects.toThrow(/NOT_ENOUGH_SIGNATURES/);
  });

  it('refuses locally when the amount exceeds perClaimCap', async () => {
    const { service, client } = build({ perClaimCap: 1n });

    await expect(service.check(client, claim, attestations())).rejects.toThrow(
      /EXCEEDS_PER_CLAIM_CAP/,
    );
  });

  it('refuses locally when the epoch budget is spent', async () => {
    const { service, client } = build({
      epochCap: 10n * 10n ** 18n,
      minted: 8n * 10n ** 18n,
    });

    await expect(service.check(client, claim, attestations())).rejects.toThrow(
      /EXCEEDS_EPOCH_CAP/,
    );
  });

  it('refuses to submit into a paused contract', async () => {
    const { service, client } = build({ paused: true });

    await expect(service.check(client, claim, attestations())).rejects.toThrow(
      PreflightError,
    );
  });

  it('treats an already-nullified payment as settled, not as a failure', async () => {
    const { service, client } = build({ nullifierUsed: true });

    await expect(service.check(client, claim, attestations())).rejects.toThrow(
      AlreadySettledError,
    );
  });

  it('refuses an entitlement too close to its deadline to land', async () => {
    const { service, client } = build();
    const expiring = {
      ...(claim as unknown as Record<string, unknown>),
      deadline: Math.floor(Date.now() / 1000) + 30,
    } as never;

    await expect(
      service.check(client, expiring, attestations()),
    ).rejects.toThrow(/DEADLINE_TOO_CLOSE/);
  });
});
