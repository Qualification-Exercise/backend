import { EClaimFailureReason } from '@/claims/enums/claim-status.enum';
import { EAlertSeverity } from '@/common/alerts/alert.service';
import {
  COUNTER_INDEXER_ERRORS,
  COUNTER_INDEXER_RATE_LIMITED,
  COUNTER_INDEXER_REQUESTS,
} from '@/common/metrics/service-counter.entity';
import type { MonitorConfig } from '@/monitor/monitor-config';
import { HealthSignalsService } from '@/monitor/services/health-signals.service';

interface IWorld {
  lastPolledAt?: Date | null;
  counters?: Record<string, number>[];
  failures?: unknown[];
}

function build(world: IWorld = {}) {
  const config = {
    maxIndexerLagSeconds: 600,
    maxIndexerErrorPct: 20,
  } as unknown as MonitorConfig;

  const alerts = { raise: jest.fn().mockResolvedValue(undefined) };
  const reads = [...(world.counters ?? [])];
  const counters = {
    read: jest.fn(async () => reads.shift() ?? {}),
  };
  const cursors = {
    find: async () => [
      {
        srcChainId: 11155111,
        token: 'usdt',
        address: '0xmerchant',
        lastPolledAt:
          world.lastPolledAt === undefined ? new Date() : world.lastPolledAt,
      },
    ],
  };
  const claims = { find: async () => world.failures ?? [] };
  const eventCursors = {
    findOne: async () => null,
    upsert: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new HealthSignalsService(
      config,
      alerts as never,
      counters as never,
      cursors as never,
      claims as never,
      eventCursors as never,
    ),
    alerts,
  };
}

describe('HealthSignalsService', () => {
  it('stays quiet when polling is current and the indexer is healthy', async () => {
    const { service, alerts } = build();
    await service.check();
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('alerts when polling has stopped — a silent indexer is not a quiet day', async () => {
    const { service, alerts } = build({
      lastPolledAt: new Date(Date.now() - 3_600_000),
    });

    await service.check();

    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'monitor.polling_lag',
        severity: EAlertSeverity.ERROR,
        subject: 'cursor:11155111/usdt/0xmerchant',
      }),
    );
  });

  it('measures the indexer failure rate over the interval, not since forever', async () => {
    const { service, alerts } = build({
      counters: [
        {
          [COUNTER_INDEXER_REQUESTS]: 1000,
          [COUNTER_INDEXER_ERRORS]: 5,
          [COUNTER_INDEXER_RATE_LIMITED]: 0,
        },
        {
          [COUNTER_INDEXER_REQUESTS]: 1010,
          [COUNTER_INDEXER_ERRORS]: 9,
          [COUNTER_INDEXER_RATE_LIMITED]: 2,
        },
      ],
    });

    // First pass only takes a baseline.
    await service.check();
    expect(alerts.raise).not.toHaveBeenCalled();

    await service.check();

    // 4 errors in 10 requests this interval — 40%, despite 0.9% lifetime.
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'monitor.indexer_error_rate',
        subject: 'indexer-api',
      }),
    );
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'monitor.indexer_rate_limited' }),
    );
  });

  it('names the claim when an issuer refused', async () => {
    const { service, alerts } = build({
      failures: [
        {
          id: 'clm-9',
          failureReason: EClaimFailureReason.ATTESTATION_REJECTED,
          failureDetail: 'issuer-a: AMOUNT_MISMATCH',
          updatedAt: new Date(),
          coupon: { paymentRef: '0xref' },
        },
      ],
    });

    await service.check();

    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'monitor.issuer_disagreement',
        subject: 'clm-9',
        context: expect.objectContaining({ paymentRef: '0xref' }),
      }),
    );
  });

  it('names the claim when a submission failed', async () => {
    const { service, alerts } = build({
      failures: [
        {
          id: 'clm-10',
          failureReason: EClaimFailureReason.SUBMISSION_FAILED,
          failureDetail: 'relayer: EXCEEDS_EPOCH_CAP',
          updatedAt: new Date(),
          coupon: { paymentRef: '0xref2' },
        },
      ],
    });

    await service.check();

    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'monitor.relayer_submission_failed',
        subject: 'clm-10',
      }),
    );
  });
});
