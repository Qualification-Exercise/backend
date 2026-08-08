/**
 * Postgres error codes the application reacts to, and the type guards that
 * read them off a driver error. A unique violation is normal control flow here:
 * inserts race against the poller, the issuers and the device, and the losing
 * side treats the conflict as "already recorded" rather than as a failure.
 */

export const PG_UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}
