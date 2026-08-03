export enum EBlockchain {
  ETHEREUM = 'ethereum',
  SEPOLIA = 'sepolia',
  ARBITRUM = 'arbitrum',
  POLYGON = 'polygon',
  TRON = 'tron',
  BITCOIN = 'bitcoin',
  SPARK = 'spark',
}

export enum EAsset {
  USDT = 'usdt',
  BTC = 'btc',
  XAUT = 'xaut',
}

export const SUPPORTED_BLOCKCHAINS = Object.values(EBlockchain);
export const SUPPORTED_ASSETS = Object.values(EAsset);
