import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';
import { PriceSource } from '@/pricing/price-source';
import { PricingService } from '@/pricing/services/pricing.service';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, PriceSnapshot])],
  providers: [PricingService, PriceSource],
  exports: [PricingService],
})
export class PricingModule {}
