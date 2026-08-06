import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SecretsController } from '@/secrets/controllers/secrets.controller';
import { SecretsService } from '@/secrets/services/secrets.service';
import { WalletSecret } from '@/wallets/entities/wallet-secret.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WalletSecret])],
  providers: [SecretsService],
  controllers: [SecretsController],
  exports: [SecretsService],
})
export class SecretsModule {}
