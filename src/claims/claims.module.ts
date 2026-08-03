import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AttestationEntity } from '@/attestations/entities/attestation.entity';
import { ClaimsController } from '@/claims/controllers/claims.controller';
import { ClaimEntity } from '@/claims/entities/claim.entity';
import { ClaimsService } from '@/claims/services/claims.service';
import { IdempotencyKeyEntity } from '@/idempotency/entities/idempotency-key.entity';
import { IdempotencyService } from '@/idempotency/services/idempotency.service';
import { PaymentsModule } from '@/payments/payments.module';
import { SettlementEntity } from '@/settlements/entities/settlement.entity';

@Module({
  imports: [
    PaymentsModule,
    TypeOrmModule.forFeature([
      ClaimEntity,
      AttestationEntity,
      SettlementEntity,
      IdempotencyKeyEntity,
    ]),
  ],
  providers: [ClaimsService, IdempotencyService],
  controllers: [ClaimsController],
  exports: [ClaimsService],
})
export class ClaimsModule {}
