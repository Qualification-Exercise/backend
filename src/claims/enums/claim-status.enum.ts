/**
 * ```
 * PENDING_ATTESTATION -> ATTESTED -> CLAIM_SUBMITTED -> CLAIMED
 *          |                |                |
 *          v                v                v
 *        FAILED       FAILED / EXPIRED     FAILED
 * ```
 * CLAIMED, FAILED and EXPIRED are terminal. Nothing here is retried
 * automatically: a failed claim is an alert, and the coupon returns to ISSUED
 * so the user can try again deliberately.
 */
export enum EClaimStatus {
  PENDING_ATTESTATION = 'PENDING_ATTESTATION',
  ATTESTED = 'ATTESTED',
  CLAIM_SUBMITTED = 'CLAIM_SUBMITTED',
  CLAIMED = 'CLAIMED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

export enum EClaimFailureReason {
  ATTESTATION_REJECTED = 'ATTESTATION_REJECTED',
  SUBMISSION_FAILED = 'SUBMISSION_FAILED',
}

export const TERMINAL_CLAIM_STATUSES: readonly EClaimStatus[] = [
  EClaimStatus.CLAIMED,
  EClaimStatus.FAILED,
  EClaimStatus.EXPIRED,
];
