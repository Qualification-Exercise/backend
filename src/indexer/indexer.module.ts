import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { IndexerService } from './services/indexer.service';
import { IndexerController } from './controllers/indexer.controller';

@Module({
  imports: [HttpModule],
  providers: [IndexerService],
  controllers: [IndexerController],
  exports: [IndexerService],
})
export class IndexerModule {}
