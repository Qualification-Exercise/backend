import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AttestationEntity } from '@/attestations/entities/attestation.entity';
import { ClaimsModule } from '@/claims/claims.module';
import { ClaimEntity } from '@/claims/entities/claim.entity';
import { CHAIN_VIEW_CONFIG } from '@/common/chain/chain-view.config';
import { PaymentVerifierService } from '@/common/chain/payment-verifier.service';
import { validateEnv } from '@/config/env';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { DatabaseModule } from '@/database/database.module';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { RelayerConfig } from '@/relayer/relayer-config';
import { NonceManagerService } from '@/relayer/services/nonce-manager.service';
import { RelayerPreflightService } from '@/relayer/services/relayer-preflight.service';
import { RelayerRunnerService } from '@/relayer/services/relayer-runner.service';
import { SignerEntity } from '@/signers/entities/signer.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: process.env.RELAYER_ENV_FILE || '.env',
    }),
    DatabaseModule,
    ClaimsModule,
    TypeOrmModule.forFeature([
      ClaimEntity,
      AttestationEntity,
      Coupon,
      Payment,
      Merchant,
      SignerEntity,
    ]),
  ],
  providers: [
    RelayerConfig,
    { provide: CHAIN_VIEW_CONFIG, useExisting: RelayerConfig },
    ConfirmationPolicy,
    PaymentVerifierService,
    RelayerPreflightService,
    NonceManagerService,
    RelayerRunnerService,
  ],
})
export class RelayerModule {}
