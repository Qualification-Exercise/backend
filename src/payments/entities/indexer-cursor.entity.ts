import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('indexer_cursors')
@Unique(['srcChainId', 'token', 'address'])
export class IndexerCursor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint' })
  srcChainId: number;

  @Column()
  token: string;

  @Column()
  address: string;

  @Column({ type: 'int', default: 0 })
  seenCount: number = 0;

  @Column({ type: 'bigint', default: -1 })
  lastBlockNumber: number = -1;

  @Column({ type: 'int', default: -1 })
  lastTransactionIndex: number = -1;

  @Column({ type: 'int', default: -1 })
  lastTransferIndex: number = -1;

  @Column({ type: 'timestamptz', nullable: true })
  lastPolledAt: Date | null = null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
