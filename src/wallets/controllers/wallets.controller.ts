import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { LinkWalletsDTO } from '@/wallets/dtos/link-wallets.dto';
import { WalletsService } from '@/wallets/services/wallets.service';

@ApiTags('wallets')
@ApiBearerAuth('jwt')
@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post()
  @ApiOperation({
    summary: 'Link chain addresses',
    description:
      'Registers up to 8 client-derived addresses (keys never leave the client). One address per chain, and the EVM address is required — it is the payout recipient. Re-sending the same address is a no-op; sending a *different* address for a chain already linked is rejected and needs an explicit reset.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Address already linked to another user',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'CHAIN_MISMATCH, INVALID_ADDRESS, DUPLICATE_CHAIN, UNKNOWN_CHAIN or NO_PRIMARY_WALLET',
  })
  link(@CurrentUser() user: IAuthUser, @Body() dto: LinkWalletsDTO) {
    return this.walletsService.linkWallets(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List my linked wallets' })
  @ApiOkResponse({
    description: 'Linked addresses per chain, with the primary one flagged',
  })
  list(@CurrentUser() user: IAuthUser) {
    return this.walletsService.listWallets(user.userId);
  }
}
