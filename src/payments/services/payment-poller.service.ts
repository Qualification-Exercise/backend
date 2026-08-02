import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';

import { chainBySrcChainId, indexerPath, paymentRef } from '@/chains';
import type { Env } from '@/config/env';
import {
  IndexerService,
  type ITransfer,
  type ITransferQuery,
} from '@/indexer/services/indexer.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { normalizeAddress } from '@/wallets/address';
import { Wallet } from '@/wallets/entities/wallet.entity';

const PG_UNIQUE_VIOLATION = '23505';

function isAfter(t: ITransfer, cursor: IndexerCursor): boolean {
  if (t.blockNumber !== Number(cursor.lastBlockNumber)) {
    return t.blockNumber > Number(cursor.lastBlockNumber);
  }
  if (t.transactionIndex !== cursor.lastTransactionIndex) {
    return t.transactionIndex > cursor.lastTransactionIndex;
  }
  return t.transferIndex > cursor.lastTransferIndex;
}

function byOrder(a: ITransfer, b: ITransfer): number {
  return (
    a.blockNumber - b.blockNumber ||
    a.transactionIndex - b.transactionIndex ||
    a.transferIndex - b.transferIndex
  );
}

function outputIndexOf(transfer: ITransfer): number {
  return transfer.logIndex ?? transfer.transferIndex;
}

function canonical(address: string): string {
  try {
    return normalizeAddress(address).address;
  } catch {
    return address.trim().toLowerCase();
  }
}

@Injectable()
export class PaymentPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentPollerService.name);
  private readonly intervalMs: number;
  private readonly pageSize: number;
  private readonly maxMerchantsPerTick: number;
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly warnedMerchants = new Set<string>();

  constructor(
    private readonly indexer: IndexerService,
    private readonly confirmations: ConfirmationPolicy,
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(IndexerCursor)
    private readonly cursors: Repository<IndexerCursor>,
    @InjectRepository(Wallet)
    private readonly wallets: Repository<Wallet>,
    configService: ConfigService<Env, true>,
  ) {
    this.intervalMs = configService.get('PAYMENT_POLL_INTERVAL_MS');
    this.pageSize = configService.get('PAYMENT_POLL_PAGE_SIZE');
    this.maxMerchantsPerTick = configService.get('PAYMENT_POLL_MAX_MERCHANTS');
  }

  onModuleInit() {
    if (this.intervalMs <= 0) {
      this.logger.log(
        'Payment polling disabled (PAYMENT_POLL_INTERVAL_MS <= 0)',
      );
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous poll still running; skipping this tick');
      return;
    }
    this.running = true;
    try {
      const active = await this.merchants.find({
        where: { active: true },
        order: { priority: 'ASC', createdAt: 'ASC' },
        take: this.maxMerchantsPerTick,
      });
      // One misconfigured merchant must not stop everyone else's cashback.
      const due = active.filter((merchant) => this.pollable(merchant));
      if (due.length === 0) return;

      const cursors = await Promise.all(due.map((m) => this.cursorFor(m)));
      const queries: ITransferQuery[] = due.map((merchant, i) => ({
        blockchain: chainBySrcChainId(Number(merchant.srcChainId)).indexer
          .blockchain,
        token: merchant.token,
        address: merchant.address,
        limit: cursors[i].seenCount + this.pageSize,
      }));

      const results = await this.indexer.batchTokenTransfers(queries);

      for (let i = 0; i < due.length; i++) {
        await this.ingest(due[i], cursors[i], results[i], queries[i].limit);
      }
    } catch (err) {
      // An indexer outage stops ingestion; it must never corrupt it.
      this.logger.error(`Poll tick failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private pollable(merchant: Merchant): boolean {
    try {
      indexerPath(Number(merchant.srcChainId), merchant.token);
      return true;
    } catch (err) {
      this.warnOnce(
        `${merchant.srcChainId}:${merchant.token}`,
        `Skipping merchant ${merchant.address}: ${String(err)}`,
      );
      return false;
    }
  }

  private warnOnce(key: string, message: string) {
    if (this.warnedMerchants.has(key)) return;
    this.warnedMerchants.add(key);
    this.logger.warn(message);
  }

  private async cursorFor(merchant: Merchant): Promise<IndexerCursor> {
    const key = {
      srcChainId: Number(merchant.srcChainId),
      token: merchant.token,
      address: merchant.address,
    };
    const existing = await this.cursors.findOne({ where: key });
    return existing ?? this.cursors.create(key);
  }

  private async ingest(
    merchant: Merchant,
    cursor: IndexerCursor,
    transfers: ITransfer[],
    requestedLimit: number,
  ): Promise<void> {
    const srcChainId = Number(merchant.srcChainId);
    const merchantAddress = canonical(merchant.address);

    // Trust boundary: the indexer decides what it returns, we decide what counts.
    const inbound = transfers
      .filter((t) => canonical(t.to) === merchantAddress)
      .sort(byOrder);

    if (transfers.length >= requestedLimit) {
      this.logger.warn(
        `Poll window saturated for ${merchant.address} (${transfers.length} transfers); ` +
          'widening on the next tick',
      );
    }

    for (const transfer of inbound.filter((t) => isAfter(t, cursor))) {
      await this.record(merchant, transfer);
    }

    await this.reconcile(srcChainId, merchantAddress, inbound);
    await this.confirmPending(srcChainId, merchantAddress);

    const last = inbound[inbound.length - 1];
    if (last) {
      cursor.lastBlockNumber = last.blockNumber;
      cursor.lastTransactionIndex = last.transactionIndex;
      cursor.lastTransferIndex = last.transferIndex;
    }
    cursor.seenCount = transfers.length;
    cursor.lastPolledAt = new Date();
    await this.cursors.save(cursor);
  }

  private async record(merchant: Merchant, transfer: ITransfer): Promise<void> {
    const srcChainId = Number(merchant.srcChainId);
    const outputIndex = outputIndexOf(transfer);
    const txHash = transfer.transactionHash;
    const now = new Date();

    const payer = await this.wallets.findOne({
      where: { address: canonical(transfer.from) },
    });

    try {
      await this.payments.insert({
        paymentRef: paymentRef(srcChainId, txHash, outputIndex),
        srcChainId,
        txHash,
        outputIndex,
        blockNumber: transfer.blockNumber,
        token: transfer.token,
        amount: transfer.amount,
        fromAddress: canonical(transfer.from),
        merchantAddress: canonical(merchant.address),
        userId: payer?.userId ?? null,
        // A transfer from an address no user has mapped is a fact we record once,
        // not work we retry forever.
        status: payer ? 'pending' : 'ignored',
        transferredAt: new Date(transfer.timestamp),
        lastSeenAt: now,
      });
    } catch (err) {
      if ((err as { code?: string }).code !== PG_UNIQUE_VIOLATION) throw err;
      // Overlapping poll windows are expected, so a duplicate is a no-op.
      await this.payments.update(
        { srcChainId, txHash, outputIndex },
        { lastSeenAt: now },
      );
    }
  }

  private async reconcile(
    srcChainId: number,
    merchantAddress: string,
    inbound: ITransfer[],
  ): Promise<void> {
    const highest = inbound[inbound.length - 1]?.blockNumber;
    if (highest === undefined) return;

    const seen = new Map(
      inbound.map((t) => [`${t.transactionHash}:${outputIndexOf(t)}`, t]),
    );

    // Only judge what this response actually covered.
    const candidates = await this.payments.find({
      where: {
        srcChainId,
        merchantAddress,
        status: In(['pending', 'confirmed']),
        blockNumber: LessThanOrEqual(highest),
      },
    });

    for (const payment of candidates) {
      const match = seen.get(`${payment.txHash}:${payment.outputIndex}`);
      const moved = match && match.blockNumber !== Number(payment.blockNumber);
      if (match && !moved) continue;

      this.logger.warn(
        `security_event=payment.orphaned paymentRef=${payment.paymentRef} ` +
          `reason=${moved ? 'block_changed' : 'disappeared'} ` +
          `wasBlock=${payment.blockNumber} nowBlock=${match?.blockNumber ?? 'none'}`,
      );
      await this.payments.update({ id: payment.id }, { status: 'orphaned' });
    }
  }

  /** Payments become money only at the BE-19 depth for their chain. */
  private async confirmPending(
    srcChainId: number,
    merchantAddress: string,
  ): Promise<void> {
    const pending = await this.payments.find({
      where: { srcChainId, merchantAddress, status: 'pending' },
    });

    for (const payment of pending) {
      if (
        !(await this.confirmations.isConfirmed(
          srcChainId,
          Number(payment.blockNumber),
        ))
      ) {
        continue;
      }
      await this.payments.update(
        { id: payment.id },
        { status: 'confirmed', confirmedAt: new Date() },
      );
    }
  }
}
