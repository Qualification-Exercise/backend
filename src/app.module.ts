import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { SecretsModule } from '@/secrets/secrets.module';
import { BalancesModule } from '@/balances/balances.module';
import { AttestationsModule } from '@/attestations/attestations.module';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
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
        ttl: 60_000,
        limit: 60,
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
    SecretsModule,
    BalancesModule,
    AttestationsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
