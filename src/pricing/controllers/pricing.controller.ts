import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GetLivePricingDto } from '@/pricing/dtos/get-live-pricing.dto';
import { PricingService } from '@/pricing/services/pricing.service';

@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get('live')
  @ApiOperation({
    summary: 'Live prices',
    description:
      'Prices for the comma-separated `fromSources` assets quoted in `to` (USD by default). Public — no token required.',
  })
  @ApiOkResponse({ description: 'Current prices for requested assets' })
  async getLivePricing(@Query() dto: GetLivePricingDto) {
    return this.pricingService.getLivePricing({
      fromSources: dto.fromSources.split(',').map((s) => s.trim()),
      to: dto.to,
    });
  }
}
