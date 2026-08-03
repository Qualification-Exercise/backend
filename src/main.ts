import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
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

async function bootstrap() {
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
  _logger.info(`Swagger docs available at: http://localhost:${port}/api`);
}

bootstrap().catch((err) => {
  _logger.error(err);
  process.exit(1);
});
