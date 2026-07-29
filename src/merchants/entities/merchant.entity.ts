import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { PaymentEntity } from '@/payments/entities/payment.entity';

@Entity('merchants')
@Index('IDX_merchants_src_chain_id_address', ['srcChainId', 'address'], {
  unique: true,
})
export class MerchantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'src_chain_id', type: 'varchar' })
  srcChainId: string;

  @Column({ name: 'address', type: 'varchar' })
  address: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @OneToMany(() => PaymentEntity, (payment) => payment.merchant)
  payments: PaymentEntity[];
}
