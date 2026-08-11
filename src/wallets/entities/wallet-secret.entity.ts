import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '@/users/entities/user.entity';

export enum ESecretKind {
  ENTROPY = 'entropy',
  SEED = 'seed',
}

@Entity({ name: 'wallet_secrets' })
@Index('IDX_wallet_secrets_user_kind', ['userId', 'kind'], { unique: true })
export class WalletSecret {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'kind',
    type: 'enum',
    enum: ESecretKind,
    enumName: 'secret_kinds',
  })
  kind: ESecretKind;

  @Column({ name: 'blob', type: 'text' })
  blob: string;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
