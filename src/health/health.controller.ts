import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { HealthService } from './services/health.service';
import { HealthResponseDTO } from './dtos/health-response.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly _healthService: HealthService) {}

  @Get()
  @Throttle({ default: { limit: 10, ttl: 3600000 } })
  @ApiOperation({
    summary: 'Service health',
    description:
      'Reports database connectivity and the indexer circuit-breaker state. Served outside the /api prefix.',
  })
  @ApiOkResponse({ type: HealthResponseDTO })
  async getHealth(): Promise<HealthResponseDTO> {
    return this._healthService.check();
  }
}
