import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { MonitorModule } from '@/monitor/monitor.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(MonitorModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  new Logger('Monitor').log('Monitor started (no inbound HTTP)');
}

void bootstrap();
