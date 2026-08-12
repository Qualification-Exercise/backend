import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IndexerService } from '@/indexer/services/indexer.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

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
    const dbOk = await this.pingDatabase();
    const breakerState = this.indexer.getBreakerState();

    return {
      status: dbOk ? 'ok' : 'error',
      database: dbOk ? 'connected' : 'disconnected',
      indexer: { breaker: breakerState },
      timestamp: new Date().toISOString(),
    };
  }

  private async pingDatabase(): Promise<boolean> {
    if (!this.dataSource.isInitialized) return false;
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch (err) {
      this.logger.error(`Health check: database unreachable: ${String(err)}`);
      return false;
    }
  }
}
