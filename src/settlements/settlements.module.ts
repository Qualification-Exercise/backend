import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClaimsModule } from '@/claims/claims.module';
import { ClaimEntity } from '@/claims/entities/claim.entity';
import { AlertService } from '@/common/alerts/alert.service';
import { EventCursorEntity } from '@/common/chain/event-cursor.entity';
import { validateEnv } from '@/config/env';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { DatabaseModule } from '@/database/database.module';
import { SettlementEntity } from '@/settlements/entities/settlement.entity';
import { SettlementWatcherService } from '@/settlements/services/settlement-watcher.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: process.env.SETTLEMENT_ENV_FILE || '.env',
    }),
    DatabaseModule,
    HttpModule,
    ClaimsModule,
    TypeOrmModule.forFeature([
      ClaimEntity,
      Coupon,
      SettlementEntity,
      EventCursorEntity,
    ]),
  ],
  providers: [AlertService, SettlementWatcherService],
})
export class SettlementsModule {}
