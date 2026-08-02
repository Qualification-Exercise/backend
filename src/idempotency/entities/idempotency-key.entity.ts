import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '@/users/entities/user.entity';

@Entity('idempotency_keys')
@Index('IDX_idempotency_keys_user_id_key', ['userId', 'idempotencyKey'], {
  unique: true,
})
@Index('IDX_idempotency_keys_expires_at', ['expiresAt'])
export class IdempotencyKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'idempotency_key', type: 'varchar' })
  idempotencyKey: string;

  @Column({ name: 'response_data', type: 'jsonb' })
  responseData: Record<string, unknown>;

  @Column({ name: 'request_hash', type: 'varchar', nullable: true })
  requestHash: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamp with time zone' })
  expiresAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
