import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { User } from '@/users/entities/user.entity';
import { Transaction } from '@/transactions/entities/transaction.entity';
import { EChainKind } from '@/chains/chain-kind.enum';

@Entity('wallets')
@Unique('UQ_wallets_chain_address', ['chain', 'address'])
@Unique('UQ_wallets_user_chain', ['userId', 'chain'])
@Index('IDX_wallets_one_primary', ['userId'], {
  unique: true,
  where: '"isPrimary"',
})
@Index('IDX_wallets_lookup', ['srcChainId', 'address'], {
  where: '"verified"',
})
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'enum', enum: EChainKind, enumName: 'chain_kind' })
  chain: EChainKind;

  @Column({ type: 'bigint' })
  srcChainId: number;

  @Column()
  address: string;

  @Column({ type: 'varchar', nullable: true })
  path: string | null;

  @Column({ default: false })
  isPrimary: boolean;

  @Column({ default: false })
  verified: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.wallets, { onDelete: 'CASCADE' })
  user: User;

  @OneToMany(() => Transaction, (transaction) => transaction.wallet)
  transactions: Transaction[];
}
