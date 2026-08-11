export interface ITransfer {
  blockchain: string;
  blockNumber: number;
  transactionHash: string;
  transferIndex: number;
  token: string;
  amount: string;
  timestamp: number;
  transactionIndex: number;
  logIndex: number | null;
  // Either side is absent on mint, burn and contract creation.
  from: string | null;
  to: string | null;
  label?: string;
  metadata?: unknown | null;
}

export interface ITransferQuery {
  blockchain: string;
  token: string;
  address: string;
  limit: number;
  fromTs?: number;
  toTs?: number;
}

export interface IBalance {
  blockchain: string;
  token: string;
  address?: string;
  amount: string;
  decimals?: number;
  lastUpdated?: number;
}

export interface ITokenBalanceQuery {
  blockchain: string;
  token: string;
  address: string;
}
