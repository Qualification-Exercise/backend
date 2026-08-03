/**
 * Why a verifier refused. The message is written to the claim and shown to an
 * on-call engineer, so it names the discrepancy rather than the step.
 */
export class VerificationError extends Error {}
