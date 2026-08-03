import { privateKeyToAddress } from 'viem/accounts';
import type { Hex } from 'viem';

import { decryptSecret, isEncryptedSecret } from '@/common/crypto/secret-box';
import {
  ENTITLEMENT_TYPES,
  entitlementDomain,
  type IEntitlement,
  type IEntitlementDomain,
} from '@/issuer/entitlement';

export class IssuerKeyError extends Error {}

export interface IIssuerSigner {
  readonly address: Hex;
  signEntitlement(
    domain: IEntitlementDomain,
    entitlement: IEntitlement,
  ): Promise<Hex>;
}

const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<Record<string, unknown>>;

export interface IWdkModule {
  WalletAccountEvm: { fromPrivateKey(key: string): IWdkAccount };
}

export type WdkLoader = () => Promise<IWdkModule>;

const loadWdkModule: WdkLoader = () =>
  importEsm('@tetherto/wdk-wallet-evm') as unknown as Promise<IWdkModule>;

export interface IWdkAccount {
  getAddress(): Promise<string>;
  signTypedData(data: {
    domain: unknown;
    types: unknown;
    message: unknown;
  }): Promise<string>;
}

class WdkKeySigner implements IIssuerSigner {
  readonly address: Hex;
  private account?: Promise<IWdkAccount>;

  constructor(
    private readonly privateKey: Hex,
    private readonly load: WdkLoader = loadWdkModule,
  ) {
    this.address = privateKeyToAddress(privateKey);
  }

  async signEntitlement(
    domain: IEntitlementDomain,
    entitlement: IEntitlement,
  ): Promise<Hex> {
    const account = await this.wdkAccount();
    const signature = await account.signTypedData({
      domain: entitlementDomain(domain),
      types: ENTITLEMENT_TYPES,
      message: entitlement,
    });
    return signature as Hex;
  }

  private wdkAccount(): Promise<IWdkAccount> {
    this.account ??= this.buildAccount();
    return this.account;
  }

  private async buildAccount(): Promise<IWdkAccount> {
    const module = await this.load();
    const account = module.WalletAccountEvm.fromPrivateKey(this.privateKey);

    const address = (await account.getAddress()) as Hex;
    if (address.toLowerCase() !== this.address.toLowerCase()) {
      throw new IssuerKeyError(
        `Key mismatch: WDK derived ${address}, expected ${this.address}`,
      );
    }
    return account;
  }
}

/**
 * Three ways to name a key, in descending order of how much they should be
 * trusted:
 *
 * `kms:<arn>` — production. Deliberately not implemented rather than faked: a
 * stub that silently signed locally would make an insecure deployment look
 * secure.
 *
 * `enc:argon2id$…` — the key encrypted under an Argon2id KEK derived from
 * `SIGNER_KEY_PASSWORD`. What ships for the demo.
 *
 * `env:0x…` — the raw key in the environment. Refused outside development,
 * because a key that is readable by anything that can read the process is not
 * a key that is being protected.
 *
 * ponytail: add the KMS signer when a real key exists — it is an
 * `IIssuerSigner` with a `KMS.sign` call and secp256k1 `v` recovery, and
 * nothing above this file changes.
 */
export function createIssuerSigner(
  keyRef: string,
  options: {
    password?: string;
    allowPlaintextKey?: boolean;
    /**
     * Overridable only so the unit tests can run: Jest's CommonJS runtime
     * cannot dynamically import an ESM package. The WDK path itself is checked
     * by `npm run verify:signer`, which runs under plain node.
     */
    loadWdk?: WdkLoader;
  } = {},
): IIssuerSigner {
  const separator = keyRef.indexOf(':');
  const scheme = separator === -1 ? '' : keyRef.slice(0, separator);
  const value = keyRef.slice(separator + 1);

  if (scheme === 'kms') {
    throw new IssuerKeyError(
      'kms: signing is not implemented in this build; configure enc: for the demo',
    );
  }

  if (scheme === 'enc') {
    if (!isEncryptedSecret(value)) {
      throw new IssuerKeyError('enc: value must be an argon2id$… blob');
    }
    if (!options.password) {
      throw new IssuerKeyError(
        'SIGNER_KEY_PASSWORD must be set to open an enc: signing key',
      );
    }
    return new WdkKeySigner(
      assertPrivateKey(decryptSecret(value, options.password)),
      options.loadWdk,
    );
  }

  if (scheme === 'env') {
    if (!options.allowPlaintextKey) {
      throw new IssuerKeyError(
        'env: plaintext keys are refused outside development; use enc:',
      );
    }
    return new WdkKeySigner(assertPrivateKey(value), options.loadWdk);
  }

  throw new IssuerKeyError(
    `Signing key must start with kms:, enc: or env:, got "${scheme}"`,
  );
}

function assertPrivateKey(value: string): Hex {
  const key = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new IssuerKeyError('Signing key must be a 32-byte hex private key');
  }
  return key as Hex;
}
