import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from './entities/coupon.entity';
import { UtilityTokenClaim } from './entities/utility-token-claim.entity';
import { CouponsService } from './services/coupons.service';
import { CouponsController } from './controllers/coupons.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Coupon, UtilityTokenClaim])],
  providers: [CouponsService],
  controllers: [CouponsController],
  exports: [CouponsService],
})
export class CouponsModule {}
