import { encodeAbiParameters, keccak256, type Hex } from 'viem';

import { EChainKind } from '@/chains/chain-kind.enum';

export {
  EChainKind,
  CHAIN_KINDS,
  type ChainKind,
} from '@/chains/chain-kind.enum';

export interface IChain {
  name: string;
  srcChainId: number;
  kind: EChainKind;
  evm: boolean;
  indexer: { blockchain: string; tokens: string[] };
}

export const CHAINS: readonly IChain[] = [
  {
    name: 'Ethereum Sepolia',
    srcChainId: 11155111,
    kind: EChainKind.EVM,
    evm: true,
    indexer: { blockchain: 'sepolia', tokens: ['usdt'] },
  },
  {
    name: 'Arbitrum Sepolia',
    srcChainId: 421614,
    kind: EChainKind.EVM,
    evm: true,
    indexer: { blockchain: 'arbitrum', tokens: ['usdt', 'xaut'] },
  },
  {
    name: 'Polygon Amoy',
    srcChainId: 80002,
    kind: EChainKind.EVM,
    evm: true,
    indexer: { blockchain: 'polygon', tokens: ['usdt', 'xaut'] },
  },
  {
    name: 'Tron',
    srcChainId: 4294967297,
    kind: EChainKind.TRON,
    evm: false,
    indexer: { blockchain: 'tron', tokens: ['usdt'] },
  },
  {
    name: 'Bitcoin',
    srcChainId: 4294967298,
    kind: EChainKind.BITCOIN,
    evm: false,
    indexer: { blockchain: 'bitcoin', tokens: ['btc'] },
  },
  {
    name: 'Spark',
    srcChainId: 4294967299,
    kind: EChainKind.SPARK,
    evm: false,
    indexer: { blockchain: 'spark', tokens: ['btc'] },
  },
] as const;

const BY_SRC_CHAIN_ID = new Map(CHAINS.map((c) => [c.srcChainId, c]));
const BY_INDEXER_NAME = new Map(CHAINS.map((c) => [c.indexer.blockchain, c]));

export function chainBySrcChainId(srcChainId: number): IChain {
  const chain = BY_SRC_CHAIN_ID.get(srcChainId);
  if (!chain) throw new Error(`Unknown srcChainId: ${srcChainId}`);
  return chain;
}

export function chainKindOf(srcChainId: number): EChainKind {
  return chainBySrcChainId(srcChainId).kind;
}

export function chainByIndexerName(blockchain: string): IChain {
  const chain = BY_INDEXER_NAME.get(blockchain.toLowerCase());
  if (!chain) throw new Error(`Unknown indexer blockchain: ${blockchain}`);
  return chain;
}

export function indexerPath(srcChainId: number, token: string): string {
  const { indexer } = chainBySrcChainId(srcChainId);
  const t = token.toLowerCase();
  if (!indexer.tokens.includes(t)) {
    throw new Error(`Chain ${indexer.blockchain} does not carry token ${t}`);
  }
  return `${indexer.blockchain}/${t}`;
}

export function normalizeTxHash(txHash: string): Hex {
  const hex = txHash.startsWith('0x') ? txHash.slice(2) : txHash;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`txHash must be 32 bytes of hex, got: ${txHash}`);
  }
  return `0x${hex.toLowerCase()}`;
}

/**
 * paymentRef = keccak256(abi.encode(srcChainId, txHash, outputIndex))
 *
 * ABI types are pinned to (uint256, bytes32, uint256) to match the contract.
 * `outputIndex` is the EVM log index or the UTXO `vout` — one signature, both forms.
 */
export function paymentRef(
  srcChainId: number,
  txHash: string,
  outputIndex: number,
): Hex {
  chainBySrcChainId(srcChainId); // registry is the only source of chain ids
  if (!Number.isInteger(outputIndex) || outputIndex < 0) {
    throw new Error(
      `outputIndex must be a non-negative integer, got: ${outputIndex}`,
    );
  }
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bytes32' }, { type: 'uint256' }],
      [BigInt(srcChainId), normalizeTxHash(txHash), BigInt(outputIndex)],
    ),
  );
}
