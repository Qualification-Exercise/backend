import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IdempotencyKeyEntity } from '@/idempotency/entities/idempotency-key.entity';
import { IdempotencyService } from '@/idempotency/services/idempotency.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { TransactionsController } from '@/transactions/controllers/transactions.controller';
import { Transaction } from '@/transactions/entities/transaction.entity';
import { TransactionsService } from '@/transactions/services/transactions.service';
import { Wallet } from '@/wallets/entities/wallet.entity';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([
      Transaction,
      Wallet,
      IndexerCursor,
      IdempotencyKeyEntity,
    ]),
  ],
  providers: [TransactionsService, ConfirmationPolicy, IdempotencyService],
  controllers: [TransactionsController],
  exports: [TransactionsService],
})
export class TransactionsModule {}
