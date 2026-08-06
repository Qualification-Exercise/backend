import { MigrationInterface, QueryRunner } from 'typeorm';

export class SecretsList1786500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "wallet_secrets"`);
    await queryRunner.query(
      `CREATE TYPE "secret_kinds" AS ENUM ('entropy', 'seed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "wallet_secrets" (
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "user_id"    uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "kind"       "secret_kinds" NOT NULL,
        "blob"       text NOT NULL,
        "metadata"   jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_secrets_user_kind" ON "wallet_secrets" ("user_id", "kind")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "wallet_secrets"`);
    await queryRunner.query(`DROP TYPE "secret_kinds"`);
    await queryRunner.query(`
      CREATE TABLE "wallet_secrets" (
        "user_id"            uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
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
  }
}
