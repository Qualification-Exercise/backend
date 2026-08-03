import { privateKeyToAddress } from 'viem/accounts';
import type { Hex } from 'viem';

import { decryptSecret, isEncryptedSecret } from '@/common/crypto/secret-box';

export class SigningKeyError extends Error {}

export interface ITypedDataRequest {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  message: Record<string, unknown>;
}

export interface IUnsignedTransaction {
  chainId: number;
  nonce: number;
  to: Hex;
  data: Hex;
  value?: bigint;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  type: number;
}

export interface IWdkSigner {
  readonly address: Hex;
  signTypedData(request: ITypedDataRequest): Promise<Hex>;
  signTransaction(tx: IUnsignedTransaction): Promise<Hex>;
}

export interface IWdkAccount {
  getAddress(): Promise<string>;
  signTypedData(request: ITypedDataRequest): Promise<string>;
  signTransaction(tx: unknown): Promise<string>;
}

export interface IWdkModule {
  WalletAccountEvm: { fromPrivateKey(key: string): IWdkAccount };
}

export type WdkLoader = () => Promise<IWdkModule>;

/**
 * `@tetherto/wdk-wallet-evm` is ESM; this package compiles to CommonJS, and TS
 * would rewrite a plain `import()` into `require()`. The indirection keeps it a
 * real dynamic import at runtime.
 */
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

const loadWdkModule: WdkLoader = () =>
  importEsm('@tetherto/wdk-wallet-evm') as Promise<IWdkModule>;

class WdkKeySigner implements IWdkSigner {
  readonly address: Hex;
  private account?: Promise<IWdkAccount>;

  constructor(
    private readonly privateKey: Hex,
    private readonly load: WdkLoader = loadWdkModule,
  ) {
    this.address = privateKeyToAddress(privateKey);
  }

  async signTypedData(request: ITypedDataRequest): Promise<Hex> {
    const account = await this.wdkAccount();
    return (await account.signTypedData(request)) as Hex;
  }

  async signTransaction(tx: IUnsignedTransaction): Promise<Hex> {
    const account = await this.wdkAccount();
    return (await account.signTransaction(tx)) as Hex;
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
      throw new SigningKeyError(
        `Key mismatch: WDK derived ${address}, expected ${this.address}`,
      );
    }
    return account;
  }
}

export interface ISignerOptions {
  password?: string;
  allowPlaintextKey?: boolean;
  loadWdk?: WdkLoader;
}

/**
 * Three ways to name a key, in descending order of how much they deserve trust:
 *
 * `kms:<arn>` — production. Deliberately not implemented rather than faked: a
 * stub that silently signed locally would make an insecure deployment look
 * secure.
 *
 * `enc:argon2id$…` — the key encrypted under an Argon2id KEK derived from
 * `SIGNER_KEY_PASSWORD`. What ships for the demo.
 *
 * `env:0x…` — the raw key in the environment. Refused outside development: a
 * key readable by anything that can read the process is not a key that is being
 * protected.
 *
 * ponytail: add the KMS signer when a real key exists — it is an `IWdkSigner`
 * with a `KMS.sign` call and secp256k1 `v` recovery, and nothing above this
 * file changes.
 */
export function createWdkSigner(
  keyRef: string,
  options: ISignerOptions = {},
): IWdkSigner {
  const separator = keyRef.indexOf(':');
  const scheme = separator === -1 ? '' : keyRef.slice(0, separator);
  const value = keyRef.slice(separator + 1);

  if (scheme === 'kms') {
    throw new SigningKeyError(
      'kms: signing is not implemented in this build; configure enc: for the demo',
    );
  }

  if (scheme === 'enc') {
    if (!isEncryptedSecret(value)) {
      throw new SigningKeyError('enc: value must be an argon2id$… blob');
    }
    if (!options.password) {
      throw new SigningKeyError(
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
      throw new SigningKeyError(
        'env: plaintext keys are refused outside development; use enc:',
      );
    }
    return new WdkKeySigner(assertPrivateKey(value), options.loadWdk);
  }

  throw new SigningKeyError(
    `Signing key must start with kms:, enc: or env:, got "${scheme}"`,
  );
}

function assertPrivateKey(value: string): Hex {
  const key = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new SigningKeyError('Signing key must be a 32-byte hex private key');
  }
  return key as Hex;
}
