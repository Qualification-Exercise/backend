import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { parseAbiItem, type Hex, type PublicClient } from 'viem';

import { ChainClientCache } from '@/common/chain/public-client';
import { AlertService, EAlertSeverity } from '@/common/alerts/alert.service';
import { PaymentVerifierService } from '@/common/chain/payment-verifier.service';
import { paymentRef } from '@/chains';
import { MonitorConfig } from '@/monitor/monitor-config';
import { EventCursorEntity } from '@/common/chain/event-cursor.entity';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

const LOOKBACK_BLOCKS = 500n;

/**
 * Both directions of "is the indexer telling the truth".
 *
 * A payment it reported that the chain does not show is a wrong answer; a
 * payment on-chain it never reported is a missing one. Only the first is caught
 * by verifying what we already stored, and the second is the failure mode that
 * matters more here: with detection outsourced, a silent indexer looks exactly
 * like a quiet day, and quiet days do not page anyone.
 */
@Injectable()
export class PaymentSamplerService {
  private readonly clients = new ChainClientCache();

  constructor(
    private readonly config: MonitorConfig,
    private readonly alerts: AlertService,
    private readonly verifier: PaymentVerifierService,
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    @InjectRepository(EventCursorEntity)
    private readonly cursors: Repository<EventCursorEntity>,
  ) {}

  async check(): Promise<void> {
    const merchants = await this.merchants.find({ where: { active: true } });
    await this.checkReported(merchants.map((m) => m.address));
    await this.checkUnreported(merchants);
  }

  private async checkReported(merchantAddresses: string[]): Promise<void> {
    const sample = await this.payments.find({
      where: { srcChainId: In(this.config.chains) },
      order: { transferredAt: 'DESC' },
      take: this.config.sampleSize,
    });

    for (const payment of sample) {
      try {
        await this.verifier.verify(payment, merchantAddresses);
      } catch (err) {
        await this.alerts.raise({
          code: 'monitor.payment_not_on_chain',
          severity: EAlertSeverity.CRITICAL,
          subject: payment.paymentRef,
          message: `Indexer reported a payment this node does not confirm: ${String(
            err instanceof Error ? err.message : err,
          )}`,
          context: {
            txHash: payment.txHash,
            outputIndex: payment.outputIndex,
            merchant: payment.merchantAddress,
          },
        });
      }
    }
  }

  private async checkUnreported(merchants: Merchant[]): Promise<void> {
    const visible = merchants.filter((m) =>
      this.config.rpcUrlFor(Number(m.srcChainId)),
    );

    for (const merchant of visible) {
      const srcChainId = Number(merchant.srcChainId);
      const token = this.config.tokenAddress(srcChainId, merchant.token);
      if (!token) continue;

      const head = await this.rpc(srcChainId).getBlockNumber();
      const cursorName = `monitor:unreported:${srcChainId}:${merchant.address}`;
      const resumeFrom = await this.readCursor(cursorName);
      const floor = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
      const fromBlock =
        resumeFrom !== null && resumeFrom > floor ? resumeFrom : floor;
      if (fromBlock > head) continue;

      const logs = await this.rpc(srcChainId).getLogs({
        address: token as Hex,
        event: TRANSFER_EVENT,
        args: { to: merchant.address as Hex },
        fromBlock,
        toBlock: head,
      });

      for (const log of logs) {
        if (log.transactionHash === null || log.logIndex === null) continue;
        const ref = paymentRef(
          srcChainId,
          log.transactionHash,
          Number(log.logIndex),
        );
        const known = await this.payments.findOne({
          where: { paymentRef: ref },
        });
        if (known) continue;

        await this.alerts.raise({
          code: 'monitor.payment_not_indexed',
          severity: EAlertSeverity.ERROR,
          subject: ref,
          message:
            'Merchant payment visible on-chain that the indexer never reported',
          context: {
            txHash: log.transactionHash,
            logIndex: Number(log.logIndex),
            merchant: merchant.address,
            blockNumber: log.blockNumber?.toString(),
          },
        });
      }

      await this.writeCursor(cursorName, head);
    }
  }

  private async readCursor(name: string): Promise<bigint | null> {
    const row = await this.cursors.findOne({ where: { name } });
    return row ? BigInt(row.lastBlock) + 1n : null;
  }

  private async writeCursor(name: string, head: bigint): Promise<void> {
    await this.cursors.upsert(
      { name, lastBlock: Number(head) },
      { conflictPaths: ['name'] },
    );
  }

  private rpc(srcChainId: number): PublicClient {
    const url = this.config.rpcUrlFor(srcChainId);
    if (!url) throw new Error(`Monitor has no node for chain ${srcChainId}`);

    return this.clients.get(url);
  }
}
