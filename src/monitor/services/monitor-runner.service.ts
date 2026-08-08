import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

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

  constructor(
    private readonly config: MonitorConfig,
    private readonly supply: SupplyReconcilerService,
    private readonly payments: PaymentSamplerService,
    private readonly health: HealthSignalsService,
    private readonly pauser: PauserService,
  ) {}

  async onModuleInit() {
    this.logger.log(
      `Monitor up as guardian ${this.config.signer.address} ` +
        `(auto-pause=${this.config.autoPause})`,
    );
    const disabledMessage =
      'Monitor loop disabled (MONITOR_POLL_INTERVAL_MS <= 0)';
    if (this.loop.disabled(this.config.pollIntervalMs, disabledMessage)) return;

    await this.pauser.assertCanPause();

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
    } finally {
      this.running = false;
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
