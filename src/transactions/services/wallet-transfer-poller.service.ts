import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { chainBySrcChainId } from '@/chains';
import { isUniqueViolation } from '@/common/database/pg-errors';
import { IntervalLoop } from '@/common/scheduling/interval-loop';
import type { Env } from '@/config/env';
import type {
  ITransfer,
  ITransferQuery,
} from '@/indexer/interfaces/indexer.interface';
import { IndexerService } from '@/indexer/services/indexer.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { Transaction } from '@/transactions/entities/transaction.entity';
import { ETxSource, ETxStatus, ETxType } from '@/transactions/enums/tx.enum';
import { normalizeAddress } from '@/wallets/address';
import { Wallet } from '@/wallets/entities/wallet.entity';

function canonical(address: string): string {
  try {
    return normalizeAddress(address).address;
  } catch {
    return address.trim().toLowerCase();
  }
}

function outputIndexOf(transfer: ITransfer): number {
  return transfer.logIndex ?? transfer.transferIndex;
}

/**
 * The device only reports what it broadcasts, so `POST /transactions` can never
 * produce an incoming row: without this poller a user's history shows their own
 * sends and nothing anyone sent them.
 *
 * Both directions are ingested from the same response — the indexer returns a
 * wallet's transfers on either side — which also lets an already-broadcast
 * `out` row reach `confirmed` instead of ageing into NOT_OBSERVED.
 *
 * Writes are keyed on `UNIQUE (userId, srcChainId, txHash, outputIndex)`, so a
 * re-poll of the same window is a no-op and a payment between two users of the
 * platform lands once per side rather than once in total.
 */
@Injectable()
export class WalletTransferPollerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WalletTransferPollerService.name);
  private readonly intervalMs: number;
  private readonly pageSize: number;
  private readonly maxWallets: number;
  private readonly loop = new IntervalLoop(this.logger);
  private running = false;
  private readonly warned = new Set<string>();

  constructor(
    private readonly indexer: IndexerService,
    private readonly confirmations: ConfirmationPolicy,
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectRepository(Wallet)
    private readonly wallets: Repository<Wallet>,
    configService: ConfigService<Env, true>,
  ) {
    this.intervalMs = configService.get('WALLET_POLL_INTERVAL_MS');
    this.pageSize = configService.get('WALLET_POLL_PAGE_SIZE');
    this.maxWallets = configService.get('WALLET_POLL_MAX_WALLETS');
  }

  onModuleInit() {
    const message = 'Wallet transfer polling disabled';
    if (this.loop.disabled(this.intervalMs, message)) return;

    this.loop.start(this.intervalMs, () => this.tick());
  }

  onModuleDestroy() {
    this.loop.stop();
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        'Previous wallet poll still running; skipping this tick',
      );
      return;
    }
    this.running = true;
    try {
      const wallets = await this.wallets.find({
        order: { createdAt: 'ASC' },
        take: this.maxWallets,
      });

      // One (wallet, token) pair per query: the tokens come from the chain
      // registry, which is the only place that knows what the indexer serves.
      const pairs = wallets.flatMap((wallet) =>
        this.tokensFor(wallet).map((token) => ({ wallet, token })),
      );
      if (pairs.length === 0) return;

      const queries: ITransferQuery[] = pairs.map(({ wallet, token }) => ({
        blockchain: chainBySrcChainId(Number(wallet.srcChainId)).indexer
          .blockchain,
        token,
        address: wallet.address,
        limit: this.pageSize,
      }));

      const results = await this.indexer.batchTokenTransfers(queries);

      for (let i = 0; i < pairs.length; i++) {
        await this.ingest(pairs[i].wallet, results[i]);
      }
    } catch (err) {
      // An indexer outage stops ingestion; it must never corrupt it.
      this.logger.error(`Wallet poll tick failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private tokensFor(wallet: Wallet): string[] {
    try {
      // ponytail: a wallet is polled on the srcChainId it was linked with. Same
      // EVM address on a second chain needs a per-kind chain fan-out here.
      return chainBySrcChainId(Number(wallet.srcChainId)).indexer.tokens;
    } catch (err) {
      this.warnOnce(
        String(wallet.srcChainId),
        `Skipping wallet ${wallet.address}: ${String(err)}`,
      );
      return [];
    }
  }

  private warnOnce(key: string, message: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.warn(message);
  }

  private async ingest(wallet: Wallet, transfers: ITransfer[]): Promise<void> {
    const address = canonical(wallet.address);

    for (const transfer of transfers) {
      const to = canonical(transfer.to);
      const from = canonical(transfer.from);
      // Trust boundary: the indexer decides what it returns, we decide what
      // belongs in this user's history.
      if (to !== address && from !== address) continue;

      await this.upsert(wallet, transfer, to === address ? 'in' : 'out');
    }
  }

  private async upsert(
    wallet: Wallet,
    transfer: ITransfer,
    direction: 'in' | 'out',
  ): Promise<void> {
    const srcChainId = Number(wallet.srcChainId);
    const key = {
      userId: wallet.userId,
      srcChainId,
      txHash: transfer.transactionHash,
      outputIndex: outputIndexOf(transfer),
    };
    const status = (await this.confirmations.isConfirmed(
      srcChainId,
      transfer.blockNumber,
    ))
      ? ETxStatus.CONFIRMED
      : ETxStatus.PENDING;

    const existing = await this.transactions.findOne({ where: key });
    if (existing) {
      const unchanged =
        existing.status === status &&
        Number(existing.blockHeight) === transfer.blockNumber;
      if (unchanged) return;

      // The device row keeps its `client` source: it is still what the device
      // told us, now with the chain's answer written over the pending guess.
      await this.transactions.update(
        { id: existing.id },
        {
          status,
          blockHeight: transfer.blockNumber,
          failureReason: null,
          walletId: existing.walletId ?? wallet.id,
        },
      );
      return;
    }

    try {
      await this.transactions.insert({
        ...key,
        walletId: wallet.id,
        chain: wallet.chain,
        type: ETxType.TRANSFER,
        direction,
        token: transfer.token.toUpperCase(),
        amount: transfer.amount,
        usdValue: null,
        fromAddress: canonical(transfer.from),
        toAddress: canonical(transfer.to),
        feeToken: null,
        feeAmount: null,
        status,
        confirmations: 0,
        requiredConfirmations: this.confirmations.depthFor(srcChainId),
        blockHeight: transfer.blockNumber,
        source: ETxSource.INDEXER,
        broadcastAt: null,
        occurredAt: new Date(transfer.timestamp),
      });
    } catch (err) {
      // Overlapping poll windows are expected, so a duplicate is a no-op.
      if (!isUniqueViolation(err)) throw err;
    }
  }
}
