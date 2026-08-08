import { Injectable, Logger } from '@nestjs/common';
import { encodeFunctionData, type Hex, type PublicClient } from 'viem';

import { ChainClientCache } from '@/common/chain/public-client';
import { AlertService, EAlertSeverity } from '@/common/alerts/alert.service';
import { MonitorConfig } from '@/monitor/monitor-config';
import { PAUSER_ABI } from '@/monitor/monitor.abi';

/**
 * The one thing the monitor can write.
 *
 * `pause()` is the third leg of the damage-limitation story: `perClaimCap`
 * bounds a single forged claim, `epochCap` bounds a sustained stream, and this
 * bounds how long either runs before a human is involved. It is a blunt
 * instrument — nobody claims while paused — which is why `MONITOR_AUTO_PAUSE`
 * is off unless someone turns it on deliberately.
 */
@Injectable()
export class PauserService {
  private readonly logger = new Logger(PauserService.name);
  private readonly clients = new ChainClientCache();
  private pausing?: Promise<void>;

  constructor(
    private readonly config: MonitorConfig,
    private readonly alerts: AlertService,
  ) {}

  async assertCanPause(): Promise<void> {
    const role = await this.rpc().readContract({
      address: this.config.couponClaim,
      abi: PAUSER_ABI,
      functionName: 'PAUSER_ROLE',
    });
    const holds = await this.rpc().readContract({
      address: this.config.couponClaim,
      abi: PAUSER_ABI,
      functionName: 'hasRole',
      args: [role, this.config.signer.address],
    });
    if (!holds) {
      throw new Error(
        `Guardian ${this.config.signer.address} does not hold PAUSER_ROLE on ${this.config.couponClaim}`,
      );
    }
    this.logger.log(`Guardian ${this.config.signer.address} holds PAUSER_ROLE`);
  }

  async isPaused(): Promise<boolean> {
    return this.rpc().readContract({
      address: this.config.couponClaim,
      abi: PAUSER_ABI,
      functionName: 'paused',
    });
  }

  async pause(subject: string, reason: string): Promise<void> {
    if (!this.config.autoPause) {
      await this.alerts.raise({
        code: 'monitor.pause_withheld',
        severity: EAlertSeverity.CRITICAL,
        subject,
        message: `Anomaly would trigger pause(), but MONITOR_AUTO_PAUSE is off: ${reason}`,
      });
      return;
    }

    this.pausing ??= this.submitPause(subject, reason).finally(() => {
      this.pausing = undefined;
    });
    return this.pausing;
  }

  private async submitPause(subject: string, reason: string): Promise<void> {
    try {
      if (await this.isPaused()) {
        this.logger.warn(`Already paused; not submitting again (${subject})`);
        return;
      }

      const data = encodeFunctionData({
        abi: PAUSER_ABI,
        functionName: 'pause',
      });
      const nonce = await this.rpc().getTransactionCount({
        address: this.config.signer.address,
        blockTag: 'pending',
      });
      const gasLimit = await this.rpc().estimateGas({
        account: this.config.signer.address,
        to: this.config.couponClaim,
        data,
      });
      const fees = await this.rpc().estimateFeesPerGas();

      const raw = await this.config.signer.signTransaction({
        chainId: this.config.chainId,
        nonce,
        to: this.config.couponClaim,
        data,
        gasLimit: (gasLimit * 15n) / 10n,
        maxFeePerGas: (fees.maxFeePerGas ?? 0n) * 2n,
        maxPriorityFeePerGas: (fees.maxPriorityFeePerGas ?? 0n) * 2n,
        type: 2,
      });
      const txHash = await this.rpc().sendRawTransaction({
        serializedTransaction: raw,
      });

      await this.alerts.raise({
        code: 'monitor.paused',
        severity: EAlertSeverity.CRITICAL,
        subject,
        message: `pause() submitted: ${reason}`,
        context: { txHash, guardian: this.config.signer.address },
      });
      await this.rpc().waitForTransactionReceipt({ hash: txHash as Hex });
      this.logger.warn(`Contract paused in ${txHash}`);
    } catch (err) {
      await this.alerts.raise({
        code: 'monitor.pause_failed',
        severity: EAlertSeverity.CRITICAL,
        subject,
        message: `pause() could not be submitted: ${String(err)}`,
      });
    }
  }

  private rpc(): PublicClient {
    return this.clients.get(this.config.rewardRpcUrl);
  }
}
