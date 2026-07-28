import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToOne,
} from 'typeorm';
import { User } from '@/users/entities/user.entity';
import { Transaction } from '@/transactions/entities/transaction.entity';
import { UtilityTokenClaim } from './utility-token-claim.entity';

@Entity('coupons')
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column('decimal', { precision: 18, scale: 8 })
  value: string;

  @Column({ enum: ['BTC', 'USDT'] })
  asset: string;

  @Column({
    enum: ['issued', 'claimed', 'expired'],
    default: 'issued',
  })
  status: string;

  @Column({ nullable: true })
  sourceTransactionId: string;

  @Column()
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  expiresAt: Date;

  @ManyToOne(() => User, (user) => user.coupons, { onDelete: 'CASCADE' })
  user: User;

  @ManyToOne(() => Transaction, (transaction) => transaction.coupons, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  sourceTransaction: Transaction;

  @OneToOne(() => UtilityTokenClaim, (claim) => claim.coupon, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  claim: UtilityTokenClaim;
}
