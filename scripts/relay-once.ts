/**
 * One relayer pass, then exit — the submission equivalent of `poll:once`.
 *
 *   RELAYER_ENV_FILE=.env npm run relay:once
 *
 * Submits at most `RELAYER_BATCH_SIZE` attested claims and waits for their
 * receipts, so the walkthrough can watch one claim settle instead of guessing
 * when the timer last fired.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';

import { RelayerModule } from '@/relayer/relayer.module';
import { RelayerRunnerService } from '@/relayer/services/relayer-runner.service';

async function main() {
  const app = await NestFactory.createApplicationContext(RelayerModule, {
    logger: ['log', 'warn', 'error'],
  });
  await app.get(RelayerRunnerService).tick();
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
