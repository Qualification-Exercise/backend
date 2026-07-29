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
} from 'viem';

export type ChainFamily = 'EVM' | 'TRON' | 'BTC' | 'SPARK';

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

export function ownershipMessage(nonce: string): string {
  return [
    'WDK Cashback: prove wallet ownership',
    'This signature links this address to your account. It authorises no transfer.',
    `Nonce: ${nonce}`,
  ].join('\n');
}

export async function verifyOwnership(
  address: string,
  message: string,
  signature: Hex,
): Promise<boolean> {
  const { family, address: normalized } = normalizeAddress(address);

  try {
    if (family === 'EVM') {
      return await verifyMessage({
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
