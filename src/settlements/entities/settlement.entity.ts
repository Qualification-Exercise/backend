import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('settlements')
@Index('IDX_settlements_payment_ref', ['paymentRef'], { unique: true })
export class SettlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'payment_ref', type: 'varchar' })
  paymentRef: string;

  @Column({ name: 'recipient', type: 'varchar' })
  recipient: string;

  @Column({ name: 'amount', type: 'decimal', precision: 40, scale: 0 })
  amount: string;

  @Column({ name: 'tx_hash', type: 'varchar' })
  txHash: string;

  @Column({ name: 'block_number', type: 'bigint' })
  blockNumber: number;

  @Column({ name: 'event_timestamp', type: 'timestamp with time zone' })
  eventTimestamp: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
