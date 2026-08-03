import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brings the database in line with "Backend Services — Architecture" §4:
 *
 *  - creates the five tables that existed only as entities (`claims`,
 *    `attestations`, `settlements`, `wallet_secrets`, `idempotency_keys`);
 *  - rebuilds `transactions` on the documented shape (the scaffold version
 *    could not hold an 18-decimal amount and had no uniqueness at all);
 *  - gives `wallets` the `chain` / `srcChainId` / `verified` / `isPrimary`
 *    columns the payment-attribution invariant is built on;
 *  - drops `utility_token_claims`, superseded by `claims`;
 *  - widens `payments.amount` to the exact `numeric(78,0)`;
 *  - stops `users.email` being an identity key.
 *
 * The `wallets` step is destructive on pre-existing data: rows that violate the
 * new "one address per chain per user" rule are deleted, keeping the earliest.
 * That rule cannot be added any other way, and a demo database is the only
 * place this migration will ever meet duplicates.
 */
export class DocSchemaAlignment1785404000000 implements MigrationInterface {
  name = 'DocSchemaAlignment1785404000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "chain_kind" AS ENUM ('evm', 'tron', 'bitcoin', 'spark')`,
    );

    // --- wallets ------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP CONSTRAINT "UQ_f907d5fd09a9d374f1da4e13bd3"`,
    );
    await queryRunner.query(`ALTER TABLE "wallets" ADD "chain" "chain_kind"`);
    await queryRunner.query(`ALTER TABLE "wallets" ADD "srcChainId" bigint`);
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD "path" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD "isPrimary" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD "verified" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD "verifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    // Existing rows could only be linked with a secp256k1 proof, so they are
    // verified. The EVM chain id is not recoverable from the old schema —
    // Sepolia is the demo network and the honest default.
    await queryRunner.query(`
      UPDATE "wallets" SET
        "chain" = (CASE "chainFamily"
                     WHEN 'EVM'  THEN 'evm'
                     WHEN 'TRON' THEN 'tron'
                     WHEN 'BTC'  THEN 'bitcoin'
                     ELSE 'spark' END)::"chain_kind",
        "srcChainId" = CASE "chainFamily"
                     WHEN 'EVM'  THEN 11155111
                     WHEN 'TRON' THEN 4294967297
                     WHEN 'BTC'  THEN 4294967298
                     ELSE 4294967299 END,
        "isPrimary" = ("chainFamily" = 'EVM'),
        "verified" = ("chainFamily" IN ('EVM', 'TRON')),
        "verifiedAt" = CASE WHEN "chainFamily" IN ('EVM', 'TRON')
                            THEN "createdAt" END
    `);
    await queryRunner.query(`
      DELETE FROM "wallets" dup
      USING "wallets" keep
      WHERE dup."userId" = keep."userId"
        AND dup."chain" = keep."chain"
        AND (dup."createdAt", dup."id") > (keep."createdAt", keep."id")
    `);
    await queryRunner.query(
      `ALTER TABLE "wallets" ALTER COLUMN "chain" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ALTER COLUMN "srcChainId" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "chainFamily"`);
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP COLUMN "encryptedSeedBackupRef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD CONSTRAINT "UQ_wallets_chain_address" UNIQUE ("chain", "address")`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD CONSTRAINT "UQ_wallets_user_chain" UNIQUE ("userId", "chain")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_wallets_one_primary" ON "wallets" ("userId") WHERE "isPrimary"`,
    );
    // The poller's attribution query. Unverified rows are absent on purpose.
    await queryRunner.query(
      `CREATE INDEX "IDX_wallets_lookup" ON "wallets" ("srcChainId", "address") WHERE "verified"`,
    );

    // --- wallet_secrets -----------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "wallet_secrets" (
        "user_id"            uuid PRIMARY KEY,
        "encrypted_entropy"  text,
        "encrypted_seed"     text,
        "wrapped_key"        text NOT NULL,
        "kdf"                jsonb NOT NULL,
        "cipher"             text NOT NULL DEFAULT 'aes-256-gcm',
        "version"            smallint NOT NULL DEFAULT 1,
        "word_count"         smallint NOT NULL,
        "primary_address"    text NOT NULL,
        "entropy_updated_at" TIMESTAMP WITH TIME ZONE,
        "seed_updated_at"    TIMESTAMP WITH TIME ZONE,
        "created_at"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_wallet_secrets_has_blob"
          CHECK ("encrypted_entropy" IS NOT NULL OR "encrypted_seed" IS NOT NULL),
        CONSTRAINT "CHK_wallet_secrets_blob_size"
          CHECK (length("encrypted_entropy") <= 128
             AND length("encrypted_seed") <= 192
             AND length("wrapped_key") <= 256),
        CONSTRAINT "CHK_wallet_secrets_word_count" CHECK ("word_count" IN (12, 24))
      )
    `);

    // --- claims / attestations / settlements --------------------------------
    await queryRunner.query(
      `CREATE TYPE "claims_status_enum" AS ENUM ('PENDING_ATTESTATION', 'ATTESTED', 'CLAIM_SUBMITTED', 'CLAIMED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "claims" (
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "coupon_id"  uuid NOT NULL,
        "recipient"  character varying NOT NULL,
        "amount"     numeric(78,0) NOT NULL,
        "deadline"   bigint NOT NULL,
        "status"     "claims_status_enum" NOT NULL DEFAULT 'PENDING_ATTESTATION',
        "tx_hash"    character varying,
        "tx_nonce"   integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_claims_coupon_id" ON "claims" ("coupon_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_claims_status" ON "claims" ("status")`,
    );

    // One signature per issuer per claim: the DB mirror of the contract's
    // strict-ascending signer check, so one issuer cannot fill the threshold.
    await queryRunner.query(`
      CREATE TABLE "attestations" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "claim_id"       uuid NOT NULL,
        "issuer_address" character varying NOT NULL,
        "signature"      character varying NOT NULL,
        "chain_id"       character varying NOT NULL,
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_attestations_claim_id_issuer_address" ON "attestations" ("claim_id", "issuer_address")`,
    );

    await queryRunner.query(`
      CREATE TABLE "settlements" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "payment_ref"     character varying NOT NULL,
        "recipient"       character varying NOT NULL,
        "amount"          numeric(78,0) NOT NULL,
        "tx_hash"         character varying NOT NULL,
        "block_number"    bigint NOT NULL,
        "event_timestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_settlements_payment_ref" ON "settlements" ("payment_ref")`,
    );

    // --- idempotency_keys ---------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "idempotency_keys" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "user_id"         uuid NOT NULL,
        "idempotency_key" character varying NOT NULL,
        "response_data"   jsonb NOT NULL,
        "request_hash"    character varying,
        "created_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expires_at"      TIMESTAMP WITH TIME ZONE NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_idempotency_keys_user_id_key" ON "idempotency_keys" ("user_id", "idempotency_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_idempotency_keys_expires_at" ON "idempotency_keys" ("expires_at")`,
    );

    // --- transactions -------------------------------------------------------
    // The scaffold table has no writer and no data worth keeping: its amount
    // column could not represent an 18-decimal token in the first place.
    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(
      `CREATE TYPE "tx_type" AS ENUM ('payment', 'claim', 'transfer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "tx_status" AS ENUM ('pending', 'confirmed', 'failed', 'orphaned')`,
    );
    await queryRunner.query(
      `CREATE TYPE "tx_source" AS ENUM ('client', 'indexer', 'relayer')`,
    );
    await queryRunner.query(`
      CREATE TABLE "transactions" (
        "id"                     uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "userId"                 uuid NOT NULL,
        "walletId"               uuid,
        "chain"                  "chain_kind" NOT NULL,
        "srcChainId"             bigint NOT NULL,
        "txHash"                 character varying NOT NULL,
        "outputIndex"            integer NOT NULL DEFAULT 0,
        "type"                   "tx_type" NOT NULL DEFAULT 'transfer',
        "direction"              character varying NOT NULL,
        "token"                  character varying NOT NULL,
        "amount"                 numeric(78,0) NOT NULL,
        "usdValue"               numeric(38,6),
        "fromAddress"            character varying NOT NULL,
        "toAddress"              character varying NOT NULL,
        "feeToken"               character varying,
        "feeAmount"              numeric(78,0),
        "status"                 "tx_status" NOT NULL DEFAULT 'pending',
        "failureReason"          character varying,
        "confirmations"          integer NOT NULL DEFAULT 0,
        "requiredConfirmations"  integer NOT NULL,
        "blockHeight"            bigint,
        "source"                 "tx_source" NOT NULL,
        "paymentId"              uuid,
        "claimId"                uuid,
        "broadcastAt"            TIMESTAMP WITH TIME ZONE,
        "occurredAt"             TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_transactions_direction" CHECK ("direction" IN ('in', 'out')),
        CONSTRAINT "UQ_transactions_src_tx_output"
          UNIQUE ("srcChainId", "txHash", "outputIndex")
      )
    `);
    // Exactly the keyset cursor the History screen pages on. OFFSET would skip
    // or repeat rows every time the poller inserts an older transaction.
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_page" ON "transactions" ("userId", "occurredAt", "id")`,
    );

    // Foreign keys are named the way TypeORM names them, so schema diffing sees
    // the relations the entities declare rather than a pile of drift.
    await queryRunner.query(
      `ALTER TABLE "wallet_secrets" ADD CONSTRAINT "FK_e675f3bed3464a14bdd81c664eb" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "claims" ADD CONSTRAINT "FK_15ebd68213badb0489968ae6369" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "attestations" ADD CONSTRAINT "FK_c118a753b80cd8fb5716ec4f536" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "idempotency_keys" ADD CONSTRAINT "FK_4d2181624ba2d61e76a07175198" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "FK_6bb58f2b6e30cb51a6504599f41" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "FK_a88f466d39796d3081cf96e1b66" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "FK_721af04ac41f7598ecb59f5e66f" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "FK_9edbab82e9b0675cc5dec3bf42d" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE SET NULL`,
    );

    // --- supersessions and precision ---------------------------------------
    await queryRunner.query(`DROP TABLE "utility_token_claims"`);
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "amount" TYPE numeric(78,0) USING "amount"::numeric`,
    );
    // The identity is the IdP subject. An email is neither unique across
    // providers nor stable, so it must not be a key anything resolves by.
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users" SET "email" = "id"::text || '@placeholder.invalid' WHERE "email" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "amount" TYPE character varying`,
    );
    await queryRunner.query(`
      CREATE TABLE "utility_token_claims" (
        "id"            uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "couponId"      uuid NOT NULL UNIQUE REFERENCES "coupons"("id") ON DELETE CASCADE,
        "walletAddress" character varying NOT NULL,
        "amount"        numeric(18,18) NOT NULL,
        "txHash"        character varying,
        "claimedAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(`DROP TYPE "tx_source"`);
    await queryRunner.query(`DROP TYPE "tx_status"`);
    await queryRunner.query(`DROP TYPE "tx_type"`);
    await queryRunner.query(`
      CREATE TABLE "transactions" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "walletId"  uuid NOT NULL REFERENCES "wallets"("id") ON DELETE CASCADE,
        "txHash"    character varying NOT NULL,
        "chain"     character varying NOT NULL,
        "asset"     character varying NOT NULL,
        "amount"    numeric(18,8) NOT NULL,
        "direction" character varying NOT NULL,
        "status"    character varying NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`DROP TABLE "idempotency_keys"`);
    await queryRunner.query(`DROP TABLE "settlements"`);
    await queryRunner.query(`DROP TABLE "attestations"`);
    await queryRunner.query(`DROP TABLE "claims"`);
    await queryRunner.query(`DROP TYPE "claims_status_enum"`);
    await queryRunner.query(`DROP TABLE "wallet_secrets"`);

    await queryRunner.query(`DROP INDEX "IDX_wallets_lookup"`);
    await queryRunner.query(`DROP INDEX "IDX_wallets_one_primary"`);
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP CONSTRAINT "UQ_wallets_user_chain"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP CONSTRAINT "UQ_wallets_chain_address"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD "encryptedSeedBackupRef" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD "chainFamily" character varying`,
    );
    await queryRunner.query(`
      UPDATE "wallets" SET "chainFamily" = CASE "chain"
        WHEN 'evm'     THEN 'EVM'
        WHEN 'tron'    THEN 'TRON'
        WHEN 'bitcoin' THEN 'BTC'
        ELSE 'SPARK' END
    `);
    await queryRunner.query(
      `ALTER TABLE "wallets" ALTER COLUMN "chainFamily" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "verifiedAt"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "verified"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "isPrimary"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "path"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "srcChainId"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "chain"`);
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD CONSTRAINT "UQ_f907d5fd09a9d374f1da4e13bd3" UNIQUE ("address")`,
    );
    await queryRunner.query(`DROP TYPE "chain_kind"`);
  }
}
