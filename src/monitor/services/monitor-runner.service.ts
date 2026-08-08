import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { AlertService, EAlertSeverity } from '@/common/alerts/alert.service';
import { IntervalLoop } from '@/common/scheduling/interval-loop';
import { MonitorConfig } from '@/monitor/monitor-config';
import { HealthSignalsService } from '@/monitor/services/health-signals.service';
import { PauserService } from '@/monitor/services/pauser.service';
import { PaymentSamplerService } from '@/monitor/services/payment-sampler.service';
import { SupplyReconcilerService } from '@/monitor/services/supply-reconciler.service';

/**
 * The monitor's loop. Each check is independent on purpose: one failing check
 * must not silence the others, because the reason it failed is often the same
 * reason another one would have fired.
 */
@Injectable()
export class MonitorRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorRunnerService.name);
  private readonly loop = new IntervalLoop(this.logger);
  private running = false;
  private pauseRightsConfirmed = false;

  constructor(
    private readonly config: MonitorConfig,
    private readonly supply: SupplyReconcilerService,
    private readonly payments: PaymentSamplerService,
    private readonly health: HealthSignalsService,
    private readonly pauser: PauserService,
    private readonly alerts: AlertService,
  ) {}

  async onModuleInit() {
    this.logger.log(
      `Monitor up as guardian ${this.config.signer.address} ` +
        `(auto-pause=${this.config.autoPause})`,
    );
    const disabledMessage =
      'Monitor loop disabled (MONITOR_POLL_INTERVAL_MS <= 0)';
    if (this.loop.disabled(this.config.pollIntervalMs, disabledMessage)) return;

    // Deliberately not fatal. The guardian's PAUSER_ROLE is worth checking at
    // startup, but a monitor that refuses to run because one contract read
    // failed goes dark exactly when things are going wrong — and it is the one
    // process whose silence nobody else can report. Retried every tick until
    // it holds.
    await this.confirmPauseRights();

    this.loop.start(this.config.pollIntervalMs, () => this.tick());
  }

  onModuleDestroy() {
    this.loop.stop();
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous monitor pass still running; skipping');
      return;
    }
    this.running = true;
    try {
      await this.safely('supply', () => this.supply.check());
      await this.safely('epoch', () => this.supply.checkEpochUtilisation());
      await this.safely('payments', () => this.payments.check());
      await this.safely('health', () => this.health.check());
      // Last: watching is the job, the guardian's rights are a capability the
      // pass retries acquiring. A contract read that fails must not delay the
      // checks that would have reported why it failed.
      if (!this.pauseRightsConfirmed) {
        await this.safely('pause-rights', () => this.confirmPauseRights());
      }
    } finally {
      this.running = false;
    }
  }

  private async confirmPauseRights(): Promise<void> {
    if (this.pauseRightsConfirmed) return;
    try {
      await this.pauser.assertCanPause();
      this.pauseRightsConfirmed = true;
    } catch (err) {
      await this.alerts.raise({
        code: 'monitor.pause_rights_unconfirmed',
        severity: EAlertSeverity.ERROR,
        subject: this.config.signer.address,
        message:
          'Guardian could not confirm PAUSER_ROLE; watching continues, ' +
          'auto-pause may not work',
        context: { error: String(err) },
      });
    }
  }

  private async safely(
    name: string,
    check: () => Promise<void>,
  ): Promise<void> {
    try {
      await check();
    } catch (err) {
      this.logger.error(`Monitor check "${name}" failed: ${String(err)}`);
    }
  }
}
