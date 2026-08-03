import { hashDomain, hashTypedData, type Hex } from 'viem';

/**
 * The EIP-712 entitlement K issuers sign (contracts spec §5.2).
 *
 * No `couponId` — that is a number we pick, and two coupon rows for one payment
 * would give the contract two ids it cannot tell apart. No `nonce`, no user
 * signature: replay is carried by the `paymentRef` nullifier.
 *
 * `chainId` and `verifyingContract` live in the domain, so a signature is valid
 * on exactly one contract on one chain and nowhere else.
 */
export const ENTITLEMENT_TYPES = {
  Entitlement: [
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'paymentRef', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const ENTITLEMENT_DOMAIN_NAME = 'CouponClaim';
export const ENTITLEMENT_DOMAIN_VERSION = '1';

export interface IEntitlement {
  recipient: Hex;
  amount: bigint;
  paymentRef: Hex;
  deadline: bigint;
}

export interface IEntitlementDomain {
  chainId: number;
  verifyingContract: Hex;
}

export function entitlementDomain({
  chainId,
  verifyingContract,
}: IEntitlementDomain) {
  return {
    name: ENTITLEMENT_DOMAIN_NAME,
    version: ENTITLEMENT_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const;
}

const EIP712_DOMAIN_TYPE = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
} as const;

export function entitlementDomainSeparator(domain: IEntitlementDomain): Hex {
  const { chainId, ...rest } = entitlementDomain(domain);
  return hashDomain({
    domain: { ...rest, chainId: BigInt(chainId) },
    types: EIP712_DOMAIN_TYPE,
  });
}

export function entitlementDigest(
  domain: IEntitlementDomain,
  entitlement: IEntitlement,
): Hex {
  return hashTypedData({
    domain: entitlementDomain(domain),
    types: ENTITLEMENT_TYPES,
    primaryType: 'Entitlement',
    message: entitlement,
  });
}
