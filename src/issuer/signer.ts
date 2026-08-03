import type { Hex } from 'viem';

import {
  createWdkSigner,
  SigningKeyError,
  type ISignerOptions,
  type WdkLoader,
} from '@/common/signing/wdk-signer';
import {
  ENTITLEMENT_TYPES,
  entitlementDomain,
  type IEntitlement,
  type IEntitlementDomain,
} from '@/issuer/entitlement';

export { SigningKeyError as IssuerKeyError, type WdkLoader };

export interface IIssuerSigner {
  readonly address: Hex;
  signEntitlement(
    domain: IEntitlementDomain,
    entitlement: IEntitlement,
  ): Promise<Hex>;
}

export function createIssuerSigner(
  keyRef: string,
  options: ISignerOptions = {},
): IIssuerSigner {
  const signer = createWdkSigner(keyRef, options);

  return {
    address: signer.address,
    signEntitlement: (domain, entitlement) =>
      signer.signTypedData({
        domain: entitlementDomain(domain) as unknown as Record<string, unknown>,
        types: ENTITLEMENT_TYPES as unknown as Record<string, unknown>,
        message: entitlement as unknown as Record<string, unknown>,
      }),
  };
}
