/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { HealthService } from './services/health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly _healthService: HealthService) {}

  @Get()
  @Throttle({ default: { limit: 10, ttl: 3600000 } })
  async getHealth(): Promise<any> {
    return this._healthService.check();
  }
}
