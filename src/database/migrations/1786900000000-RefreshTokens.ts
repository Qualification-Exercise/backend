import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refresh tokens were stateless, so nothing could end a session: a leaked
 * token stayed valid for its full week and logout was impossible. This table
 * is the record that makes a refresh revocable and its reuse detectable.
 */
export class RefreshTokens1786900000000 implements MigrationInterface {
  name = 'RefreshTokens1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "jti" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "family_id" uuid NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("jti"),
        CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_family" ON "refresh_tokens" ("family_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_user" ON "refresh_tokens" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
