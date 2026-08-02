import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentStatus = 'pending' | 'confirmed' | 'ignored' | 'orphaned';

@Entity('payments')
@Unique(['srcChainId', 'txHash', 'outputIndex'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  paymentRef: string;

  @Column({ type: 'bigint' })
  srcChainId: number;

  @Column()
  txHash: string;

  @Column({ type: 'int' })
  outputIndex: number;

  @Column({ type: 'bigint' })
  blockNumber: number;

  @Column()
  token: string;

  @Column({ type: 'numeric', precision: 78, scale: 0 })
  amount: string;

  @Column()
  fromAddress: string;

  @Index()
  @Column()
  merchantAddress: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Index()
  @Column({ type: 'varchar', default: 'pending' })
  status: PaymentStatus;

  @Column({ type: 'timestamptz' })
  transferredAt: Date;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
