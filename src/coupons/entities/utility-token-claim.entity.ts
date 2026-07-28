import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Coupon } from './coupon.entity';

@Entity('utility_token_claims')
export class UtilityTokenClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  couponId: string;

  @Column()
  walletAddress: string;

  @Column('decimal', { precision: 18, scale: 18 })
  amount: string;

  @Column({ nullable: true })
  txHash: string;

  @CreateDateColumn()
  claimedAt: Date;

  @OneToOne(() => Coupon, (coupon) => coupon.claim, { onDelete: 'CASCADE' })
  @JoinColumn()
  coupon: Coupon;
}
