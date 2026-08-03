import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The signer registry: which addresses may act as issuer, relayer or guardian.
 *
 * Addresses only. Key material never lands here — a private key in a table is a
 * private key in every backup and every replica, which is exactly the single
 * point of compromise the K-of-N design exists to avoid.
 */
export class Signers1785700000000 implements MigrationInterface {
  name = 'Signers1785700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "signer_roles" AS ENUM ('issuer', 'relayer', 'guardian')`,
    );
    await queryRunner.query(`
      CREATE TABLE "signers" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "role"      "signer_roles" NOT NULL,
        "address"   character varying NOT NULL,
        "chainId"   bigint NOT NULL,
        "label"     character varying,
        "active"    boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_signers_role_address" UNIQUE ("role", "address")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_signers_role_active" ON "signers" ("role", "active")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "signers"`);
    await queryRunner.query(`DROP TYPE "signer_roles"`);
  }
}
