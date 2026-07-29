import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { PaymentEntity } from '@/payments/entities/payment.entity';

@Entity('price_snapshots')
@Index('IDX_price_snapshots_payment_id', ['paymentId'], { unique: true })
export class PriceSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId: string;

  @Column({ name: 'asset_usd_price', type: 'decimal', precision: 20, scale: 8 })
  assetUsdPrice: string;

  @Column({ name: 'snapshot_timestamp', type: 'timestamp with time zone' })
  snapshotTimestamp: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @OneToOne(() => PaymentEntity, (payment) => payment.priceSnapshot, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'payment_id' })
  payment: PaymentEntity;
}
