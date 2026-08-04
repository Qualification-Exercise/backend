import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/config/env';
import { SECRETS_KDF_FLOOR } from '@/secrets/kdf-floor';

const PAGE_SIZE = 10;

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  @Get()
  get() {
    const cashbackBps = this.configService.get('CASHBACK_BPS');
    return {
      utlUsdRate: this.configService.get('UTL_USD_RATE'),
      cashbackBps,
      cashbackRate: cashbackBps / 10_000,
      confirmationDepths: JSON.parse(
        this.configService.get('CONFIRMATION_DEPTHS'),
      ),
      secretsKdfFloor: SECRETS_KDF_FLOOR,
      pageSize: PAGE_SIZE,
    };
  }
}
