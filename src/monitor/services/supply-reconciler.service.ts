import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createPublicClient, http, type PublicClient } from 'viem';

import { AlertService, EAlertSeverity } from '@/common/alerts/alert.service';
import { BPS_DENOMINATOR } from '@/coupons/accrual';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { MonitorConfig } from '@/monitor/monitor-config';
import { PAUSER_ABI, UTL_ABI } from '@/monitor/monitor.abi';
import { PauserService } from '@/monitor/services/pauser.service';

/**
 * Minted UTL against UTL the observed payments justify.
 *
 * Read from the monitor's own node, not from the indexer and not from the
 * relayer's receipts: this is the number that catches a K-of-N collusion after
 * the fact, so it must not come from anything the colluders operate. It is a
 * detective control — by the time it fires the mint has happened, and the value
 * it adds is bounding how long it keeps happening.
 */
@Injectable()
export class SupplyReconcilerService {
  private readonly logger = new Logger(SupplyReconcilerService.name);
  private client?: PublicClient;

  constructor(
    private readonly config: MonitorConfig,
    private readonly alerts: AlertService,
    private readonly pauser: PauserService,
    @InjectRepository(Coupon)
    private readonly coupons: Repository<Coupon>,
  ) {}

  async check(): Promise<void> {
    const [supply, expected] = await Promise.all([
      this.rpc().readContract({
        address: this.config.utl,
        abi: UTL_ABI,
        functionName: 'totalSupply',
      }),
      this.expectedSupply(),
    ]);

    const excess = supply > expected ? supply - expected : 0n;
    const tolerance =
      (expected * BigInt(this.config.supplyToleranceBps)) / BPS_DENOMINATOR;

    if (excess <= tolerance) {
      this.logger.debug(
        `Supply ${supply} within tolerance of the ${expected} the payments justify`,
      );
      return;
    }

    const subject = `utl:${this.config.utl}`;
    const message =
      `UTL supply exceeds what observed payments justify: ` +
      `${supply} minted, ${expected} justified, ${excess} unexplained`;

    await this.alerts.raise({
      code: 'monitor.supply_divergence',
      severity: EAlertSeverity.CRITICAL,
      subject,
      message,
      context: {
        supply: supply.toString(),
        expected: expected.toString(),
        excess: excess.toString(),
        toleranceBps: this.config.supplyToleranceBps,
      },
    });
    await this.pauser.pause(subject, message);
  }

  private async expectedSupply(): Promise<bigint> {
    const [row] = (await this.coupons.query(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
         FROM coupons
        WHERE status <> 'ORPHANED'`,
    )) as { total: string }[];
    return BigInt(row?.total ?? '0');
  }

  async checkEpochUtilisation(): Promise<void> {
    const contract = {
      address: this.config.couponClaim,
      abi: PAUSER_ABI,
    } as const;

    const [epoch, cap] = await Promise.all([
      this.rpc().readContract({ ...contract, functionName: 'currentEpoch' }),
      this.rpc().readContract({ ...contract, functionName: 'epochCap' }),
    ]);
    if (cap === 0n) return;

    const minted = await this.rpc().readContract({
      ...contract,
      functionName: 'mintedInEpoch',
      args: [epoch],
    });
    const utilisation = Number((minted * 100n) / cap);

    if (utilisation >= this.config.epochUtilisationPct) {
      await this.alerts.raise({
        code: 'monitor.epoch_cap_utilisation',
        severity: EAlertSeverity.ERROR,
        subject: `epoch:${epoch}`,
        message: `Epoch cap ${utilisation}% used — either demand or someone minting steadily`,
        context: {
          minted: minted.toString(),
          cap: cap.toString(),
          thresholdPct: this.config.epochUtilisationPct,
        },
      });
    }
  }

  private rpc(): PublicClient {
    this.client ??= createPublicClient({
      transport: http(this.config.rewardRpcUrl),
    });
    return this.client;
  }
}
