import {
  validateBitcoinAddress,
  validateEVMAddress,
  validateSparkAddress,
  validateTronAddress,
} from '@tetherto/wdk-utils';
import { base58check } from '@scure/base';
import {
  getAddress,
  recoverMessageAddress,
  sha256,
  verifyMessage,
  type Hex,
  type PublicClient,
} from 'viem';

import { EChainKind } from '@/chains/chain-kind.enum';

export type ChainFamily = 'EVM' | 'TRON' | 'BTC' | 'SPARK';

export const CHAIN_KIND_OF_FAMILY: Record<ChainFamily, EChainKind> = {
  EVM: EChainKind.EVM,
  TRON: EChainKind.TRON,
  BTC: EChainKind.BITCOIN,
  SPARK: EChainKind.SPARK,
};

export const FAMILY_OF_CHAIN_KIND: Record<EChainKind, ChainFamily> = {
  [EChainKind.EVM]: 'EVM',
  [EChainKind.TRON]: 'TRON',
  [EChainKind.BITCOIN]: 'BTC',
  [EChainKind.SPARK]: 'SPARK',
};

export function proofSupported(family: ChainFamily): boolean {
  return family === 'EVM' || family === 'TRON';
}

export interface INormalizedAddress {
  family: ChainFamily;
  address: string;
}

export class InvalidAddressError extends Error {}
export class UnsupportedProofError extends Error {}

const base58c = base58check((bytes: Uint8Array) => sha256(bytes, 'bytes'));

const TRON_HEX_RE = /^(0x)?41[0-9a-fA-F]{40}$/;
const BECH32_RE = /^[a-z0-9]+1[02-9ac-hj-np-z]{6,}$/i;

function classify(address: string): ChainFamily {
  if (validateEVMAddress(address).success) return 'EVM';
  if (validateTronAddress(address).success || TRON_HEX_RE.test(address)) {
    return 'TRON';
  }
  const spark = validateSparkAddress(address);
  if (spark.success && spark.type === 'spark') return 'SPARK';
  if (validateBitcoinAddress(address).success) return 'BTC';
  throw new InvalidAddressError(`Unrecognised address format: ${address}`);
}

function tronFromEvmAddress(evmAddress: Hex): string {
  const body = new Uint8Array(21);
  body[0] = 0x41;
  for (let i = 0; i < 20; i++) {
    body[i + 1] = parseInt(evmAddress.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return base58c.encode(body);
}

function normalizeTron(address: string): string {
  if (TRON_HEX_RE.test(address)) {
    const hex = address.startsWith('0x') ? address.slice(2) : address;
    const base58 = tronFromEvmAddress(`0x${hex.slice(2)}`);
    if (!validateTronAddress(base58).success) {
      throw new InvalidAddressError(`Bad Tron hex address: ${address}`);
    }
    return base58;
  }
  return address;
}

function normalizeBtcLike(address: string): string {
  return BECH32_RE.test(address) ? address.toLowerCase() : address;
}

/**
 * Tron hands back addresses as hex: 21 bytes with a `41` prefix in logs, or a
 * 32-byte topic whose last 20 bytes are the address. Both reduce to the same
 * base58 form the merchant table stores.
 */
export function tronAddressFromHex(hex: string): string {
  const bare = hex.replace(/^0x/, '').toLowerCase();
  if (bare.length < 40) return '';
  const body = bare.slice(-40);
  return tronFromEvmAddress(`0x${body}`);
}

export function normalizeAddress(input: string): INormalizedAddress {
  const address = input.trim();
  const family = classify(address);
  switch (family) {
    case 'EVM':
      return { family, address: getAddress(address) };
    case 'TRON':
      return { family, address: normalizeTron(address) };
    default:
      return { family, address: normalizeBtcLike(address) };
  }
}

export function claimMessage(nonce: string, coupon: string): string {
  return [
    'WDK Cashback: claim coupon',
    `Coupon: ${coupon}`,
    'This signature authorises the payout of this coupon to your wallet. It moves no funds.',
    `Nonce: ${nonce}`,
  ].join('\n');
}

/**
 * `client` turns on smart-account proofs. An ERC-4337 wallet (Safe and friends)
 * signs with its owner EOA, so a plain ecrecover against the account address
 * never matches: the check has to run on chain via ERC-1271. viem's public
 * `verifyMessage` does that, and its deployless validator also covers an
 * ERC-6492-wrapped signature from an account that is still counterfactual.
 * Without a client the EOA path is all there is — the previous behaviour.
 */
export async function verifyOwnership(
  address: string,
  message: string,
  signature: Hex,
  client?: PublicClient,
): Promise<boolean> {
  const { family, address: normalized } = normalizeAddress(address);

  try {
    if (family === 'EVM') {
      const byEoa = await verifyMessage({
        address: normalized as Hex,
        message,
        signature,
      });
      if (byEoa || !client) return byEoa;
      return await client.verifyMessage({
        address: normalized as Hex,
        message,
        signature,
      });
    }
    if (family === 'TRON') {
      const recovered = await recoverMessageAddress({ message, signature });
      return tronFromEvmAddress(recovered) === normalized;
    }
  } catch {
    return false;
  }
  throw new UnsupportedProofError(
    `Ownership proofs for ${family} addresses are not supported yet`,
  );
}
