export enum EChainKind {
  EVM = 'evm',
  TRON = 'tron',
  BITCOIN = 'bitcoin',
  SPARK = 'spark',
}

export type ChainKind = `${EChainKind}`;

export const CHAIN_KINDS: readonly ChainKind[] = Object.values(EChainKind);
