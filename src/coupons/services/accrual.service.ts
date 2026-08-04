import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { Env } from '@/config/env';
import { AlertService, EAlertSeverity } from '@/common/alerts/alert.service';
import {
  AccrualInputError,
  accrualAmount,
  generateCouponCode,
} from '@/coupons/accrual';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';

const PG_UNIQUE_VIOLATION = '23505';
const CODE_ATTEMPTS = 5;

const VOIDABLE = [
  'PENDING',
  'ISSUED',
  'PENDING_ATTESTATION',
  'ATTESTED',
  'CLAIM_SUBMITTED',
] as const;

@Injectable()
export class AccrualService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccrualService.name);
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly utlUsdRate: string;
  private readonly cashbackBps: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(Coupon)
    private readonly coupons: Repository<Coupon>,
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(PriceSnapshot)
    private readonly snapshots: Repository<PriceSnapshot>,
    configService: ConfigService<Env, true>,
    private readonly alertService: AlertService,
  ) {
    this.intervalMs = configService.get('ACCRUAL_POLL_INTERVAL_MS');
    this.batchSize = configService.get('ACCRUAL_BATCH_SIZE');
    this.utlUsdRate = configService.get('UTL_USD_RATE');
    this.cashbackBps = configService.get('CASHBACK_BPS');
  }

  onModuleInit() {
    if (this.intervalMs <= 0) {
      this.logger.log('Accrual disabled (ACCRUAL_POLL_INTERVAL_MS <= 0)');
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
      this.logger.warn(
        'Previous accrual pass still running; skipping this tick',
      );
      return;
    }
    this.running = true;
    try {
      // Void first: a payment that vanished must never fund a claim, and the
      // claim path only ever looks at coupons.
      await this.voidOrphaned();
      for (const payment of await this.due()) {
        await this.accrue(payment);
      }
    } catch (err) {
      this.logger.error(`Accrual tick failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private due(): Promise<Payment[]> {
    return this.payments
      .createQueryBuilder('payment')
      .where('payment.status = :status', { status: 'confirmed' })
      .andWhere('payment."userId" IS NOT NULL')
      .andWhere(
        'EXISTS (SELECT 1 FROM price_snapshots s WHERE s."paymentRef" = payment."paymentRef")',
      )
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM coupons c WHERE c."paymentRef" = payment."paymentRef")',
      )
      .orderBy('payment."transferredAt"', 'ASC')
      .limit(this.batchSize)
      .getMany();
  }

  private async voidOrphaned(): Promise<void> {
    const stale = await this.coupons
      .createQueryBuilder('coupon')
      .where('coupon.status IN (:...open)', { open: [...VOIDABLE] })
      .andWhere(
        'EXISTS (SELECT 1 FROM payments p WHERE p."paymentRef" = coupon."paymentRef" AND p.status = :orphaned)',
        { orphaned: 'orphaned' },
      )
      .getMany();

    for (const coupon of stale) {
      this.logger.warn(
        `security_event=coupon.orphaned couponId=${coupon.id} ` +
          `paymentRef=${coupon.paymentRef} from=${coupon.status}`,
      );
      await this.coupons.update({ id: coupon.id }, { status: 'ORPHANED' });
    }

    // Already paid out: nothing to void, everything to alert about.
    const paidOut = await this.coupons
      .createQueryBuilder('coupon')
      .where('coupon.status = :claimed', { claimed: 'CLAIMED' })
      .andWhere(
        'EXISTS (SELECT 1 FROM payments p WHERE p."paymentRef" = coupon."paymentRef" AND p.status = :orphaned)',
        { orphaned: 'orphaned' },
      )
      .getMany();

    for (const coupon of paidOut) {
      this.logger.error(
        `security_event=coupon.orphaned_after_claim couponId=${coupon.id} ` +
          `paymentRef=${coupon.paymentRef} amount=${coupon.amount}`,
      );
      await this.alertService.raise({
        code: 'payment.orphaned_after_claim',
        severity: EAlertSeverity.CRITICAL,
        subject: 'Clawback required: claimed coupon backing payment orphaned',
        message: `Coupon ${coupon.id} (${coupon.amount} ${coupon.asset}) was claimed but backing payment ${coupon.paymentRef} became orphaned. On-chain clawback required.`,
        context: {
          couponId: coupon.id,
          paymentRef: coupon.paymentRef,
          amount: coupon.amount,
          asset: coupon.asset,
        },
      });
    }
  }

  async accrue(payment: Payment): Promise<Coupon | null> {
    const snapshot = await this.snapshots.findOne({
      where: { paymentRef: payment.paymentRef },
    });
    if (!snapshot) return null;

    let amount: string;
    try {
      amount = accrualAmount({
        paymentAmount: payment.amount,
        asset: snapshot.asset,
        assetUsdPrice: snapshot.price,
        utlUsdRate: this.utlUsdRate,
        cashbackBps: this.cashbackBps,
      });
    } catch (err) {
      if (err instanceof AccrualInputError) {
        // Never guess an amount. A payment we cannot price correctly waits for a
        // human, it does not accrue at whatever the code could salvage.
        this.logger.error(
          `Cannot accrue paymentRef=${payment.paymentRef}: ${err.message}`,
        );
        return null;
      }
      throw err;
    }

    return this.insertCoupon(payment, snapshot.asset, amount);
  }

  private async insertCoupon(
    payment: Payment,
    asset: string,
    amount: string,
  ): Promise<Coupon | null> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const coupon = this.coupons.create({
        paymentRef: payment.paymentRef,
        code: generateCouponCode(),
        userId: payment.userId!,
        amount,
        asset,
        status: 'ISSUED',
      });

      try {
        await this.coupons.insert(coupon);
        this.logger.log(
          `Coupon ${coupon.code} issued for paymentRef=${payment.paymentRef} amount=${amount}`,
        );
        return coupon;
      } catch (err) {
        if ((err as { code?: string }).code !== PG_UNIQUE_VIOLATION) throw err;

        // A clash on paymentRef means another pass won; that is the point of the
        // constraint. A clash on code is a 1-in-2^80 event worth one more try.
        const existing = await this.coupons.findOne({
          where: { paymentRef: payment.paymentRef },
        });
        if (existing) return existing;
      }
    }

    this.logger.error(
      `Could not find a free coupon code for paymentRef=${payment.paymentRef}`,
    );
    return null;
  }
}
