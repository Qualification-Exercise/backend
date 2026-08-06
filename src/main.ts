import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { EProcessRole } from '@/config/process-role.enum';
import { validateEnv } from '@/config/env';
import { setupSwagger } from '@/common/utils/swagger.util';
import { pino } from 'pino';

const _logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      singleLine: false,
    },
  },
});

async function bootstrapApi() {
  const app = await NestFactory.create(AppModule);
  const env = validateEnv(process.env);

  const corsOrigins =
    env.CORS_ORIGINS === '*'
      ? '*'
      : env.CORS_ORIGINS.split(',').map((origin) => origin.trim());

  app.enableCors({
    origin: corsOrigins,
    credentials: corsOrigins !== '*',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api', { exclude: ['health'] });

  const port = env.PORT;
  setupSwagger(app, port);

  await app.listen(port);

  _logger.info(`Application is running on: http://localhost:${port}`);
  _logger.info(`Swagger docs available at: http://localhost:${port}/docs`);
}

async function bootstrapWorker(module: unknown, name: string): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    module as Parameters<typeof NestFactory.createApplicationContext>[0],
    { bufferLogs: false },
  );
  app.enableShutdownHooks();
  new Logger(name).log(`${name} process started (no inbound HTTP)`);
}

async function bootstrap() {
  const role = (process.env.PROCESS_ROLE ?? EProcessRole.API) as EProcessRole;

  switch (role) {
    case EProcessRole.API:
      return bootstrapApi();
    case EProcessRole.ISSUER:
      return bootstrapWorker(
        (await import('@/issuer/issuer.module')).IssuerModule,
        'Issuer',
      );
    case EProcessRole.RELAYER:
      return bootstrapWorker(
        (await import('@/relayer/relayer.module')).RelayerModule,
        'Relayer',
      );
    case EProcessRole.SETTLEMENT:
      return bootstrapWorker(
        (await import('@/settlements/settlements.module')).SettlementsModule,
        'SettlementWatcher',
      );
    case EProcessRole.MONITOR:
      return bootstrapWorker(
        (await import('@/monitor/monitor.module')).MonitorModule,
        'Monitor',
      );
    default:
      throw new Error(
        `Unknown PROCESS_ROLE '${String(role)}'. ` +
          `Expected one of: ${Object.values(EProcessRole).join(', ')}`,
      );
  }
}

bootstrap().catch((err) => {
  _logger.error(err);
  process.exit(1);
});
