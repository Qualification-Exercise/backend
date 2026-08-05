import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { ListCouponsDTO } from '@/coupons/dtos/list-coupons.dto';
import { CouponsService } from '@/coupons/services/coupons.service';

@ApiTags('coupons')
@ApiBearerAuth('jwt')
@Controller('coupons')
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my coupons',
    description:
      'Cursor-paginated, newest first. Pass the returned `cursor` back to fetch the next page.',
  })
  @ApiOkResponse({
    description: 'Page of coupons plus the next `cursor` (null when exhausted)',
  })
  list(@CurrentUser() user: IAuthUser, @Query() query: ListCouponsDTO) {
    return this.couponsService.list(user.userId, query);
  }

  @Get('by-code/:code')
  @ApiOperation({ summary: 'Get one of my coupons by its redeem code' })
  @ApiParam({ name: 'code', description: 'Coupon code', example: 'CB-8F3A21' })
  findByCode(@CurrentUser() user: IAuthUser, @Param('code') code: string) {
    return this.couponsService.findByCode(user.userId, code);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of my coupons by id' })
  @ApiParam({ name: 'id', description: 'Coupon UUID', format: 'uuid' })
  findById(@CurrentUser() user: IAuthUser, @Param('id') id: string) {
    return this.couponsService.findById(user.userId, id);
  }
}
