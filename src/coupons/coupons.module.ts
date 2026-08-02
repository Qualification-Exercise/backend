import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from './entities/coupon.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { PaymentsModule } from '@/payments/payments.module';
import { AccrualService } from './services/accrual.service';
import { CouponsService } from './services/coupons.service';
import { CouponsController } from './controllers/coupons.controller';

@Module({
  imports: [
    PaymentsModule,
    TypeOrmModule.forFeature([Coupon, Payment, PriceSnapshot, IndexerCursor]),
  ],
  providers: [CouponsService, AccrualService],
  controllers: [CouponsController],
  exports: [CouponsService, AccrualService],
})
export class CouponsModule {}
