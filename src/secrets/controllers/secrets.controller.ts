import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { StoreSecretDTO } from '@/secrets/dtos/store-secret.dto';
import { SecretsService } from '@/secrets/services/secrets.service';
import { ESecretKind } from '@/wallets/entities/wallet-secret.entity';

@ApiTags('secrets')
@ApiBearerAuth('jwt')
@Controller('secrets')
@UseGuards(JwtAuthGuard)
export class SecretsController {
  constructor(private readonly secretsService: SecretsService) {}

  @Post('entropy')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Store entropy',
    description:
      'Body carries `entropy` (client-side ciphertext) and optional free-form `metadata`. The string is stored as-is — the server never sees plaintext and never parses the blob. Writes append, so a user can hold several.',
  })
  @ApiNoContentResponse({ description: 'Entropy stored' })
  storeEntropy(@CurrentUser() user: IAuthUser, @Body() dto: StoreSecretDTO) {
    return this.secretsService.store(user.userId, ESecretKind.ENTROPY, dto);
  }

  @Get('entropy')
  @ApiOperation({
    summary: 'Get entropy',
    description:
      'Every stored entropy with its metadata, for client-side decryption. Empty list when nothing is stored.',
  })
  @ApiOkResponse({
    schema: {
      example: { entropies: [{ entropy: 'ciphertext', metadata: { v: 1 } }] },
    },
  })
  async getEntropy(@CurrentUser() user: IAuthUser) {
    return {
      entropies: await this.secretsService.list(
        user.userId,
        ESecretKind.ENTROPY,
      ),
    };
  }

  @Post('seed')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Store seed',
    description:
      'Same contract as the entropy route, but the body carries `seed` instead.',
  })
  @ApiNoContentResponse({ description: 'Seed stored' })
  storeSeed(@CurrentUser() user: IAuthUser, @Body() dto: StoreSecretDTO) {
    return this.secretsService.store(user.userId, ESecretKind.SEED, dto);
  }

  @Get('seed')
  @ApiOperation({
    summary: 'Get seed',
    description: 'Same contract as the entropy read.',
  })
  @ApiOkResponse({
    schema: {
      example: { seeds: [{ seed: 'ciphertext', metadata: { v: 1 } }] },
    },
  })
  async getSeed(@CurrentUser() user: IAuthUser) {
    return {
      seeds: await this.secretsService.list(user.userId, ESecretKind.SEED),
    };
  }
}
