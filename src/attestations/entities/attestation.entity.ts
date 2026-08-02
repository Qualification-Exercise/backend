import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ClaimEntity } from '@/claims/entities/claim.entity';

@Entity('attestations')
@Index(
  'IDX_attestations_claim_id_issuer_address',
  ['claimId', 'issuerAddress'],
  { unique: true },
)
export class AttestationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'claim_id', type: 'uuid' })
  claimId: string;

  @Column({ name: 'issuer_address', type: 'varchar' })
  issuerAddress: string;

  @Column({ name: 'signature', type: 'varchar' })
  signature: string;

  @Column({ name: 'chain_id', type: 'varchar' })
  chainId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @ManyToOne(() => ClaimEntity, (claim) => claim.attestations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'claim_id' })
  claim: ClaimEntity;
}
