import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { ESignerRole } from '@/signers/enums/signer-role.enum';

/**
 * Who is allowed to sign what, by address.
 *
 * Public keys only — deliberately. A private key in a table is a private key in
 * every backup, every read replica and every `pg_dump` anyone ever took, and
 * the whole point of the issuer layer is that no single compromise yields the
 * ability to mint. Key material lives encrypted in each process's own
 * environment (`enc:` + Argon2id) and, in production, in KMS.
 *
 * This table is the registry the rest of the system checks against: an
 * attestation from an address that is not an active issuer here is a security
 * event, not a signature.
 */
@Entity('signers')
@Unique('UQ_signers_role_address', ['role', 'address'])
@Index('IDX_signers_role_active', ['role', 'active'])
export class SignerEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ESignerRole, enumName: 'signer_roles' })
  role: ESignerRole;

  @Column()
  address: string;

  @Column({ type: 'bigint' })
  chainId: number;

  @Column({ type: 'varchar', nullable: true })
  label: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
