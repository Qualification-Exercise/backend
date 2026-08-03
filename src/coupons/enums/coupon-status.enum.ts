/**
 * The single source of truth for coupon state. The DB trigger
 * `coupons_valid_transition` enforces the same list — keep them in step.
 *
 * ```
 * PENDING -> ISSUED -> PENDING_ATTESTATION -> ATTESTED -> CLAIM_SUBMITTED -> CLAIMED
 *              ^             |                    |             |
 *              +------- (issuer rejection / deadline / reorg / tx failure)
 *
 * any -> EXPIRED / ORPHANED
 * ```
 *
 * There is no REJECTED: an issuer refusing an attestation returns the coupon to
 * ISSUED and raises an alert, it does not create a terminal state of its own.
 */
export enum ECouponStatus {
  PENDING = 'PENDING',
  ISSUED = 'ISSUED',
  PENDING_ATTESTATION = 'PENDING_ATTESTATION',
  ATTESTED = 'ATTESTED',
  CLAIM_SUBMITTED = 'CLAIM_SUBMITTED',
  CLAIMED = 'CLAIMED',
  EXPIRED = 'EXPIRED',
  ORPHANED = 'ORPHANED',
}

/** The same values as a string union, so literals still typecheck in queries. */
export type CouponStatus = `${ECouponStatus}`;
