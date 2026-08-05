import { Controller, Get } from '@nestjs/common';
import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { SecretsService } from '@/secrets/services/secrets.service';
import { WalletsService } from '@/wallets/services/wallets.service';
import { UsersService } from '../services/users.service';
import { ApiEndpoint } from '@/common/decorators/api-endpoint.decorator';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly secretsService: SecretsService,
  ) {}

  @Get('me')
  @ApiEndpoint({
    summary: 'Get current user profile',
    description:
      'Profile, wallet-mapping status and which encrypted blobs are stored',
  })
  async me(@CurrentUser() authUser: IAuthUser) {
    const [user, wallets, secrets] = await Promise.all([
      this.usersService.findById(authUser.userId),
      this.walletsService.listWallets(authUser.userId),
      this.secretsService.status(authUser.userId),
    ]);

    const primary = wallets.find((wallet) => wallet.primary);

    return {
      user: {
        id: user!.id,
        email: user!.email,
        firstName: user!.firstName,
        lastName: user!.lastName,
      },
      wallets: {
        linked: wallets.length > 0,
        primaryAddress: primary?.address ?? null,
        chains: wallets.map((wallet) => wallet.chain),
      },
      secrets,
    };
  }
}
