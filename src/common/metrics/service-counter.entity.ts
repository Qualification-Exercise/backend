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

// The issuer's only trace in the database used to be a signature, so "the loop
// is running but signing nothing" and "the process is dead" looked identical
// from psql — which is the one place you can look when the host's logs are not
// yours. `ticks` is the heartbeat (its updated_at is the last pass) and
// `claims_seen` says whether the pass found anything to work on.
export const COUNTER_ISSUER_TICKS = 'issuer.ticks';
export const COUNTER_ISSUER_CLAIMS_SEEN = 'issuer.claims_seen';
