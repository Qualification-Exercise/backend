import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: '.env',
    }),
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
  ],
})
export class AppModule {}
