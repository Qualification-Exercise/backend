import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  OneToOne,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '@/users/entities/user.entity';
import { UtilityTokenClaim } from './utility-token-claim.entity';

/**
 * ```
 * PENDING -> ISSUED -> PENDING_ATTESTATION -> ATTESTED -> CLAIM_SUBMITTED -> CLAIMED
 *              ^             |                    |             |
 *              +------- (issuer rejection / deadline / reorg / tx failure)
 *
 * any -> EXPIRED / ORPHANED
 * ```
 * The migration installs a trigger that rejects any transition not on this list,
 * so an illegal move fails at the database rather than in whichever service got
 * its state handling wrong.
 */
export type CouponStatus =
  | 'PENDING'
  | 'ISSUED'
  | 'PENDING_ATTESTATION'
  | 'ATTESTED'
  | 'CLAIM_SUBMITTED'
  | 'CLAIMED'
  | 'EXPIRED'
  | 'ORPHANED';

@Entity('coupons')
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  paymentRef: string;

  @Column({ unique: true })
  code: string;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'numeric', precision: 78, scale: 0 })
  amount: string;

  @Column()
  asset: string;

  @Index()
  @Column({ type: 'varchar', default: 'ISSUED' })
  status: CouponStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @ManyToOne(() => User, (user) => user.coupons, { onDelete: 'CASCADE' })
  user: User;

  @OneToOne(() => UtilityTokenClaim, (claim) => claim.coupon, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  claim: UtilityTokenClaim;
}
