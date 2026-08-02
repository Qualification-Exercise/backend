import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('price_snapshots')
export class PriceSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  paymentRef: string;

  @Column()
  asset: string;

  @Column({ default: 'USD' })
  quote: string;

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  price: string;

  @Column()
  source: string;

  @Column({ type: 'timestamptz' })
  providerTimestamp: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  ingestedAt: Date;
}
