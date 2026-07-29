import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  OneToOne,
} from 'typeorm';
import { MerchantEntity } from '@/merchants/entities/merchant.entity';
import { Wallet } from '@/wallets/entities/wallet.entity';
import { PriceSnapshotEntity } from '@/price-snapshots/entities/price-snapshot.entity';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { EPaymentStatus } from '@/payments/enums/payment-status.enum';

@Entity('payments')
@Index('IDX_payments_src_chain_id_tx_hash_output_index', [
  'srcChainId',
  'txHash',
  'outputIndex',
])
@Index('IDX_payments_merchant_id', ['merchantId'])
@Index('IDX_payments_wallet_id', ['walletId'])
@Index('IDX_payments_status', ['status'])
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId: string;

  @Column({ name: 'wallet_id', type: 'uuid', nullable: true })
  walletId: string | null;

  @Column({ name: 'src_chain_id', type: 'varchar' })
  srcChainId: string;

  @Column({ name: 'tx_hash', type: 'varchar' })
  txHash: string;

  @Column({ name: 'output_index', type: 'int' })
  outputIndex: number;

  @Column({ name: 'payment_ref', type: 'varchar', unique: true })
  paymentRef: string;

  @Column({ name: 'token_address', type: 'varchar' })
  tokenAddress: string;

  @Column({ name: 'amount', type: 'decimal', precision: 40, scale: 0 })
  amount: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: EPaymentStatus,
    default: EPaymentStatus.PENDING,
  })
  status: EPaymentStatus;

  @Column({ name: 'block_number', type: 'bigint' })
  blockNumber: number;

  @Column({ name: 'block_hash', type: 'varchar' })
  blockHash: string;

  @Column({ name: 'confirmation_count', type: 'int', default: 0 })
  confirmationCount: number;

  @Column({ name: 'indexer_tx_id', type: 'varchar', nullable: true })
  indexerTxId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @ManyToOne(() => MerchantEntity, (merchant) => merchant.payments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'merchant_id' })
  merchant: MerchantEntity;

  @ManyToOne(() => Wallet, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet | null;

  @OneToOne(() => PriceSnapshotEntity, (snapshot) => snapshot.payment, {
    nullable: true,
  })
  priceSnapshot: PriceSnapshotEntity | null;

  @OneToOne(() => Coupon, { nullable: true })
  @JoinColumn({ name: 'coupon_id' })
  coupon: Coupon | null;
}
