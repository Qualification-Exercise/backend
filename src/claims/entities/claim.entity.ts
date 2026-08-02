import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { AttestationEntity } from '@/attestations/entities/attestation.entity';
import { EClaimStatus } from '@/claims/enums/claim-status.enum';

@Entity('claims')
@Index('IDX_claims_coupon_id', ['couponId'], { unique: true })
@Index('IDX_claims_status', ['status'])
export class ClaimEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'coupon_id', type: 'uuid' })
  couponId: string;

  @Column({ name: 'recipient', type: 'varchar' })
  recipient: string;

  @Column({ name: 'amount', type: 'decimal', precision: 40, scale: 0 })
  amount: string; // Wei-level precision (no decimal places); frozen at claim creation for relayer

  @Column({ name: 'deadline', type: 'bigint' })
  deadline: number; // Unix timestamp in seconds

  @Column({
    name: 'status',
    type: 'enum',
    enum: EClaimStatus,
    default: EClaimStatus.PENDING_ATTESTATION,
  })
  status: EClaimStatus;

  @Column({ name: 'tx_hash', type: 'varchar', nullable: true })
  txHash: string | null;

  @Column({ name: 'tx_nonce', type: 'int', nullable: true })
  txNonce: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @ManyToOne(() => Coupon, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coupon_id' })
  coupon: Coupon;

  @OneToMany(() => AttestationEntity, (attestation) => attestation.claim)
  attestations: AttestationEntity[];
}
