import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AttestationEntity } from '@/attestations/entities/attestation.entity';
import { ClaimsController } from '@/claims/controllers/claims.controller';
import { ClaimChallenge } from '@/claims/entities/claim-challenge.entity';
import { ClaimEntity } from '@/claims/entities/claim.entity';
import { ClaimsService } from '@/claims/services/claims.service';
import { IdempotencyKeyEntity } from '@/idempotency/entities/idempotency-key.entity';
import { IdempotencyService } from '@/idempotency/services/idempotency.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { SettlementEntity } from '@/settlements/entities/settlement.entity';
import { WalletsModule } from '@/wallets/wallets.module';

@Module({
  imports: [
    HttpModule,
    WalletsModule,
    TypeOrmModule.forFeature([
      ClaimEntity,
      ClaimChallenge,
      AttestationEntity,
      SettlementEntity,
      IdempotencyKeyEntity,
    ]),
  ],
  providers: [ConfirmationPolicy, ClaimsService, IdempotencyService],
  controllers: [ClaimsController],
  exports: [ClaimsService],
})
export class ClaimsModule {}
