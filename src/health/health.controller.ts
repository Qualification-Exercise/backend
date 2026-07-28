import { Controller, Get } from '@nestjs/common';
import { HealthService } from './services/health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly _healthService: HealthService) {}

  @Get()
  async getHealth(): Promise<any> {
    return this._healthService.check();
  }
}
