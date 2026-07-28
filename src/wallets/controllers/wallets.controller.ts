import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { LinkWalletDTO } from '@/wallets/dtos/link-wallet.dto';
import { WalletsService } from '@/wallets/services/wallets.service';

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get('challenge')
  challenge(@CurrentUser() user: IAuthUser) {
    return this.walletsService.createChallenge(user.userId);
  }

  @Post()
  link(@CurrentUser() user: IAuthUser, @Body() dto: LinkWalletDTO) {
    return this.walletsService.linkWallet(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: IAuthUser) {
    return this.walletsService.listWallets(user.userId);
  }
}
