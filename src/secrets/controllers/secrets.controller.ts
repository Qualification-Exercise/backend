import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { PutSecretDTO } from '@/secrets/dtos/put-secret.dto';
import { SecretsService } from '@/secrets/services/secrets.service';

const ONE_HOUR_MS = 3_600_000;

@ApiTags('secrets')
@ApiBearerAuth('jwt')
@Controller('secrets')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class SecretsController {
  constructor(private readonly secretsService: SecretsService) {}

  @Put('entropy')
  @ApiOperation({
    summary: 'Store the encrypted entropy blob',
    description:
      'Body must carry `entropy` (client-side ciphertext, base64) — the server never sees plaintext. `metadata.address` must equal the linked primary wallet address, and the `kdf` parameters must meet the floor published by `GET /config` (`secretsKdfFloor`).',
  })
  putEntropy(@CurrentUser() user: IAuthUser, @Body() dto: PutSecretDTO) {
    return this.secretsService.put(user.userId, 'entropy', dto);
  }

  @Put('seed')
  @ApiOperation({
    summary: 'Store the encrypted seed blob',
    description:
      'Same contract as the entropy route, but the body must carry `seed` instead.',
  })
  putSeed(@CurrentUser() user: IAuthUser, @Body() dto: PutSecretDTO) {
    return this.secretsService.put(user.userId, 'seed', dto);
  }

  // Reads are the credential-stuffing surface: a restore is rare, a run
  // against everyone's backups is not.
  @Get('entropy')
  @Throttle({ default: { limit: 5, ttl: ONE_HOUR_MS } })
  @ApiOperation({
    summary: 'Fetch the encrypted entropy blob',
    description:
      'Returns the ciphertext and its KDF parameters for client-side decryption. Rate limit: 5/hour.',
  })
  @ApiOkResponse({ description: 'Ciphertext, wrapped key and KDF parameters' })
  getEntropy(@CurrentUser() user: IAuthUser) {
    return this.secretsService.get(user.userId, 'entropy');
  }

  @Get('seed')
  @Throttle({ default: { limit: 5, ttl: ONE_HOUR_MS } })
  @ApiOperation({
    summary: 'Fetch the encrypted seed blob',
    description: 'Same contract as the entropy read. Rate limit: 5/hour.',
  })
  @ApiOkResponse({ description: 'Ciphertext, wrapped key and KDF parameters' })
  getSeed(@CurrentUser() user: IAuthUser) {
    return this.secretsService.get(user.userId, 'seed');
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my stored blobs',
    description: 'Removes both entropy and seed. Irreversible.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  remove(@CurrentUser() user: IAuthUser) {
    return this.secretsService.remove(user.userId);
  }
}
