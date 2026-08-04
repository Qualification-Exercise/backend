import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Our copy of what the indexer last said a user's address holds.
 *
 * Non-authoritative by design: the device reads balances through WDK directly
 * and paints those first. This exists so the API can answer instantly without
 * putting user traffic on the third-party budget that payment detection needs.
 */
@Entity('balance_cache')
@Unique('UQ_balance_cache_user_chain_token', ['userId', 'srcChainId', 'token'])
export class BalanceCache {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'bigint' })
  srcChainId: number;

  @Column()
  token: string;

  @Column()
  address: string;

  @Column({ type: 'numeric', precision: 78, scale: 0 })
  amount: string;

  @Column({ type: 'int', nullable: true })
  decimals: number | null;

  @Column({ type: 'timestamptz' })
  observedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
