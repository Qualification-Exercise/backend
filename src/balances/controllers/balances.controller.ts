import { Controller, Get, UseGuards } from '@nestjs/common';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { BalancesService } from '@/balances/services/balances.service';

@Controller('balances')
@UseGuards(JwtAuthGuard)
export class BalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  @Get()
  list(@CurrentUser() user: IAuthUser) {
    return this.balancesService.list(user.userId);
  }
}
