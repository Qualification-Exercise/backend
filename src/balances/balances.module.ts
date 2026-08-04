import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BalancesController } from '@/balances/controllers/balances.controller';
import { BalanceCache } from '@/balances/entities/balance-cache.entity';
import { BalancesService } from '@/balances/services/balances.service';
import { IndexerModule } from '@/indexer/indexer.module';
import { Wallet } from '@/wallets/entities/wallet.entity';

@Module({
  imports: [IndexerModule, TypeOrmModule.forFeature([BalanceCache, Wallet])],
  providers: [BalancesService],
  controllers: [BalancesController],
  exports: [BalancesService],
})
export class BalancesModule {}
