import { EChainKind } from '@/chains/chain-kind.enum';
import type { ITransfer } from '@/indexer/interfaces/indexer.interface';
import { IndexerService } from '@/indexer/services/indexer.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { Transaction } from '@/transactions/entities/transaction.entity';
import { ETxSource, ETxStatus } from '@/transactions/enums/tx.enum';
import { WalletTransferPollerService } from '@/transactions/services/wallet-transfer-poller.service';
import { Wallet } from '@/wallets/entities/wallet.entity';

const SEPOLIA = 11155111;
const WALLET_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const COUNTERPARTY = '0x64998cb8F2c9a6A9293c47c24Bf4535E003e57d3';

function wallet(): Wallet {
  return {
    id: 'w-1',
    userId: 'u-1',
    chain: EChainKind.EVM,
    srcChainId: SEPOLIA,
    address: WALLET_ADDRESS,
    createdAt: new Date(),
  } as Wallet;
}

function transfer(over: Partial<ITransfer> = {}): ITransfer {
  return {
    blockchain: 'sepolia',
    blockNumber: 100,
    transactionHash: `0x${'a'.repeat(64)}`,
    transferIndex: 0,
    logIndex: 3,
    transactionIndex: 1,
    token: 'usdt',
    amount: '1000000',
    timestamp: Date.UTC(2026, 0, 1),
    from: COUNTERPARTY,
    to: WALLET_ADDRESS,
    ...over,
  };
}

function build(transfers: ITransfer[], existing: Partial<Transaction> | null) {
  const transactions = {
    findOne: jest.fn().mockResolvedValue(existing),
    insert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const indexer = {
    batchTokenTransfers: jest.fn().mockResolvedValue([transfers]),
  };
  const confirmations = {
    isConfirmed: jest.fn().mockResolvedValue(true),
    depthFor: jest.fn().mockReturnValue(12),
  };
  const wallets = { find: jest.fn().mockResolvedValue([wallet()]) };
  const config = {
    get: (key: string) => (key === 'WALLET_POLL_INTERVAL_MS' ? 30_000 : 50),
  };

  const service = new WalletTransferPollerService(
    indexer as unknown as IndexerService,
    confirmations as unknown as ConfirmationPolicy,
    transactions as never,
    wallets as never,
    config as never,
  );

  return { service, transactions, indexer };
}

describe('WalletTransferPollerService', () => {
  it('records a transfer into the wallet as an incoming transaction', async () => {
    const { service, transactions } = build([transfer()], null);

    await service.tick();

    expect(transactions.insert).toHaveBeenCalledTimes(1);
    expect(transactions.insert.mock.calls[0][0]).toMatchObject({
      userId: 'u-1',
      direction: 'in',
      source: ETxSource.INDEXER,
      status: ETxStatus.CONFIRMED,
      outputIndex: 3,
      token: 'USDT',
      blockHeight: 100,
      requiredConfirmations: 12,
    });
  });

  it('confirms the device-reported row for an outgoing transfer instead of inserting', async () => {
    const { service, transactions } = build(
      [transfer({ from: WALLET_ADDRESS, to: COUNTERPARTY })],
      {
        id: 'tx-1',
        walletId: 'w-1',
        status: ETxStatus.PENDING,
        blockHeight: null,
      },
    );

    await service.tick();

    expect(transactions.insert).not.toHaveBeenCalled();
    expect(transactions.update).toHaveBeenCalledWith(
      { id: 'tx-1' },
      expect.objectContaining({
        status: ETxStatus.CONFIRMED,
        blockHeight: 100,
        failureReason: null,
      }),
    );
  });

  it('ignores a transfer that touches neither side of the wallet', async () => {
    const { service, transactions } = build(
      [transfer({ from: COUNTERPARTY, to: COUNTERPARTY })],
      null,
    );

    await service.tick();

    expect(transactions.insert).not.toHaveBeenCalled();
    expect(transactions.update).not.toHaveBeenCalled();
  });

  it('leaves an already up-to-date row untouched', async () => {
    const { service, transactions } = build([transfer()], {
      id: 'tx-1',
      status: ETxStatus.CONFIRMED,
      blockHeight: 100,
    });

    await service.tick();

    expect(transactions.update).not.toHaveBeenCalled();
    expect(transactions.insert).not.toHaveBeenCalled();
  });
});
