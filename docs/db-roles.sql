-- Least-privilege database roles (backend doc §2.5, §2.6).
--
-- The K-of-N design only means something if a compromise of one process cannot
-- do another one's job. These GRANTs are that separation, expressed where it is
-- actually enforced: an issuer that could update a claim, or a relayer that
-- could insert an attestation, would each be a single point of mint.
--
--   psql "$DATABASE_URL" -f docs/db-roles.sql

-- ── API ────────────────────────────────────────────────────────────────────
-- Serves the app. Creates claims, never attests and never submits.
CREATE ROLE api LOGIN;
GRANT SELECT, INSERT, UPDATE ON users, wallets, wallet_challenges, wallet_secrets,
  transactions, coupons, claims, idempotency_keys TO api;
GRANT SELECT ON payments, price_snapshots, merchants, settlements, signers,
  attestations TO api;
REVOKE INSERT, UPDATE, DELETE ON attestations, settlements, signers FROM api;

-- ── Issuer (one role, N logins) ────────────────────────────────────────────
-- Verifies and signs. Its only write is its own attestation row — plus the
-- rejection path on claims, which BE-13 needs to mark ATTESTATION_REJECTED.
CREATE ROLE issuer LOGIN;
GRANT SELECT ON coupons, claims, payments, price_snapshots, merchants, wallets,
  signers, attestations TO issuer;
GRANT INSERT ON attestations TO issuer;
GRANT UPDATE (status, failure_reason, failure_detail, updated_at) ON claims TO issuer;
REVOKE INSERT, UPDATE, DELETE ON coupons, payments, price_snapshots FROM issuer;

-- ── Relayer ────────────────────────────────────────────────────────────────
-- Reads K signatures and submits. Cannot manufacture the signatures it submits.
CREATE ROLE relayer LOGIN;
GRANT SELECT ON claims, attestations, coupons, payments, merchants, signers TO relayer;
GRANT UPDATE (status, tx_hash, tx_nonce, failure_reason, failure_detail, updated_at)
  ON claims TO relayer;
GRANT INSERT, SELECT ON settlements TO relayer;
REVOKE INSERT, UPDATE, DELETE ON attestations FROM relayer;
REVOKE INSERT, UPDATE, DELETE ON coupons, payments, price_snapshots FROM relayer;
