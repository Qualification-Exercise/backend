export enum ETxType {
  PAYMENT = 'payment',
  CLAIM = 'claim',
  TRANSFER = 'transfer',
}

export enum ETxStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  ORPHANED = 'orphaned',
}

export enum ETxSource {
  CLIENT = 'client',
  INDEXER = 'indexer',
  RELAYER = 'relayer',
}
