import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentWorkflowTables1785309552623 implements MigrationInterface {
  name = 'CreatePaymentWorkflowTables1785309552623';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."claims_status_enum" AS ENUM('PENDING_ATTESTATION', 'ATTESTED', 'CLAIM_SUBMITTED', 'CLAIMED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "claims" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "coupon_id" uuid NOT NULL, "recipient" character varying NOT NULL, "amount" numeric(40,0) NOT NULL, "deadline" bigint NOT NULL, "status" "public"."claims_status_enum" NOT NULL DEFAULT 'PENDING_ATTESTATION', "tx_hash" character varying, "tx_nonce" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_96c91970c0dcb2f69fdccd0a698" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_claims_status" ON "claims"  ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_claims_coupon_id" ON "claims"  ("coupon_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "attestations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "claim_id" uuid NOT NULL, "issuer_address" character varying NOT NULL, "signature" character varying NOT NULL, "chain_id" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5bfe0da3020a6f609762f559d17" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_attestations_claim_id_issuer_address" ON "attestations"  ("claim_id", "issuer_address") `,
    );
    await queryRunner.query(
      `CREATE TABLE "backups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "ciphertext" bytea NOT NULL, "kdf_algorithm" character varying NOT NULL, "kdf_params" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ca30ff369eddfc7dac3b35d0d3c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_backups_user_id" ON "backups"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "idempotency_keys" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "idempotency_key" character varying NOT NULL, "response_data" jsonb NOT NULL, "request_hash" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_8ad20779ad0411107a56e53d0f6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_idempotency_keys_expires_at" ON "idempotency_keys"  ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_idempotency_keys_user_id_key" ON "idempotency_keys"  ("user_id", "idempotency_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "price_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "payment_id" uuid NOT NULL, "asset_usd_price" numeric(20,8) NOT NULL, "snapshot_timestamp" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_56a21a435cb01e4ee8bb6f9ba0" UNIQUE ("payment_id"), CONSTRAINT "PK_506dbfba578050df342b613daec" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_price_snapshots_payment_id" ON "price_snapshots"  ("payment_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payments_status_enum" AS ENUM('PENDING', 'CONFIRMED', 'ORPHANED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "merchant_id" uuid NOT NULL, "wallet_id" uuid, "src_chain_id" character varying NOT NULL, "tx_hash" character varying NOT NULL, "output_index" integer NOT NULL, "payment_ref" character varying NOT NULL, "token_address" character varying NOT NULL, "amount" numeric(40,0) NOT NULL, "status" "public"."payments_status_enum" NOT NULL DEFAULT 'PENDING', "block_number" bigint NOT NULL, "block_hash" character varying NOT NULL, "confirmation_count" integer NOT NULL DEFAULT '0', "indexer_tx_id" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "coupon_id" uuid, CONSTRAINT "UQ_b572a4ded124eb76aa5f391d3d2" UNIQUE ("payment_ref"), CONSTRAINT "REL_8aee881c0faac11e56c2bb8f28" UNIQUE ("coupon_id"), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_status" ON "payments"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_wallet_id" ON "payments"  ("wallet_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_merchant_id" ON "payments"  ("merchant_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_src_chain_id_tx_hash_output_index" ON "payments"  ("src_chain_id", "tx_hash", "output_index") `,
    );
    await queryRunner.query(
      `CREATE TABLE "merchants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "src_chain_id" character varying NOT NULL, "address" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4fd312ef25f8e05ad47bfe7ed25" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_merchants_src_chain_id_address" ON "merchants"  ("src_chain_id", "address") `,
    );
    await queryRunner.query(
      `CREATE TABLE "indexer_cursors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "merchant_id" uuid NOT NULL, "src_chain_id" character varying NOT NULL, "token_address" character varying NOT NULL, "cursor" character varying NOT NULL, "last_block_height" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6084369c64a3ecc40e49695e02e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_indexer_cursors_merchant_chain_token" ON "indexer_cursors"  ("merchant_id", "src_chain_id", "token_address") `,
    );
    await queryRunner.query(
      `CREATE TABLE "settlements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "payment_ref" character varying NOT NULL, "recipient" character varying NOT NULL, "amount" numeric(40,0) NOT NULL, "tx_hash" character varying NOT NULL, "block_number" bigint NOT NULL, "event_timestamp" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5f523ce152b84e818bff9467aab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_settlements_payment_ref" ON "settlements"  ("payment_ref") `,
    );
    await queryRunner.query(
      `ALTER TABLE "claims" ADD CONSTRAINT "FK_15ebd68213badb0489968ae6369" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attestations" ADD CONSTRAINT "FK_c118a753b80cd8fb5716ec4f536" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "backups" ADD CONSTRAINT "FK_5dec857c95469df8856e286c2af" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "idempotency_keys" ADD CONSTRAINT "FK_4d2181624ba2d61e76a07175198" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_snapshots" ADD CONSTRAINT "FK_56a21a435cb01e4ee8bb6f9ba0c" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_c4a9a77d8ec9c37d3654a0d2ebc" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_1bdffa25425538e630d8eb8a8bc" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_8aee881c0faac11e56c2bb8f282" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "indexer_cursors" ADD CONSTRAINT "FK_f3c376faa0e9ac0c3b2ca41dad7" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "indexer_cursors" DROP CONSTRAINT "FK_f3c376faa0e9ac0c3b2ca41dad7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_8aee881c0faac11e56c2bb8f282"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_1bdffa25425538e630d8eb8a8bc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_c4a9a77d8ec9c37d3654a0d2ebc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_snapshots" DROP CONSTRAINT "FK_56a21a435cb01e4ee8bb6f9ba0c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "idempotency_keys" DROP CONSTRAINT "FK_4d2181624ba2d61e76a07175198"`,
    );
    await queryRunner.query(
      `ALTER TABLE "backups" DROP CONSTRAINT "FK_5dec857c95469df8856e286c2af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attestations" DROP CONSTRAINT "FK_c118a753b80cd8fb5716ec4f536"`,
    );
    await queryRunner.query(
      `ALTER TABLE "claims" DROP CONSTRAINT "FK_15ebd68213badb0489968ae6369"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_settlements_payment_ref"`,
    );
    await queryRunner.query(`DROP TABLE "settlements"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_indexer_cursors_merchant_chain_token"`,
    );
    await queryRunner.query(`DROP TABLE "indexer_cursors"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_merchants_src_chain_id_address"`,
    );
    await queryRunner.query(`DROP TABLE "merchants"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_payments_src_chain_id_tx_hash_output_index"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_merchant_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_wallet_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_status"`);
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_price_snapshots_payment_id"`,
    );
    await queryRunner.query(`DROP TABLE "price_snapshots"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_idempotency_keys_user_id_key"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_idempotency_keys_expires_at"`,
    );
    await queryRunner.query(`DROP TABLE "idempotency_keys"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_backups_user_id"`);
    await queryRunner.query(`DROP TABLE "backups"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_attestations_claim_id_issuer_address"`,
    );
    await queryRunner.query(`DROP TABLE "attestations"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_claims_coupon_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_claims_status"`);
    await queryRunner.query(`DROP TABLE "claims"`);
    await queryRunner.query(`DROP TYPE "public"."claims_status_enum"`);
  }
}
