import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IndexerModule } from '@/indexer/indexer.module';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { MerchantsController } from '@/payments/controllers/merchants.controller';
import { MerchantsService } from '@/payments/services/merchants.service';
import { PaymentPollerService } from '@/payments/services/payment-poller.service';
import { Wallet } from '@/wallets/entities/wallet.entity';

@Module({
  imports: [
    HttpModule,
    IndexerModule,
    TypeOrmModule.forFeature([Merchant, Payment, IndexerCursor, Wallet]),
  ],
  controllers: [MerchantsController],
  providers: [PaymentPollerService, ConfirmationPolicy, MerchantsService],
  exports: [PaymentPollerService, ConfirmationPolicy, MerchantsService],
})
export class PaymentsModule {}
