import { AttestationEntity } from '@/attestations/entities/attestation.entity';
import { RefreshTokenEntity } from '@/auth/entities/refresh-token.entity';
import { BalanceCache } from '@/balances/entities/balance-cache.entity';
import { ClaimChallenge } from '@/claims/entities/claim-challenge.entity';
import { ClaimEntity } from '@/claims/entities/claim.entity';
import { EventCursorEntity } from '@/common/chain/event-cursor.entity';
import { ServiceCounterEntity } from '@/common/metrics/service-counter.entity';
import { Coupon } from '@/coupons/entities/coupon.entity';
import { IdempotencyKeyEntity } from '@/idempotency/entities/idempotency-key.entity';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';
import { SettlementEntity } from '@/settlements/entities/settlement.entity';
import { SignerEntity } from '@/signers/entities/signer.entity';
import { Transaction } from '@/transactions/entities/transaction.entity';
import { User } from '@/users/entities/user.entity';
import { WalletSecret } from '@/wallets/entities/wallet-secret.entity';
import { Wallet } from '@/wallets/entities/wallet.entity';

export const ENTITIES = [
  AttestationEntity,
  BalanceCache,
  ClaimChallenge,
  ClaimEntity,
  Coupon,
  EventCursorEntity,
  IdempotencyKeyEntity,
  IndexerCursor,
  Merchant,
  Payment,
  PriceSnapshot,
  RefreshTokenEntity,
  ServiceCounterEntity,
  SettlementEntity,
  SignerEntity,
  Transaction,
  User,
  Wallet,
  WalletSecret,
];
