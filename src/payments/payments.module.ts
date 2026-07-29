import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IndexerModule } from '@/indexer/indexer.module';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PaymentPollerService } from '@/payments/services/payment-poller.service';
import { Wallet } from '@/wallets/entities/wallet.entity';

@Module({
  imports: [
    IndexerModule,
    TypeOrmModule.forFeature([Merchant, Payment, IndexerCursor, Wallet]),
  ],
  providers: [PaymentPollerService, ConfirmationPolicy],
  exports: [PaymentPollerService, ConfirmationPolicy],
})
export class PaymentsModule {}
