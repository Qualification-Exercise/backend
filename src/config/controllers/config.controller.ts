import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PAGE_SIZE } from '@/common/pagination/keyset-cursor';
import type { Env } from '@/config/env';

@ApiTags('config')
@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  @Get()
  @ApiOperation({
    summary: 'Public runtime configuration',
    description:
      'Values clients must not hardcode: UTL/USD rate, cashback rate, per-chain confirmation depths, and the list page size.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        utlUsdRate: 1,
        cashbackBps: 200,
        cashbackRate: 0.02,
        confirmationDepths: { '1': 12, '42161': 20 },
        pageSize: 10,
      },
    },
  })
  get() {
    const cashbackBps = this.configService.get('CASHBACK_BPS');
    return {
      utlUsdRate: this.configService.get('UTL_USD_RATE'),
      cashbackBps,
      cashbackRate: cashbackBps / 10_000,
      confirmationDepths: JSON.parse(
        this.configService.get('CONFIRMATION_DEPTHS'),
      ),
      pageSize: PAGE_SIZE,
    };
  }
}
