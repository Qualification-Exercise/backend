import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(private dataSource: DataSource) {}

  async check(): Promise<{
    status: string;
    database: string;
    timestamp: string;
  }> {
    const dbOk = this.dataSource.isInitialized;

    return {
      status: dbOk ? 'ok' : 'error',
      database: dbOk ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }
}
