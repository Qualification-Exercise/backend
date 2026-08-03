import { Injectable, Logger } from '@nestjs/common';
import { recoverTypedDataAddress, type Hex, type PublicClient } from 'viem';

import { AttestationEntity } from '@/attestations/entities/attestation.entity';
import type { ClaimEntity } from '@/claims/entities/claim.entity';
import { ENTITLEMENT_TYPES, entitlementDomain } from '@/issuer/entitlement';
import { COUPON_CLAIM_ABI } from '@/relayer/coupon-claim.abi';
import { RelayerConfig } from '@/relayer/relayer-config';

export class PreflightError extends Error {}
export class AlreadySettledError extends Error {}

export interface IPreflightResult {
  signatures: Hex[];
  signers: Hex[];
}

/**
 * Everything the contract would check, checked here first.
 *
 * A revert costs a fee and tells the operator nothing useful; the same
 * conclusion reached locally costs a view call and names the reason. So every
 * condition in `claim()`'s checklist is mirrored: caps, nullifier, deadline,
 * threshold, signer set, ordering — plus the two the contract cannot see, that
 * the signatures really are over this entitlement and that the signers really
 * are the issuers we recorded.
 */
@Injectable()
export class RelayerPreflightService {
  private readonly logger = new Logger(RelayerPreflightService.name);

  constructor(private readonly config: RelayerConfig) {}

  async check(
    client: PublicClient,
    claim: ClaimEntity,
    attestations: AttestationEntity[],
  ): Promise<IPreflightResult> {
    const contract = {
      address: this.config.verifyingContract,
      abi: COUPON_CLAIM_ABI,
    } as const;

    const paymentRef = claim.coupon.paymentRef as Hex;
    const amount = BigInt(claim.amount);

    const deadline = Number(claim.deadline);
    const now = Math.floor(Date.now() / 1000);
    if (deadline - now < this.config.deadlineMarginSeconds) {
      throw new PreflightError(
        `DEADLINE_TOO_CLOSE: ${deadline - now}s left, need ${this.config.deadlineMarginSeconds}s`,
      );
    }

    const [paused, alreadyClaimed, threshold, perClaimCap, epochCap, epoch] =
      await Promise.all([
        client.readContract({ ...contract, functionName: 'paused' }),
        client.readContract({
          ...contract,
          functionName: 'nullifierUsed',
          args: [paymentRef],
        }),
        client.readContract({ ...contract, functionName: 'threshold' }),
        client.readContract({ ...contract, functionName: 'perClaimCap' }),
        client.readContract({ ...contract, functionName: 'epochCap' }),
        client.readContract({ ...contract, functionName: 'currentEpoch' }),
      ]);

    if (alreadyClaimed) {
      throw new AlreadySettledError(
        `paymentRef ${paymentRef} is already nullified on-chain`,
      );
    }
    if (paused) {
      throw new PreflightError('PAUSED: the contract is not accepting claims');
    }

    const minted = await client.readContract({
      ...contract,
      functionName: 'mintedInEpoch',
      args: [epoch],
    });

    if (amount > perClaimCap) {
      throw new PreflightError(
        `EXCEEDS_PER_CLAIM_CAP: ${amount} > ${perClaimCap}`,
      );
    }
    if (minted + amount > epochCap) {
      throw new PreflightError(
        `EXCEEDS_EPOCH_CAP: ${minted} + ${amount} > ${epochCap} in epoch ${epoch}`,
      );
    }

    const { signatures, signers } = await this.verifiedSignatures(
      client,
      contract,
      claim,
      attestations,
    );

    if (BigInt(signatures.length) < threshold) {
      throw new PreflightError(
        `NOT_ENOUGH_SIGNATURES: ${signatures.length} usable, contract wants ${threshold}`,
      );
    }

    this.logger.debug(
      `Preflight passed for claim ${claim.id}: ${signers.length} signers, epoch ${epoch}`,
    );
    return { signatures, signers };
  }

  /**
   * Recovers every signature locally, keeps only signatures from addresses the
   * contract currently accepts, and returns them **strictly ascending by
   * signer** — which is what deduplicates the set on-chain. One issuer signing K
   * times is exactly what the ordering rule exists to reject, so the sort is a
   * requirement rather than a tidiness.
   */
  private async verifiedSignatures(
    client: PublicClient,
    contract: { address: Hex; abi: typeof COUPON_CLAIM_ABI },
    claim: ClaimEntity,
    attestations: AttestationEntity[],
  ): Promise<IPreflightResult> {
    const domain = entitlementDomain({
      chainId: Number(claim.chainId),
      verifyingContract: this.config.verifyingContract,
    });
    const message = {
      recipient: claim.recipient as Hex,
      amount: BigInt(claim.amount),
      paymentRef: claim.coupon.paymentRef as Hex,
      deadline: BigInt(claim.deadline),
    };

    const issuerRole = await client.readContract({
      ...contract,
      functionName: 'ISSUER_ROLE',
    });

    const usable: { signer: Hex; signature: Hex }[] = [];
    for (const attestation of attestations) {
      let recovered: Hex;
      try {
        recovered = await recoverTypedDataAddress({
          domain,
          types: ENTITLEMENT_TYPES,
          primaryType: 'Entitlement',
          message,
          signature: attestation.signature as Hex,
        });
      } catch {
        this.logger.error(
          `security_event=relayer.unrecoverable_signature claim=${claim.id} ` +
            `issuer=${attestation.issuerAddress}`,
        );
        continue;
      }

      // A signature that recovers to someone else is not a formatting problem.
      if (recovered.toLowerCase() !== attestation.issuerAddress.toLowerCase()) {
        this.logger.error(
          `security_event=relayer.signature_mismatch claim=${claim.id} ` +
            `stored=${attestation.issuerAddress} recovered=${recovered}`,
        );
        continue;
      }

      // Revocation happens on-chain, so an issuer removed since it signed is
      // caught here rather than by a wasted transaction.
      const isIssuer = await client.readContract({
        ...contract,
        functionName: 'hasRole',
        args: [issuerRole, recovered],
      });
      if (!isIssuer) {
        this.logger.warn(
          `Dropping signature from ${recovered}: not a current ISSUER_ROLE member`,
        );
        continue;
      }

      usable.push({
        signer: recovered,
        signature: attestation.signature as Hex,
      });
    }

    const deduped = [
      ...new Map(usable.map((s) => [s.signer.toLowerCase(), s])).values(),
    ].sort((a, b) =>
      BigInt(a.signer) < BigInt(b.signer)
        ? -1
        : BigInt(a.signer) > BigInt(b.signer)
          ? 1
          : 0,
    );

    return {
      signatures: deduped.map((s) => s.signature),
      signers: deduped.map((s) => s.signer),
    };
  }
}
