import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { BalancesService } from '@/balances/services/balances.service';

@ApiTags('balances')
@ApiBearerAuth('jwt')
@Controller('balances')
@UseGuards(JwtAuthGuard)
export class BalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  @Get()
  @ApiOperation({
    summary: 'List my cached balances',
    description:
      'Served from cache, never proxied to the indexer inline. Each item carries `observedAt` and `stale`; a stale read triggers a background refresh, so poll again after `ttlSeconds`.',
  })
  @ApiOkResponse({
    description: 'Cached per-chain/token balances plus the cache `ttlSeconds`',
  })
  list(@CurrentUser() user: IAuthUser) {
    return this.balancesService.list(user.userId);
  }
}
