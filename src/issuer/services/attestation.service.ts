import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Hex } from 'viem';

import { hoursToMs } from '@/common/time';
import { isUniqueViolation } from '@/common/database/pg-errors';
import { AttestationEntity } from '@/attestations/entities/attestation.entity';
import { EChainKind } from '@/chains/chain-kind.enum';
import { ClaimEntity } from '@/claims/entities/claim.entity';
import { EClaimStatus } from '@/claims/enums/claim-status.enum';
import { accrualAmount, BPS_DENOMINATOR, toWad } from '@/coupons/accrual';
import { entitlementDigest } from '@/issuer/entitlement';
import { IssuerConfig } from '@/issuer/issuer-config';
import { CoinGeckoPriceProvider } from '@/issuer/price-providers/coingecko-price.provider';
import {
  PaymentVerifierService,
  VerificationError,
} from '@/common/chain/payment-verifier.service';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';
import { PriceSource, assetForToken } from '@/pricing/price-source';
import { Wallet } from '@/wallets/entities/wallet.entity';

export interface IAttestationOutcome {
  signed: boolean;
  reason?: string;
}

/**
 * One issuer's opinion about one claim.
 *
 * Everything the API already decided is re-decided here, from sources this
 * process controls: the chain read comes from its own node, the price check
 * from its own provider, the rate limit from its own query. The only thing it
 * takes on faith is the canonical snapshot's *number* — and even that only
 * after checking it against its own fetch, because a snapshot nobody validates
 * lets whoever writes it move every issuer at once.
 */
@Injectable()
export class AttestationService {
  private readonly logger = new Logger(AttestationService.name);

  constructor(
    private readonly config: IssuerConfig,
    private readonly verifier: PaymentVerifierService,
    private readonly bitfinex: PriceSource,
    private readonly coingecko: CoinGeckoPriceProvider,
    @InjectRepository(AttestationEntity)
    private readonly attestations: Repository<AttestationEntity>,
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    @InjectRepository(PriceSnapshot)
    private readonly snapshots: Repository<PriceSnapshot>,
    @InjectRepository(Wallet)
    private readonly wallets: Repository<Wallet>,
    @InjectRepository(ClaimEntity)
    private readonly claims: Repository<ClaimEntity>,
  ) {}

  async attest(claim: ClaimEntity): Promise<IAttestationOutcome> {
    try {
      await this.checkAll(claim);
    } catch (err) {
      if (err instanceof VerificationError) {
        return { signed: false, reason: err.message };
      }
      throw err;
    }

    const signature = await this.config.signer.signEntitlement(
      {
        chainId: this.config.chainId,
        verifyingContract: this.config.verifyingContract,
      },
      {
        recipient: claim.recipient as Hex,
        amount: BigInt(claim.amount),
        paymentRef: claim.coupon.paymentRef as Hex,
        deadline: BigInt(claim.deadline),
      },
    );

    try {
      await this.attestations.insert({
        claimId: claim.id,
        issuerAddress: this.config.signer.address,
        signature,
        chainId: String(this.config.chainId),
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      this.logger.debug(`Already attested claim ${claim.id}; nothing to do`);
      return { signed: true };
    }

    this.logger.log(
      `issuer=${this.config.id} signed claim=${claim.id} digest=${entitlementDigest(
        {
          chainId: this.config.chainId,
          verifyingContract: this.config.verifyingContract,
        },
        {
          recipient: claim.recipient as Hex,
          amount: BigInt(claim.amount),
          paymentRef: claim.coupon.paymentRef as Hex,
          deadline: BigInt(claim.deadline),
        },
      )}`,
    );
    return { signed: true };
  }

  private async checkAll(claim: ClaimEntity): Promise<void> {
    if (claim.status !== EClaimStatus.PENDING_ATTESTATION) {
      throw new VerificationError(`WRONG_STATE: claim is ${claim.status}`);
    }
    if (Number(claim.chainId) !== this.config.chainId) {
      throw new VerificationError(
        `WRONG_CHAIN: claim is for ${claim.chainId}, this issuer signs for ${this.config.chainId}`,
      );
    }
    if (Number(claim.deadline) * 1000 <= Date.now()) {
      throw new VerificationError('DEADLINE_PASSED: entitlement would be void');
    }

    const payment = await this.payments.findOne({
      where: { paymentRef: claim.coupon.paymentRef },
    });
    if (!payment) {
      throw new VerificationError('NO_PAYMENT: nothing backs this coupon');
    }

    await this.assertNotSpent(claim, payment);

    const merchants = await this.merchants.find({
      where: { srcChainId: Number(payment.srcChainId), active: true },
    });
    await this.verifier.verify(
      payment,
      merchants.map((m) => m.address),
    );

    await this.assertAmount(claim, payment);
    await this.assertRecipient(claim, payment);
    await this.assertRateLimit(claim);
  }

  private async assertNotSpent(
    claim: ClaimEntity,
    payment: Payment,
  ): Promise<void> {
    const previous = await this.attestations
      .createQueryBuilder('attestation')
      .innerJoin(ClaimEntity, 'claim', 'claim.id = attestation.claim_id')
      .innerJoin('coupons', 'coupon', 'coupon.id = claim.coupon_id')
      .where('attestation.issuer_address = :issuer', {
        issuer: this.config.signer.address,
      })
      .andWhere('coupon."paymentRef" = :ref', { ref: payment.paymentRef })
      .andWhere('attestation.claim_id <> :claimId', { claimId: claim.id })
      .getCount();

    if (previous > 0) {
      throw new VerificationError(
        `ALREADY_ATTESTED: this issuer already signed for ${payment.paymentRef}`,
      );
    }
  }

  private async assertAmount(
    claim: ClaimEntity,
    payment: Payment,
  ): Promise<void> {
    const snapshot = await this.snapshots.findOne({
      where: { paymentRef: payment.paymentRef },
    });
    if (!snapshot) {
      throw new VerificationError('NO_SNAPSHOT: no canonical price to check');
    }

    const asset = assetForToken(payment.token);
    const mine = await this.priceProvider().priceAt(
      asset,
      payment.transferredAt,
    );

    const snapshotWad = toWad(snapshot.price, 18);
    const mineWad = toWad(mine.price, 18);
    if (mineWad === 0n) {
      throw new VerificationError('PRICE_UNAVAILABLE: own provider returned 0');
    }

    const deltaBps =
      ((snapshotWad > mineWad ? snapshotWad - mineWad : mineWad - snapshotWad) *
        BPS_DENOMINATOR) /
      mineWad;
    if (deltaBps > BigInt(this.config.toleranceBps)) {
      throw new VerificationError(
        `PRICE_OUT_OF_BAND: snapshot ${snapshot.price} vs ${mine.source} ${mine.price} ` +
          `(${deltaBps} bps > ${this.config.toleranceBps})`,
      );
    }

    const driftSeconds =
      Math.abs(
        snapshot.providerTimestamp.getTime() - payment.transferredAt.getTime(),
      ) / 1000;
    if (driftSeconds > this.config.priceWindowSeconds) {
      throw new VerificationError(
        `PRICE_WINDOW: snapshot is ${Math.round(driftSeconds)}s from the payment`,
      );
    }

    const expected = accrualAmount({
      paymentAmount: payment.amount,
      asset,
      assetUsdPrice: snapshot.price,
      utlUsdRate: this.config.utlUsdRate,
      cashbackBps: this.config.cashbackBps,
    });
    if (expected !== claim.amount) {
      throw new VerificationError(
        `AMOUNT_MISMATCH: recomputed ${expected}, claim says ${claim.amount}`,
      );
    }
  }

  private async assertRecipient(
    claim: ClaimEntity,
    payment: Payment,
  ): Promise<void> {
    const wallet = await this.wallets.findOne({
      where: {
        userId: claim.coupon.userId,
        chain: EChainKind.EVM,
        verified: true,
        isPrimary: true,
      },
    });
    if (!wallet) {
      throw new VerificationError('NO_WALLET: user has no verified EVM wallet');
    }
    if (wallet.address.toLowerCase() !== claim.recipient.toLowerCase()) {
      throw new VerificationError(
        `RECIPIENT_MISMATCH: mapping says ${wallet.address}, claim says ${claim.recipient}`,
      );
    }
    if (payment.userId && payment.userId !== claim.coupon.userId) {
      throw new VerificationError(
        'OWNERSHIP_MISMATCH: the payment was attributed to another user',
      );
    }
  }

  private async assertRateLimit(claim: ClaimEntity): Promise<void> {
    if (this.config.cooldownHours <= 0) return;

    const since = new Date(
      Date.now() - hoursToMs(this.config.cooldownHours),
    ).toISOString();
    const [row] = (await this.claims.query(
      `SELECT c.id
         FROM claims c
         JOIN coupons cp ON cp.id = c.coupon_id
        WHERE cp."userId" = $1
          AND c.id <> $2
          AND c.status <> 'FAILED'
          AND c.created_at > $3
        LIMIT 1`,
      [claim.coupon.userId, claim.id, since],
    )) as { id: string }[];

    if (row) {
      throw new VerificationError(
        `RATE_LIMIT: user already claimed within ${this.config.cooldownHours} h`,
      );
    }
  }

  private priceProvider(): { priceAt: PriceSource['priceAt'] } {
    return this.config.priceProvider === 'coingecko'
      ? this.coingecko
      : this.bitfinex;
  }
}
