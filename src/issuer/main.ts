import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { IssuerModule } from '@/issuer/issuer.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(IssuerModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  new Logger('Issuer').log('Issuer process started (no inbound HTTP)');
}

void bootstrap();
