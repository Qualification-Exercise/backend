import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { SettlementsModule } from '@/settlements/settlements.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SettlementsModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  new Logger('SettlementWatcher').log('Settlement watcher started');
}

void bootstrap();
