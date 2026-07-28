import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { User } from '@/users/entities/user.entity';
import { Transaction } from '@/transactions/entities/transaction.entity';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  address: string;

  @Column({ enum: ['BTC', 'SPARK', 'ARBITRUM', 'ETHEREUM', 'POLYGON', 'TRON'] })
  chain: string;

  @Column({ nullable: true })
  encryptedSeedBackupRef: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.wallets, { onDelete: 'CASCADE' })
  user: User;

  @OneToMany(() => Transaction, (transaction) => transaction.wallet)
  transactions: Transaction[];
}
