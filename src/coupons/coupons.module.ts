import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from './entities/coupon.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { AlertService } from '@/common/alerts/alert.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { AccrualService } from './services/accrual.service';
import { CouponsService } from './services/coupons.service';
import { CouponsController } from './controllers/coupons.controller';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([Coupon, Payment, PriceSnapshot, IndexerCursor]),
  ],
  providers: [AlertService, ConfirmationPolicy, CouponsService, AccrualService],
  controllers: [CouponsController],
  exports: [CouponsService, AccrualService],
})
export class CouponsModule {}
