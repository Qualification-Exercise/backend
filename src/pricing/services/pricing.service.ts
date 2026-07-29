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
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';
import {
  PriceSource,
  PriceUnavailableError,
  assetForToken,
} from '@/pricing/price-source';

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Freezes one canonical price per confirmed payment (BE-08).
 *
 * Writes `price_snapshots` only. It does not create coupons and does not decide
 * what anything is worth — that is accrual's job, and keeping them apart means a
 * pricing bug cannot mint.
 */
@Injectable()
export class PricingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PricingService.name);
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prices: PriceSource,
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(PriceSnapshot)
    private readonly snapshots: Repository<PriceSnapshot>,
    configService: ConfigService<Env, true>,
  ) {
    this.intervalMs = configService.get('PRICING_POLL_INTERVAL_MS');
    this.batchSize = configService.get('PRICING_BATCH_SIZE');
  }

  onModuleInit() {
    if (this.intervalMs <= 0) {
      this.logger.log('Pricing disabled (PRICING_POLL_INTERVAL_MS <= 0)');
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

  /** Prices every confirmed payment that has no snapshot yet. */
  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        'Previous pricing pass still running; skipping this tick',
      );
      return;
    }
    this.running = true;
    try {
      for (const payment of await this.due()) {
        await this.snapshot(payment);
      }
    } catch (err) {
      this.logger.error(`Pricing tick failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private due(): Promise<Payment[]> {
    return this.payments
      .createQueryBuilder('payment')
      .where('payment.status = :status', { status: 'confirmed' })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM price_snapshots s WHERE s."paymentRef" = payment."paymentRef")',
      )
      .orderBy('payment."transferredAt"', 'ASC')
      .limit(this.batchSize)
      .getMany();
  }

  /**
   * USD₮ takes exactly this path, at whatever the market says (0.9999-ish), not a
   * hardcoded 1.0 — one code path to test, and no second one to get wrong.
   */
  async snapshot(payment: Payment): Promise<PriceSnapshot | null> {
    let quote;
    try {
      quote = await this.prices.priceAt(
        assetForToken(payment.token),
        payment.transferredAt,
      );
    } catch (err) {
      if (err instanceof PriceUnavailableError) {
        // The coupon waits. It never accrues at a guessed price.
        this.logger.warn(
          `No price for paymentRef=${payment.paymentRef}; retrying next tick: ${err.message}`,
        );
        return null;
      }
      throw err;
    }

    const row = this.snapshots.create({
      paymentRef: payment.paymentRef,
      asset: assetForToken(payment.token),
      quote: 'USD',
      price: quote.price,
      source: quote.source,
      providerTimestamp: quote.providerTimestamp,
    });

    try {
      await this.snapshots.insert(row);
      return row;
    } catch (err) {
      if ((err as { code?: string }).code !== PG_UNIQUE_VIOLATION) throw err;
      // Another pass got there first. The first write is the canonical one.
      return this.snapshots.findOne({
        where: { paymentRef: payment.paymentRef },
      });
    }
  }
}
