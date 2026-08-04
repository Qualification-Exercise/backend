import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IndexerService } from '@/indexer/services/indexer.service';

@Injectable()
export class HealthService {
  constructor(
    private dataSource: DataSource,
    private indexer: IndexerService,
  ) {}

  async check(): Promise<{
    status: string;
    database: string;
    indexer: { breaker: string };
    timestamp: string;
  }> {
    const dbOk = this.dataSource.isInitialized;
    const breakerState = this.indexer.getBreakerState();

    return {
      status: dbOk ? 'ok' : 'error',
      database: dbOk ? 'connected' : 'disconnected',
      indexer: { breaker: breakerState },
      timestamp: new Date().toISOString(),
    };
  }
}
