/**
 * Runs one pass of ingestion, pricing and accrual, then exits.
 *
 *   npm run poll:once
 *
 * Useful when `PAYMENT_POLL_INTERVAL_MS=0` (the local default, so a dev machine
 * does not burn the shared indexer budget) and for demonstrating ingestion
 * without waiting for a tick.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '@/app.module';
import { PaymentPollerService } from '@/payments/services/payment-poller.service';
import { PricingService } from '@/pricing/services/pricing.service';
import { AccrualService } from '@/coupons/services/accrual.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  // One hand-off through the pipeline: ingestion writes payments, pricing
  // freezes a snapshot for the confirmed ones, accrual turns those into coupons.
  await app.get(PaymentPollerService).tick();
  await app.get(PricingService).tick();
  await app.get(AccrualService).tick();
  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
