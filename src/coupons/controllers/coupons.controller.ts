import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { ListCouponsDTO } from '@/coupons/dtos/list-coupons.dto';
import { CouponsService } from '@/coupons/services/coupons.service';

@Controller('coupons')
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  list(@CurrentUser() user: IAuthUser, @Query() query: ListCouponsDTO) {
    return this.couponsService.list(user.userId, query);
  }

  @Get('by-code/:code')
  findByCode(@CurrentUser() user: IAuthUser, @Param('code') code: string) {
    return this.couponsService.findByCode(user.userId, code);
  }

  @Get(':id')
  findById(@CurrentUser() user: IAuthUser, @Param('id') id: string) {
    return this.couponsService.findById(user.userId, id);
  }
}
