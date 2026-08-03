import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CounterService } from '@/common/metrics/counter.service';
import { ServiceCounterEntity } from '@/common/metrics/service-counter.entity';
import { IndexerService } from './services/indexer.service';
import { IndexerController } from './controllers/indexer.controller';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([ServiceCounterEntity])],
  providers: [IndexerService, CounterService],
  controllers: [IndexerController],
  exports: [IndexerService],
})
export class IndexerModule {}
