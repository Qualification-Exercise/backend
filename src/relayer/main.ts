import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { RelayerModule } from '@/relayer/relayer.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(RelayerModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  new Logger('Relayer').log('Relayer process started (no inbound HTTP)');
}

void bootstrap();
