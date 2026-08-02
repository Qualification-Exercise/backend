import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '@/users/entities/user.entity';

@Entity('backups')
@Index('IDX_backups_user_id', ['userId'], { unique: true })
export class BackupEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'ciphertext', type: 'bytea' })
  ciphertext: Buffer;

  @Column({ name: 'kdf_algorithm', type: 'varchar' })
  kdfAlgorithm: string;

  @Column({ name: 'kdf_params', type: 'jsonb' })
  kdfParams: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
