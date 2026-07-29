import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { Wallet } from '@/wallets/entities/wallet.entity';
import { Coupon } from '@/coupons/entities/coupon.entity';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  walletId: string;

  @Column()
  txHash: string;

  @Column({ enum: ['BTC', 'SPARK', 'ARBITRUM', 'ETHEREUM', 'POLYGON', 'TRON'] })
  chain: string;

  @Column({ enum: ['BTC', 'USDT'] })
  asset: string;

  @Column('decimal', { precision: 18, scale: 8 })
  amount: string;

  @Column({ enum: ['send', 'receive'] })
  direction: string;

  @Column({
    enum: ['pending', 'confirmed', 'failed'],
    default: 'pending',
  })
  status: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Wallet, (wallet) => wallet.transactions, {
    onDelete: 'CASCADE',
  })
  wallet: Wallet;

  @OneToMany(() => Coupon, (coupon) => coupon.sourceTransaction)
  coupons: Coupon[];
}
