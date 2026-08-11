import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One blob per user and kind: a write now overwrites instead of appending, so
 * the index that used to allow duplicates becomes the constraint that forbids
 * them. Existing duplicates collapse to the newest row — the older ones are
 * ciphertext nobody can read and the client kept its own copy or it did not.
 */
export class SecretsOverwrite1786800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "wallet_secrets" a
      USING "wallet_secrets" b
      WHERE a."user_id" = b."user_id"
        AND a."kind" = b."kind"
        AND (a."created_at", a."id") < (b."created_at", b."id")
    `);
    await queryRunner.query(`DROP INDEX "IDX_wallet_secrets_user_kind"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_wallet_secrets_user_kind" ON "wallet_secrets" ("user_id", "kind")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_wallet_secrets_user_kind"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_secrets_user_kind" ON "wallet_secrets" ("user_id", "kind")`,
    );
  }
}
