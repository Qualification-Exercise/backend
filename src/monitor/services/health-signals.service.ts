import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';

import { ClaimEntity } from '@/claims/entities/claim.entity';
import {
  EClaimFailureReason,
  EClaimStatus,
} from '@/claims/enums/claim-status.enum';
import { AlertService, EAlertSeverity } from '@/common/alerts/alert.service';
import { CounterService } from '@/common/metrics/counter.service';
import {
  COUNTER_INDEXER_ERRORS,
  COUNTER_INDEXER_RATE_LIMITED,
  COUNTER_INDEXER_REQUESTS,
} from '@/common/metrics/service-counter.entity';
import { MonitorConfig } from '@/monitor/monitor-config';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { EventCursorEntity } from '@/common/chain/event-cursor.entity';

const COUNTERS = [
  COUNTER_INDEXER_REQUESTS,
  COUNTER_INDEXER_ERRORS,
  COUNTER_INDEXER_RATE_LIMITED,
];

const FAILURE_CURSOR = 'monitor:claim-failures-seen-at';

/**
 * The signals that say the pipeline is unwell before anything is provably
 * wrong: nobody has polled recently, the indexer is failing or throttling us,
 * an issuer refused, a submission failed.
 *
 * Each of these is already logged where it happens. They are re-derived here
 * because the process that would have alerted may be the process that is down.
 */
@Injectable()
export class HealthSignalsService {
  private previous?: Record<string, number>;

  constructor(
    private readonly config: MonitorConfig,
    private readonly alerts: AlertService,
    private readonly counters: CounterService,
    @InjectRepository(IndexerCursor)
    private readonly cursors: Repository<IndexerCursor>,
    @InjectRepository(ClaimEntity)
    private readonly claims: Repository<ClaimEntity>,
    @InjectRepository(EventCursorEntity)
    private readonly eventCursors: Repository<EventCursorEntity>,
  ) {}

  async check(): Promise<void> {
    await this.checkPollingLag();
    await this.checkIndexerHealth();
    await this.checkClaimFailures();
  }

  private async checkPollingLag(): Promise<void> {
    const [latest] = await this.cursors.find({
      order: { lastPolledAt: 'DESC' },
      take: 1,
    });

    if (!latest?.lastPolledAt) {
      await this.alerts.raise({
        code: 'monitor.polling_never_ran',
        severity: EAlertSeverity.ERROR,
        subject: 'payment-poller',
        message: 'No indexer cursor has ever been polled',
      });
      return;
    }

    const lagSeconds = Math.round(
      (Date.now() - latest.lastPolledAt.getTime()) / 1000,
    );
    if (lagSeconds > this.config.maxIndexerLagSeconds) {
      await this.alerts.raise({
        code: 'monitor.polling_lag',
        severity: EAlertSeverity.ERROR,
        subject: `cursor:${latest.srcChainId}/${latest.token}/${latest.address}`,
        message: `Payment polling is ${lagSeconds}s behind; cashback detection has stopped`,
        context: { lagSeconds, threshold: this.config.maxIndexerLagSeconds },
      });
    }
  }

  private async checkIndexerHealth(): Promise<void> {
    const now = await this.counters.read(COUNTERS);
    const previous = this.previous;
    this.previous = now;
    if (!previous) return;

    const requests =
      now[COUNTER_INDEXER_REQUESTS] - previous[COUNTER_INDEXER_REQUESTS];
    const errors =
      now[COUNTER_INDEXER_ERRORS] - previous[COUNTER_INDEXER_ERRORS];
    const throttled =
      now[COUNTER_INDEXER_RATE_LIMITED] -
      previous[COUNTER_INDEXER_RATE_LIMITED];
    if (requests <= 0) return;

    const errorPct = Math.round((errors * 100) / requests);
    if (errorPct >= this.config.maxIndexerErrorPct) {
      await this.alerts.raise({
        code: 'monitor.indexer_error_rate',
        severity: EAlertSeverity.ERROR,
        subject: 'indexer-api',
        message: `Indexer failing ${errorPct}% of ${requests} requests this interval`,
        context: { requests, errors, throttled },
      });
    }

    if (throttled > 0) {
      await this.alerts.raise({
        code: 'monitor.indexer_rate_limited',
        severity: EAlertSeverity.WARNING,
        subject: 'indexer-api',
        message: `Indexer returned 429 for ${throttled} of ${requests} requests this interval`,
        context: { requests, throttled },
      });
    }
  }

  private async checkClaimFailures(): Promise<void> {
    const since = await this.lastSeenFailure();
    const failures = await this.claims.find({
      where: { status: EClaimStatus.FAILED, updatedAt: MoreThan(since) },
      relations: { coupon: true },
      order: { updatedAt: 'ASC' },
      take: 50,
    });

    for (const claim of failures) {
      const rejected =
        claim.failureReason === EClaimFailureReason.ATTESTATION_REJECTED;
      await this.alerts.raise({
        code: rejected
          ? 'monitor.issuer_disagreement'
          : 'monitor.relayer_submission_failed',
        severity: EAlertSeverity.ERROR,
        subject: claim.id,
        message: rejected
          ? 'An issuer refused to attest a claim'
          : 'A claim could not be submitted on-chain',
        context: {
          paymentRef: claim.coupon?.paymentRef,
          reason: claim.failureReason,
          detail: claim.failureDetail,
        },
      });
      await this.rememberFailure(claim.updatedAt);
    }
  }

  private async lastSeenFailure(): Promise<Date> {
    const row = await this.eventCursors.findOne({
      where: { name: FAILURE_CURSOR },
    });
    return new Date(row ? Number(row.lastBlock) : 0);
  }

  private async rememberFailure(at: Date): Promise<void> {
    await this.eventCursors.upsert(
      { name: FAILURE_CURSOR, lastBlock: at.getTime() },
      { conflictPaths: ['name'] },
    );
  }
}
