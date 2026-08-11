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

const TRON = 4294967297;
const TRON_WALLET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRON_COUNTERPARTY = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';

function wallet(over: Partial<Wallet> = {}): Wallet {
  return {
    id: 'w-1',
    userId: 'u-1',
    chain: EChainKind.EVM,
    srcChainId: SEPOLIA,
    address: WALLET_ADDRESS,
    createdAt: new Date(),
    ...over,
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

function build(
  transfers: ITransfer[],
  existing: Partial<Transaction> | null,
  linked: Wallet = wallet(),
) {
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
  const wallets = { find: jest.fn().mockResolvedValue([linked]) };
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

  it('matches a Tron address without folding its case', async () => {
    const { service, transactions } = build(
      [
        transfer({
          blockchain: 'tron',
          from: TRON_COUNTERPARTY,
          to: TRON_WALLET,
        }),
      ],
      null,
      wallet({
        chain: EChainKind.TRON,
        srcChainId: TRON,
        address: TRON_WALLET,
      }),
    );

    await service.tick();

    expect(transactions.insert).toHaveBeenCalledTimes(1);
    expect(transactions.insert.mock.calls[0][0]).toMatchObject({
      direction: 'in',
      fromAddress: TRON_COUNTERPARTY,
      toAddress: TRON_WALLET,
    });
  });

  it('skips a transfer between two addresses of the same wallet', async () => {
    const { service, transactions } = build(
      [transfer({ from: WALLET_ADDRESS, to: WALLET_ADDRESS })],
      null,
    );

    await service.tick();

    expect(transactions.insert).not.toHaveBeenCalled();
    expect(transactions.update).not.toHaveBeenCalled();
  });

  it('records a transfer whose counterparty side is null', async () => {
    const { service, transactions } = build([transfer({ from: null })], null);

    await service.tick();

    expect(transactions.insert).toHaveBeenCalledTimes(1);
    expect(transactions.insert.mock.calls[0][0]).toMatchObject({
      direction: 'in',
      fromAddress: null,
      toAddress: WALLET_ADDRESS,
    });
  });

  it('skips a zero-amount transfer', async () => {
    const { service, transactions } = build([transfer({ amount: '0' })], null);

    await service.tick();

    expect(transactions.insert).not.toHaveBeenCalled();
  });

  it('classifies each transfer of a grouped transaction on its own', async () => {
    const { service, transactions } = build(
      [
        transfer({ logIndex: 0 }),
        transfer({ logIndex: 1, from: WALLET_ADDRESS, to: COUNTERPARTY }),
      ],
      null,
    );

    await service.tick();

    expect(transactions.insert).toHaveBeenCalledTimes(2);
    expect(
      transactions.insert.mock.calls.map(
        (call: [{ direction: string; outputIndex: number }]) => [
          call[0].outputIndex,
          call[0].direction,
        ],
      ),
    ).toEqual([
      [0, 'in'],
      [1, 'out'],
    ]);
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
