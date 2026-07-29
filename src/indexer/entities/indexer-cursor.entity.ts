import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { MerchantEntity } from '@/merchants/entities/merchant.entity';

@Entity('indexer_cursors')
@Index(
  'IDX_indexer_cursors_merchant_chain_token',
  ['merchantId', 'srcChainId', 'tokenAddress'],
  { unique: true },
)
export class IndexerCursorEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId: string;

  @Column({ name: 'src_chain_id', type: 'varchar' })
  srcChainId: string;

  @Column({ name: 'token_address', type: 'varchar' })
  tokenAddress: string;

  @Column({ name: 'cursor', type: 'varchar' })
  cursor: string;

  @Column({ name: 'last_block_height', type: 'bigint', nullable: true })
  lastBlockHeight: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @ManyToOne(() => MerchantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchant_id' })
  merchant: MerchantEntity;
}
