import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from '@/config/env';
import { DatabaseModule } from '@/database/database.module';
import { UsersModule } from '@/users/users.module';
import { WalletsModule } from '@/wallets/wallets.module';
import { TransactionsModule } from '@/transactions/transactions.module';
import { CouponsModule } from '@/coupons/coupons.module';
import { IndexerModule } from '@/indexer/indexer.module';
import { PaymentsModule } from '@/payments/payments.module';
import { PricingModule } from '@/pricing/pricing.module';
import { AppConfigModule } from '@/config/config.module';
import { AuthModule } from '@/auth/auth.module';
import { HealthModule } from '@/health/health.module';
import { ClaimsModule } from '@/claims/claims.module';
import { AttestationsModule } from '@/attestations/attestations.module';
import { APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 3600000,
        limit: 10,
      },
    ]),
    DatabaseModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    TransactionsModule,
    CouponsModule,
    IndexerModule,
    PaymentsModule,
    PricingModule,
    AppConfigModule,
    HealthModule,
    ClaimsModule,
    AttestationsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
