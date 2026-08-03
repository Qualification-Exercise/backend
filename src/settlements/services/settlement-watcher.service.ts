import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  createPublicClient,
  http,
  parseAbiItem,
  type Hex,
  type PublicClient,
} from 'viem';

import { ClaimEntity } from '@/claims/entities/claim.entity';
import {
  EClaimFailureReason,
  EClaimStatus,
} from '@/claims/enums/claim-status.enum';
import { ClaimsService } from '@/claims/services/claims.service';
import { AlertService, EAlertSeverity } from '@/common/alerts/alert.service';
import { EventCursorEntity } from '@/common/chain/event-cursor.entity';
import type { Env } from '@/config/env';
import { SettlementEntity } from '@/settlements/entities/settlement.entity';

const CURSOR_NAME = 'settlement-watcher';
const PG_UNIQUE_VIOLATION = '23505';

const CLAIMED_EVENT = parseAbiItem(
  'event Claimed(bytes32 indexed paymentRef, address indexed recipient, uint256 amount)',
);

/**
 * Reads `Claimed` from the one CouponClaim deployment, over its own RPC.
 *
 * The Indexer API cannot answer this question — it tracks token transfers, not
 * our contract's events — and that is convenient, because the event log is
 * exactly where a mint that bypassed our pipeline would show up. A `Claimed`
 * with a `paymentRef` the database has never seen is the cheapest tripwire in
 * the system, so it is the loudest thing this loop can say.
 */
@Injectable()
export class SettlementWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementWatcherService.name);
  private readonly rpcUrl: string;
  private readonly contract: Hex;
  private readonly intervalMs: number;
  private readonly confirmations: number;
  private readonly blockRange: number;
  private readonly timeoutMs: number;
  private readonly startBlock: number;
  private client?: PublicClient;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly claims: ClaimsService,
    private readonly alerts: AlertService,
    @InjectRepository(ClaimEntity)
    private readonly claimRepo: Repository<ClaimEntity>,
    @InjectRepository(SettlementEntity)
    private readonly settlements: Repository<SettlementEntity>,
    @InjectRepository(EventCursorEntity)
    private readonly cursors: Repository<EventCursorEntity>,
    configService: ConfigService<Env, true>,
  ) {
    this.rpcUrl = configService.get('SETTLEMENT_RPC_URL');
    this.contract = configService.get('COUPON_CLAIM_CONTRACT_ADDRESS') as Hex;
    this.intervalMs = configService.get('SETTLEMENT_POLL_INTERVAL_MS');
    this.confirmations = configService.get('SETTLEMENT_CONFIRMATIONS');
    this.blockRange = configService.get('SETTLEMENT_BLOCK_RANGE');
    this.timeoutMs = configService.get('SETTLEMENT_TIMEOUT_MS');
    this.startBlock = configService.get('SETTLEMENT_START_BLOCK');
  }

  onModuleInit() {
    if (this.intervalMs <= 0 || !this.rpcUrl) {
      this.logger.log('Settlement watcher disabled');
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
      this.logger.warn('Previous settlement pass still running; skipping');
      return;
    }
    this.running = true;
    try {
      await this.readEvents();
      await this.sweepUnsettled();
    } catch (err) {
      this.logger.error(`Settlement tick failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private async readEvents(): Promise<void> {
    const head = Number(await this.rpc().getBlockNumber());
    const safeHead = head - this.confirmations;
    if (safeHead <= 0) return;

    const from = (await this.cursor()) + 1;
    if (from > safeHead) return;
    const to = Math.min(safeHead, from + this.blockRange - 1);

    const logs = await this.rpc().getLogs({
      address: this.contract,
      event: CLAIMED_EVENT,
      fromBlock: BigInt(from),
      toBlock: BigInt(to),
    });

    for (const log of logs) {
      await this.settle(log);
    }

    await this.cursors.save({ name: CURSOR_NAME, lastBlock: to });
    if (logs.length > 0) {
      this.logger.log(`Processed ${logs.length} Claimed events up to ${to}`);
    }
  }

  private async settle(log: {
    args: { paymentRef?: Hex; recipient?: Hex; amount?: bigint };
    transactionHash: Hex | null;
    blockNumber: bigint | null;
  }): Promise<void> {
    const paymentRef = log.args.paymentRef;
    if (!paymentRef) return;

    const claim = await this.claimRepo
      .createQueryBuilder('claim')
      .innerJoinAndSelect('claim.coupon', 'coupon')
      .where('coupon."paymentRef" = :paymentRef', { paymentRef })
      .getOne();

    if (!claim) {
      // Nothing in this database asked for that mint. Either our records are
      // gone, or someone with K issuer keys and the relayer key went around us.
      await this.alerts.raise({
        code: 'settlement.unknown_payment_ref',
        severity: EAlertSeverity.CRITICAL,
        subject: paymentRef,
        message: 'Claimed event for a paymentRef this database has never seen',
        context: {
          txHash: log.transactionHash,
          recipient: log.args.recipient,
          amount: log.args.amount?.toString(),
          blockNumber: log.blockNumber?.toString(),
        },
      });
      return;
    }

    await this.record(claim, log);
    await this.claims.markClaimed(claim.id);
    this.logger.log(
      `Claim ${claim.id} settled on-chain in ${log.transactionHash}`,
    );
  }

  private async record(
    claim: ClaimEntity,
    log: {
      args: { recipient?: Hex; amount?: bigint };
      transactionHash: Hex | null;
      blockNumber: bigint | null;
    },
  ): Promise<void> {
    const block = await this.rpc().getBlock({
      blockNumber: log.blockNumber ?? 0n,
    });

    try {
      await this.settlements.insert({
        paymentRef: claim.coupon.paymentRef,
        recipient: log.args.recipient ?? claim.recipient,
        amount: (log.args.amount ?? BigInt(claim.amount)).toString(),
        txHash: log.transactionHash ?? '',
        blockNumber: Number(log.blockNumber ?? 0n),
        eventTimestamp: new Date(Number(block.timestamp) * 1000),
      });
    } catch (err) {
      // UNIQUE (payment_ref): re-reading a range after a restart is expected.
      if ((err as { code?: string }).code !== PG_UNIQUE_VIOLATION) throw err;
    }
  }

  private async sweepUnsettled(): Promise<void> {
    const overdue = await this.claimRepo.find({
      where: {
        status: EClaimStatus.CLAIM_SUBMITTED,
        updatedAt: LessThan(new Date(Date.now() - this.timeoutMs)),
      },
      relations: { coupon: true },
      take: 50,
    });

    const now = Math.floor(Date.now() / 1000);
    for (const claim of overdue) {
      const expired = Number(claim.deadline) < now;
      await this.alerts.raise({
        code: 'settlement.claim_not_settled',
        severity: expired ? EAlertSeverity.ERROR : EAlertSeverity.WARNING,
        subject: claim.id,
        message: expired
          ? 'Submitted claim never settled and its entitlement has expired; coupon released'
          : 'Submitted claim has not settled within the timeout',
        context: {
          paymentRef: claim.coupon.paymentRef,
          txHash: claim.txHash,
          deadline: claim.deadline,
        },
      });

      if (expired) {
        await this.claims.fail(
          claim.id,
          EClaimFailureReason.SUBMISSION_FAILED,
          `settlement-watcher: no Claimed event before the deadline (tx ${claim.txHash})`,
        );
      }
    }
  }

  private async cursor(): Promise<number> {
    const row = await this.cursors.findOne({ where: { name: CURSOR_NAME } });
    return row ? Number(row.lastBlock) : Math.max(0, this.startBlock - 1);
  }

  private rpc(): PublicClient {
    this.client ??= createPublicClient({ transport: http(this.rpcUrl) });
    return this.client;
  }
}
