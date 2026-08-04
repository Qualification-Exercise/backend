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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import {
  CurrentUser,
  type IAuthUser,
} from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { PutSecretDTO } from '@/secrets/dtos/put-secret.dto';
import { SecretsService } from '@/secrets/services/secrets.service';

const ONE_HOUR_MS = 3_600_000;

@Controller('secrets')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class SecretsController {
  constructor(private readonly secretsService: SecretsService) {}

  @Put('entropy')
  putEntropy(@CurrentUser() user: IAuthUser, @Body() dto: PutSecretDTO) {
    return this.secretsService.put(user.userId, 'entropy', dto);
  }

  @Put('seed')
  putSeed(@CurrentUser() user: IAuthUser, @Body() dto: PutSecretDTO) {
    return this.secretsService.put(user.userId, 'seed', dto);
  }

  // Reads are the credential-stuffing surface: a restore is rare, a run
  // against everyone's backups is not.
  @Get('entropy')
  @Throttle({ default: { limit: 5, ttl: ONE_HOUR_MS } })
  getEntropy(@CurrentUser() user: IAuthUser) {
    return this.secretsService.get(user.userId, 'entropy');
  }

  @Get('seed')
  @Throttle({ default: { limit: 5, ttl: ONE_HOUR_MS } })
  getSeed(@CurrentUser() user: IAuthUser) {
    return this.secretsService.get(user.userId, 'seed');
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: IAuthUser) {
    return this.secretsService.remove(user.userId);
  }
}
