import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '@/users/entities/user.entity';

@Entity('wallet_secrets')
@Check(
  'CHK_wallet_secrets_has_blob',
  '"encrypted_entropy" IS NOT NULL OR "encrypted_seed" IS NOT NULL',
)
@Check(
  'CHK_wallet_secrets_blob_size',
  'length("encrypted_entropy") <= 128 AND length("encrypted_seed") <= 192 AND length("wrapped_key") <= 256',
)
@Check('CHK_wallet_secrets_word_count', '"word_count" IN (12, 24)')
export class WalletSecret {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'encrypted_entropy', type: 'text', nullable: true })
  encryptedEntropy: string | null;

  @Column({ name: 'encrypted_seed', type: 'text', nullable: true })
  encryptedSeed: string | null;

  @Column({ name: 'wrapped_key', type: 'text' })
  wrappedKey: string;

  @Column({ name: 'kdf', type: 'jsonb' })
  kdf: Record<string, unknown>;

  @Column({ name: 'cipher', type: 'text', default: 'aes-256-gcm' })
  cipher: string;

  @Column({ name: 'version', type: 'smallint', default: 1 })
  version: number;

  @Column({ name: 'word_count', type: 'smallint' })
  wordCount: number;

  @Column({ name: 'primary_address', type: 'text' })
  primaryAddress: string;

  @Column({
    name: 'entropy_updated_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  entropyUpdatedAt: Date | null;

  @Column({
    name: 'seed_updated_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  seedUpdatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
