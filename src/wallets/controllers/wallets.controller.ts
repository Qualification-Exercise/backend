import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { LinkWalletsDTO } from '@/wallets/dtos/link-wallets.dto';
import { WalletsService } from '@/wallets/services/wallets.service';

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}
  @Post()
  link(@CurrentUser() user: IAuthUser, @Body() dto: LinkWalletsDTO) {
    return this.walletsService.linkWallets(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: IAuthUser) {
    return this.walletsService.listWallets(user.userId);
  }
}
