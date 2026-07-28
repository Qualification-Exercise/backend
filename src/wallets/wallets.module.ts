import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletChallenge } from './entities/wallet-challenge.entity';
import { WalletsService } from './services/wallets.service';
import { WalletsController } from './controllers/wallets.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, WalletChallenge])],
  providers: [WalletsService],
  controllers: [WalletsController],
  exports: [WalletsService],
})
export class WalletsModule {}
