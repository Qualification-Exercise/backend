import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AttestationEntity } from '@/attestations/entities/attestation.entity';
import { ClaimsModule } from '@/claims/claims.module';
import { ClaimEntity } from '@/claims/entities/claim.entity';
import { validateEnv } from '@/config/env';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { DatabaseModule } from '@/database/database.module';
import { IssuerConfig } from '@/issuer/issuer-config';
import { CoinGeckoPriceProvider } from '@/issuer/price-providers/coingecko-price.provider';
import { AttestationService } from '@/issuer/services/attestation.service';
import { IssuerRunnerService } from '@/issuer/services/issuer-runner.service';
import { PaymentVerifierService } from '@/issuer/services/payment-verifier.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';
import { PriceSource } from '@/pricing/price-source';
import { SignerEntity } from '@/signers/entities/signer.entity';
import { Wallet } from '@/wallets/entities/wallet.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: process.env.ISSUER_ENV_FILE || '.env',
    }),
    DatabaseModule,
    HttpModule,
    ClaimsModule,
    TypeOrmModule.forFeature([
      ClaimEntity,
      AttestationEntity,
      Coupon,
      Payment,
      Merchant,
      PriceSnapshot,
      Wallet,
      SignerEntity,
    ]),
  ],
  providers: [
    IssuerConfig,
    ConfirmationPolicy,
    PriceSource,
    CoinGeckoPriceProvider,
    PaymentVerifierService,
    AttestationService,
    IssuerRunnerService,
  ],
})
export class IssuerModule {}
