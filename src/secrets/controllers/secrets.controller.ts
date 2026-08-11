import {
  Body,
  Controller,
  Delete,
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
      'Body carries `entropy` (client-side ciphertext) and optional free-form `metadata`. The string is stored as-is — the server never sees plaintext and never parses the blob. A write overwrites the previous entropy, so a user holds at most one.',
  })
  @ApiNoContentResponse({ description: 'Entropy stored' })
  storeEntropy(@CurrentUser() user: IAuthUser, @Body() dto: StoreSecretDTO) {
    return this.secretsService.store(user.userId, ESecretKind.ENTROPY, dto);
  }

  @Get('entropy')
  @ApiOperation({
    summary: 'Get entropy',
    description:
      'The stored entropy with its metadata, for client-side decryption. Single-element list, empty when nothing is stored.',
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

  @Delete('entropy')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete entropy',
    description:
      'Drops the entropy blob this user stored. The server holds ciphertext it cannot read, so the delete is permanent and unrecoverable — a client without its own copy has lost the wallet. Deleting nothing is still 204.',
  })
  @ApiNoContentResponse({ description: 'Entropy deleted' })
  async deleteEntropy(@CurrentUser() user: IAuthUser) {
    await this.secretsService.remove(user.userId, ESecretKind.ENTROPY);
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

  @Delete('seed')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete seed',
    description: 'Same contract as the entropy delete, and just as permanent.',
  })
  @ApiNoContentResponse({ description: 'Seed deleted' })
  async deleteSeed(@CurrentUser() user: IAuthUser) {
    await this.secretsService.remove(user.userId, ESecretKind.SEED);
  }
}
