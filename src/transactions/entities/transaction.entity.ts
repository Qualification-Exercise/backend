import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Wallet } from '@/wallets/entities/wallet.entity';
import { User } from '@/users/entities/user.entity';
import { EChainKind } from '@/chains/chain-kind.enum';
import { Payment } from '@/payments/entities/payment.entity';
import { ClaimEntity } from '@/claims/entities/claim.entity';
import { ETxSource, ETxStatus, ETxType } from '@/transactions/enums/tx.enum';

@Entity('transactions')
// Per user, not global: a transfer between two platform users is one row in
// each history, so the recipient's incoming row cannot be swallowed by the
// sender's outgoing one.
@Unique('UQ_transactions_user_src_tx_output', [
  'userId',
  'srcChainId',
  'txHash',
  'outputIndex',
])
@Check('CHK_transactions_direction', `"direction" IN ('in', 'out')`)
@Index('IDX_transactions_page', ['userId', 'occurredAt', 'id'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid', nullable: true })
  walletId: string | null;

  @Column({ type: 'enum', enum: EChainKind, enumName: 'chain_kind' })
  chain: EChainKind;

  @Column({ type: 'bigint' })
  srcChainId: number;

  @Column()
  txHash: string;

  @Column({ type: 'int', default: 0 })
  outputIndex: number;

  @Column({
    type: 'enum',
    enum: ETxType,
    enumName: 'tx_type',
    default: ETxType.TRANSFER,
  })
  type: ETxType;

  @Column({ type: 'varchar' })
  direction: 'in' | 'out';

  @Column()
  token: string;

  @Column({ type: 'numeric', precision: 78, scale: 0 })
  amount: string;

  @Column({ type: 'numeric', precision: 38, scale: 6, nullable: true })
  usdValue: string | null;

  @Column()
  fromAddress: string;

  @Column()
  toAddress: string;

  @Column({ type: 'varchar', nullable: true })
  feeToken: string | null;

  @Column({ type: 'numeric', precision: 78, scale: 0, nullable: true })
  feeAmount: string | null;

  @Column({
    type: 'enum',
    enum: ETxStatus,
    enumName: 'tx_status',
    default: ETxStatus.PENDING,
  })
  status: ETxStatus;

  @Column({ type: 'varchar', nullable: true })
  failureReason: string | null;

  @Column({ type: 'int', default: 0 })
  confirmations: number;

  @Column({ type: 'int' })
  requiredConfirmations: number;

  @Column({ type: 'bigint', nullable: true })
  blockHeight: number | null;

  @Column({ type: 'enum', enum: ETxSource, enumName: 'tx_source' })
  source: ETxSource;

  @Column({ type: 'uuid', nullable: true })
  paymentId: string | null;

  @Column({ type: 'uuid', nullable: true })
  claimId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  broadcastAt: Date | null;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @ManyToOne(() => Wallet, (wallet) => wallet.transactions, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  wallet: Wallet | null;

  @ManyToOne(() => Payment, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'paymentId' })
  payment: Payment | null;

  @ManyToOne(() => ClaimEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'claimId' })
  claim: ClaimEntity | null;
}
