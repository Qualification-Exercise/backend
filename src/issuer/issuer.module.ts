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
import { CHAIN_VIEW_CONFIG } from '@/common/chain/chain-view.config';
import { AlertService } from '@/common/alerts/alert.service';
import { CounterService } from '@/common/metrics/counter.service';
import { ServiceCounterEntity } from '@/common/metrics/service-counter.entity';
import { IssuerConfig } from '@/issuer/issuer-config';
import { CoinGeckoPriceProvider } from '@/issuer/price-providers/coingecko-price.provider';
import { AttestationService } from '@/issuer/services/attestation.service';
import { IssuerRunnerService } from '@/issuer/services/issuer-runner.service';
import { PaymentVerifierService } from '@/common/chain/payment-verifier.service';
import { BitcoinPaymentVerifier } from '@/common/chain/verifiers/bitcoin.verifier';
import { TronPaymentVerifier } from '@/common/chain/verifiers/tron.verifier';
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
      ServiceCounterEntity,
    ]),
  ],
  providers: [
    IssuerConfig,
    // The issuer looks at the chain through its own endpoint, never the API's.
    { provide: CHAIN_VIEW_CONFIG, useExisting: IssuerConfig },
    AlertService,
    ConfirmationPolicy,
    CounterService,
    PriceSource,
    CoinGeckoPriceProvider,
    PaymentVerifierService,
    TronPaymentVerifier,
    BitcoinPaymentVerifier,
    AttestationService,
    IssuerRunnerService,
  ],
})
export class IssuerModule {}
