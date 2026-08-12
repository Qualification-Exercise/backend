import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { isUniqueViolation } from '@/common/database/pg-errors';
import { IntervalLoop } from '@/common/scheduling/interval-loop';
import type { Env } from '@/config/env';
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';
import {
  PriceSource,
  PriceUnavailableError,
  assetForToken,
} from '@/pricing/price-source';
import { BitfinexPricingClient } from '@tetherto/wdk-pricing-bitfinex-http';
import { IGetLivePricingParams } from '../interfaces/pricing.interface';

/**
 * Freezes one canonical price per confirmed payment (BE-08).
 *
 * Writes `price_snapshots` only. It does not create coupons and does not decide
 * what anything is worth — that is accrual's job, and keeping them apart means a
 * pricing bug cannot mint.
 */
const LIVE_PRICE_TTL_MS = 5_000;

@Injectable()
export class PricingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PricingService.name);
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly loop = new IntervalLoop(this.logger);
  private running = false;
  private client: BitfinexPricingClient;
  private readonly liveCache = new Map<
    string,
    { value: { data: unknown[] }; expiresAt: number }
  >();

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
    this.client = new BitfinexPricingClient();
    const message = 'Pricing disabled (PRICING_POLL_INTERVAL_MS <= 0)';
    if (this.loop.disabled(this.intervalMs, message)) return;

    this.loop.start(this.intervalMs, () => this.tick());
  }

  onModuleDestroy() {
    this.loop.stop();
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
      if (!isUniqueViolation(err)) throw err;
      // Another pass got there first. The first write is the canonical one.
      return this.snapshots.findOne({
        where: { paymentRef: payment.paymentRef },
      });
    }
  }

  async getLivePricing(params: IGetLivePricingParams) {
    const { fromSources, to } = params;
    const cacheKey = `${fromSources.join(',')}|${to || 'USD'}`;
    const hit = this.liveCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const paramsToPricing = fromSources.map((source) => {
      return {
        from: source,
        to: to || 'USD',
      };
    });

    const prices = await this.client.getMultiCurrentPrices(paramsToPricing);

    const mappedRes = fromSources.map((source, ind) => {
      return {
        from: source,
        to: to || 'USD',
        price: prices[ind] || null,
      };
    });

    const response = { data: mappedRes };
    this.liveCache.set(cacheKey, {
      value: response,
      expiresAt: Date.now() + LIVE_PRICE_TTL_MS,
    });
    return response;
  }
}
