import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ServiceCounterEntity } from '@/common/metrics/service-counter.entity';

/**
 * Fire-and-forget counters. A counter that failed to increment must never take
 * down the request it was counting, so every failure here is swallowed after
 * one log line — this is telemetry, not bookkeeping.
 */
@Injectable()
export class CounterService {
  private readonly logger = new Logger(CounterService.name);

  constructor(
    @InjectRepository(ServiceCounterEntity)
    private readonly counters: Repository<ServiceCounterEntity>,
  ) {}

  increment(name: string, by = 1): void {
    void this.counters
      .query(
        `INSERT INTO service_counters (name, value) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE
           SET value = service_counters.value + $2, updated_at = now()`,
        [name, by],
      )
      .catch((err: unknown) =>
        this.logger.debug(`Counter ${name} not recorded: ${String(err)}`),
      );
  }

  async read(names: string[]): Promise<Record<string, number>> {
    const rows = (await this.counters.query(
      `SELECT name, value FROM service_counters WHERE name = ANY($1)`,
      [names],
    )) as { name: string; value: string }[];

    return Object.fromEntries(
      names.map((name) => [
        name,
        Number(rows.find((row) => row.name === name)?.value ?? 0),
      ]),
    );
  }
}
