import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  createPublicClient,
  encodeFunctionData,
  http,
  type Hex,
  type PublicClient,
} from 'viem';

import { AttestationEntity } from '@/attestations/entities/attestation.entity';
import { ClaimEntity } from '@/claims/entities/claim.entity';
import {
  EClaimFailureReason,
  EClaimStatus,
} from '@/claims/enums/claim-status.enum';
import { ClaimsService } from '@/claims/services/claims.service';
import { PaymentVerifierService } from '@/common/chain/payment-verifier.service';
import { COUPON_CLAIM_ABI } from '@/relayer/coupon-claim.abi';
import { RelayerConfig } from '@/relayer/relayer-config';
import { NonceManagerService } from '@/relayer/services/nonce-manager.service';
import {
  AlreadySettledError,
  RelayerPreflightService,
} from '@/relayer/services/relayer-preflight.service';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';
import { SignerEntity } from '@/signers/entities/signer.entity';
import { ESignerRole } from '@/signers/enums/signer-role.enum';

/**
 * The only process that spends. No inbound HTTP, no queue broker: it polls
 * `ATTESTED` claims, re-verifies each one against its own node, and submits
 * one transaction per coupon.
 *
 * It is deliberately not a pipe. The issuers said yes; this process asks the
 * chain itself before turning that into a mint, which is what makes "two
 * independent verifiers" true rather than decorative.
 */
@Injectable()
export class RelayerRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelayerRunnerService.name);
  private client?: PublicClient;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly config: RelayerConfig,
    private readonly preflight: RelayerPreflightService,
    private readonly verifier: PaymentVerifierService,
    private readonly nonces: NonceManagerService,
    private readonly claims: ClaimsService,
    @InjectRepository(ClaimEntity)
    private readonly claimRepo: Repository<ClaimEntity>,
    @InjectRepository(AttestationEntity)
    private readonly attestations: Repository<AttestationEntity>,
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    @InjectRepository(SignerEntity)
    private readonly signers: Repository<SignerEntity>,
  ) {}

  async onModuleInit() {
    this.logger.log(
      `Relayer ${this.config.id} up as ${this.config.signer.address} ` +
        `(rpc=${redact(this.config.rpcUrl)})`,
    );
    if (this.config.pollIntervalMs <= 0) {
      this.logger.log(
        'Submission loop disabled (RELAYER_POLL_INTERVAL_MS <= 0)',
      );
      return;
    }

    const registered = await this.signers.findOne({
      where: {
        role: ESignerRole.RELAYER,
        address: this.config.signer.address,
        active: true,
      },
    });
    if (!registered) {
      throw new Error(
        `Relayer ${this.config.signer.address} is not an active relayer in the signers registry`,
      );
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.pollIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous submission pass still running; skipping');
      return;
    }
    this.running = true;
    try {
      for (const claim of await this.attested()) {
        await this.handle(claim);
      }
    } catch (err) {
      this.logger.error(`Submission tick failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private attested(): Promise<ClaimEntity[]> {
    return this.claimRepo
      .createQueryBuilder('claim')
      .innerJoinAndSelect('claim.coupon', 'coupon')
      .where('claim.status = :status', { status: EClaimStatus.ATTESTED })
      .orderBy('claim.created_at', 'ASC')
      .limit(this.config.batchSize)
      .getMany();
  }

  private async handle(claim: ClaimEntity): Promise<void> {
    try {
      await this.verifyOwnView(claim);

      const attestations = await this.attestations.find({
        where: { claimId: claim.id },
      });
      const { signatures, signers } = await this.preflight.check(
        this.rpc(),
        claim,
        attestations,
      );

      const txHash = await this.submit(claim, signatures);
      this.logger.log(
        `Submitted claim ${claim.id} as ${txHash} with ${signers.length} signatures`,
      );

      await this.confirm(claim, txHash);
    } catch (err) {
      if (err instanceof AlreadySettledError) {
        // The payout happened; the database is simply behind.
        this.logger.warn(`Claim ${claim.id}: ${err.message}`);
        await this.claims.markClaimed(claim.id);
        return;
      }
      await this.giveUp(claim, err);
    }
  }

  /**
   * The relayer's own read of the chain, before it spends anything on the
   * issuers' word. It does not call the Indexer API either — this is a second
   * pair of eyes, not a second copy of the same one.
   */
  private async verifyOwnView(claim: ClaimEntity): Promise<void> {
    const payment = await this.payments.findOne({
      where: { paymentRef: claim.coupon.paymentRef },
    });
    if (!payment) {
      throw new Error('NO_PAYMENT: nothing backs this claim');
    }
    const merchants = await this.merchants.find({
      where: { srcChainId: Number(payment.srcChainId), active: true },
    });
    await this.verifier.verify(
      payment,
      merchants.map((m) => m.address),
    );
  }

  private async submit(claim: ClaimEntity, signatures: Hex[]): Promise<Hex> {
    const data = encodeFunctionData({
      abi: COUPON_CLAIM_ABI,
      functionName: 'claim',
      args: [
        claim.recipient as Hex,
        BigInt(claim.amount),
        claim.coupon.paymentRef as Hex,
        BigInt(claim.deadline),
        signatures,
      ],
    });

    return this.nonces.enqueue(
      () =>
        this.rpc().getTransactionCount({
          address: this.config.signer.address,
          blockTag: 'pending',
        }),
      async (nonce) => {
        // A gas estimate that reverts is the contract telling us the claim would
        // fail — cheaper to hear it here than to pay for the revert.
        const gasLimit = await this.rpc().estimateGas({
          account: this.config.signer.address,
          to: this.config.verifyingContract,
          data,
        });

        const fees = await this.rpc().estimateFeesPerGas();
        const maxFeePerGas = fees.maxFeePerGas ?? 0n;
        if (maxFeePerGas > this.config.maxFeeWei) {
          throw new Error(
            `GAS_TOO_EXPENSIVE: ${maxFeePerGas} wei/gas exceeds the configured ceiling`,
          );
        }

        const raw = await this.config.signer.signTransaction({
          chainId: this.config.chainId,
          nonce,
          to: this.config.verifyingContract,
          data,
          gasLimit: (gasLimit * 12n) / 10n,
          maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
          type: 2,
        });

        const txHash = await this.rpc().sendRawTransaction({
          serializedTransaction: raw,
        });
        await this.claims.markSubmitted(claim.id, txHash, nonce);
        return txHash;
      },
    );
  }

  private async confirm(claim: ClaimEntity, txHash: Hex): Promise<void> {
    const receipt = await this.rpc().waitForTransactionReceipt({
      hash: txHash,
      confirmations: this.config.confirmations,
    });

    if (receipt.status !== 'success') {
      throw new Error(`REVERTED: ${txHash} reverted on-chain`);
    }
    await this.claims.markClaimed(claim.id);
    this.logger.log(`Claim ${claim.id} settled in ${txHash}`);
  }

  /**
   * A claim the relayer cannot submit is flagged, not retried in a loop: the
   * reasons it fails locally — caps, a revoked issuer, a payment its node does
   * not agree with — do not get better by asking again.
   */
  private async giveUp(claim: ClaimEntity, err: unknown): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    this.nonces.resync();
    this.logger.error(
      `security_event=relayer.submission_failed claim=${claim.id} reason=${reason}`,
    );
    await this.claims.fail(
      claim.id,
      EClaimFailureReason.SUBMISSION_FAILED,
      `${this.config.id}: ${reason}`,
    );
  }

  private rpc(): PublicClient {
    this.client ??= createPublicClient({
      transport: http(this.config.rpcUrl),
    });
    return this.client;
  }
}

/** Endpoints usually carry an API key in the path. Never log the whole thing. */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'invalid-url';
  }
}
