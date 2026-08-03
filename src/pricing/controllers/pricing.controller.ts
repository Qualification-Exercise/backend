import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { GetLivePricingDto } from '@/pricing/dtos/get-live-pricing.dto';
import { PricingService } from '@/pricing/services/pricing.service';

@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get('live')
  @ApiOkResponse({ description: 'Current prices for requested assets' })
  async getLivePricing(@Query() dto: GetLivePricingDto) {
    return this.pricingService.getLivePricing({
      fromSources: dto.fromSources.split(',').map((s) => s.trim()),
      to: dto.to,
    });
  }
}
