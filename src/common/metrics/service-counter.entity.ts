import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Cumulative counters the monitor reads from another process.
 *
 * Deliberately dumb: a name and a number. The monitor lives in a different
 * account and cannot read the API's logs or metrics endpoint, so the few
 * numbers it needs to tell "the indexer is quiet" from "the indexer is broken"
 * are written where both can see them.
 */
@Entity('service_counters')
export class ServiceCounterEntity {
  @PrimaryColumn({ type: 'varchar' })
  name: string;

  @Column({ type: 'bigint', default: 0 })
  value: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}

export const COUNTER_INDEXER_REQUESTS = 'indexer.requests';
export const COUNTER_INDEXER_ERRORS = 'indexer.errors';
export const COUNTER_INDEXER_RATE_LIMITED = 'indexer.rate_limited';
