import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClaimEntity } from '@/claims/entities/claim.entity';
import { AlertService } from '@/common/alerts/alert.service';
import { CHAIN_VIEW_CONFIG } from '@/common/chain/chain-view.config';
import { PaymentVerifierService } from '@/common/chain/payment-verifier.service';
import { BitcoinPaymentVerifier } from '@/common/chain/verifiers/bitcoin.verifier';
import { TronPaymentVerifier } from '@/common/chain/verifiers/tron.verifier';
import { CounterService } from '@/common/metrics/counter.service';
import { ServiceCounterEntity } from '@/common/metrics/service-counter.entity';
import { validateEnv } from '@/config/env';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { DatabaseModule } from '@/database/database.module';
import { MonitorConfig } from '@/monitor/monitor-config';
import { HealthSignalsService } from '@/monitor/services/health-signals.service';
import { MonitorRunnerService } from '@/monitor/services/monitor-runner.service';
import { PauserService } from '@/monitor/services/pauser.service';
import { PaymentSamplerService } from '@/monitor/services/payment-sampler.service';
import { SupplyReconcilerService } from '@/monitor/services/supply-reconciler.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: process.env.MONITOR_ENV_FILE || '.env',
    }),
    DatabaseModule,
    HttpModule,
    TypeOrmModule.forFeature([
      Coupon,
      Payment,
      Merchant,
      IndexerCursor,
      ClaimEntity,
      ServiceCounterEntity,
    ]),
  ],
  providers: [
    MonitorConfig,
    { provide: CHAIN_VIEW_CONFIG, useExisting: MonitorConfig },
    AlertService,
    CounterService,
    ConfirmationPolicy,
    PaymentVerifierService,
    TronPaymentVerifier,
    BitcoinPaymentVerifier,
    PauserService,
    SupplyReconcilerService,
    PaymentSamplerService,
    HealthSignalsService,
    MonitorRunnerService,
  ],
})
export class MonitorModule {}
