import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CounterService } from '@/common/metrics/counter.service';
import {
  COUNTER_ISSUER_CLAIMS_SEEN,
  COUNTER_ISSUER_TICKS,
} from '@/common/metrics/service-counter.entity';
import { IntervalLoop } from '@/common/scheduling/interval-loop';
import { ClaimEntity } from '@/claims/entities/claim.entity';
import {
  EClaimFailureReason,
  EClaimStatus,
} from '@/claims/enums/claim-status.enum';
import { ClaimsService } from '@/claims/services/claims.service';
import { IssuerConfig } from '@/issuer/issuer-config';
import { AttestationService } from '@/issuer/services/attestation.service';
import { SignerEntity } from '@/signers/entities/signer.entity';
import { ESignerRole } from '@/signers/enums/signer-role.enum';

@Injectable()
export class IssuerRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IssuerRunnerService.name);
  private readonly loop = new IntervalLoop(this.logger);
  private running = false;

  constructor(
    private readonly config: IssuerConfig,
    private readonly attestation: AttestationService,
    private readonly claims: ClaimsService,
    private readonly counters: CounterService,
    @InjectRepository(ClaimEntity)
    private readonly claimRepo: Repository<ClaimEntity>,
    @InjectRepository(SignerEntity)
    private readonly signers: Repository<SignerEntity>,
  ) {}

  async onModuleInit() {
    this.logger.log(
      `Issuer ${this.config.id} up as ${this.config.signer.address} ` +
        `(chains=${Object.keys(this.config.endpoints).join(',')}, ` +
        `prices=${this.config.priceProvider})`,
    );
    const disabledMessage =
      'Attestation loop disabled (ISSUER_POLL_INTERVAL_MS <= 0)';
    if (this.loop.disabled(this.config.pollIntervalMs, disabledMessage)) return;

    // An address the registry does not know is an address the contract's
    // ISSUER_ROLE probably does not know either. Signing anyway would produce
    // signatures the relayer discards and the contract rejects — refusing to
    // start says so at deploy time instead of at claim time.
    const registered = await this.signers.findOne({
      where: {
        role: ESignerRole.ISSUER,
        address: this.config.signer.address,
        active: true,
      },
    });
    if (!registered) {
      throw new Error(
        `Issuer ${this.config.signer.address} is not an active issuer in the signers registry`,
      );
    }
    this.loop.start(this.config.pollIntervalMs, () => this.tick());
  }

  onModuleDestroy() {
    this.loop.stop();
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous attestation pass still running; skipping');
      return;
    }
    this.running = true;
    try {
      this.counters.increment(COUNTER_ISSUER_TICKS);
      const pending = await this.pending();
      this.counters.increment(COUNTER_ISSUER_CLAIMS_SEEN, pending.length);
      for (const claim of pending) {
        await this.handle(claim);
      }
    } catch (err) {
      this.logger.error(`Attestation tick failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private pending(): Promise<ClaimEntity[]> {
    return this.claimRepo
      .createQueryBuilder('claim')
      .innerJoinAndSelect('claim.coupon', 'coupon')
      .where('claim.status = :status', {
        status: EClaimStatus.PENDING_ATTESTATION,
      })
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM attestations a
            WHERE a.claim_id = claim.id AND a.issuer_address = :issuer
         )`,
        { issuer: this.config.signer.address },
      )
      .orderBy('claim.created_at', 'ASC')
      .limit(this.config.batchSize)
      .getMany();
  }

  private async handle(claim: ClaimEntity): Promise<void> {
    const outcome = await this.attestation.attest(claim);

    if (outcome.signed) {
      await this.claims.markAttested(claim.id);
      return;
    }

    this.logger.error(
      `security_event=attestation.rejected issuer=${this.config.id} ` +
        `claim=${claim.id} reason=${outcome.reason}`,
    );
    await this.claims.fail(
      claim.id,
      EClaimFailureReason.ATTESTATION_REJECTED,
      `${this.config.id}: ${outcome.reason}`,
    );
  }
}
