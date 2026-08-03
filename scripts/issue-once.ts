/**
 * One attestation pass, then exit — the issuer equivalent of `poll:once`.
 *
 *   ISSUER_ENV_FILE=.env npm run issue:once
 *
 * Useful for the manual walkthrough: run it, read the verdict, stop. The long
 * running process is the same code on a timer.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';

import { IssuerModule } from '@/issuer/issuer.module';
import { IssuerRunnerService } from '@/issuer/services/issuer-runner.service';

async function main() {
  const app = await NestFactory.createApplicationContext(IssuerModule, {
    logger: ['log', 'warn', 'error'],
  });
  await app.get(IssuerRunnerService).tick();
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
