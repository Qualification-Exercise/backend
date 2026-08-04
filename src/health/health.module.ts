import { Module } from '@nestjs/common';
import { IndexerModule } from '@/indexer/indexer.module';
import { HealthService } from './services/health.service';
import { HealthController } from './health.controller';

@Module({
  imports: [IndexerModule],
  providers: [HealthService],
  controllers: [HealthController],
})
export class HealthModule {}
