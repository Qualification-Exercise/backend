import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '@/app.module';
import { AlertService, EAlertSeverity } from '@/common/alerts/alert.service';
import { EProcessRole } from '@/config/process-role.enum';
import { validateEnv } from '@/config/env';
import { setupSwagger } from '@/common/utils/swagger.util';
import { pino } from 'pino';
import helmet from 'helmet';

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
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const env = validateEnv(process.env);

  const corsOrigins =
    env.CORS_ORIGINS === '*'
      ? '*'
      : env.CORS_ORIGINS.split(',').map((origin) => origin.trim());

  // swagger-ui bootstraps itself with an inline <script> and inline styles, so
  // the default CSP would blank out /docs. The relaxation is scoped to that
  // one path — a documentation page must not set the policy for the API.
  app.use(
    '/docs',
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
        },
      },
    }),
  );
  app.use(helmet());

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

  app.useBodyParser('json', { limit: 51_200 });

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

  // Nothing else keeps a worker alive. It serves no HTTP, and IntervalLoop
  // unrefs its timer so tests do not hang — so once the pg pool closes its idle
  // sockets (~10s) the event loop empties and node exits 0, before a 30s tick
  // ever fires. The supervisor then restarts it, forever. This handle is the
  // process's reason to exist; clearing it on the signals keeps `docker stop`
  // a clean exit instead of a wait for SIGKILL.
  const keepAlive = setInterval(() => {}, 1 << 30);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => clearInterval(keepAlive));
  }

  new Logger(name).log(`${name} process started (no inbound HTTP)`);

  // Says the process is up *and* that the alert channel works. Without it the
  // only proof of delivery is an incident, which is the worst moment to find
  // out the webhook was misconfigured. Every worker module provides
  // AlertService, so this is not optional wiring.
  await app.get(AlertService).raise({
    code: 'service.started',
    severity: EAlertSeverity.INFO,
    subject: name,
    message: `${name} is up and watching`,
  });
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
