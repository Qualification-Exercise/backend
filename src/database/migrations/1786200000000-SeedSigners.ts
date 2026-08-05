import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The demo signer set, as reference data rather than a seed script.
 *
 * `npm run seed` needs ts-node and `src/` on disk, and the production image has
 * neither — it ships `dist/main.js` and `npm ci --omit=dev`. Signers are not
 * test data either: the relayer checks an attestation's author against this
 * table before spending gas, so an empty registry is a dead deployment.
 *
 * Addresses match `contract/deployments/11155111.json` and `src/database/seed.ts`.
 * Keys stay encrypted in each process's own environment.
 */
export class SeedSigners1786200000000 implements MigrationInterface {
  name = 'SeedSigners1786200000000';

  private static readonly SIGNERS = [
    ['issuer', '0xf4B48550B9D15d419f77727107fd3cAF0c160DEc', 'issuer-a'],
    ['relayer', '0x95FA3C48A38077e20b47c8Ef426597a7e1F112ab', 'relayer'],
    ['guardian', '0x5CBC57Ab603208eC26CDBB5cc54c99c7fb1C0c89', 'guardian'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const chainId = Number(process.env.REWARD_CHAIN_ID ?? 11155111);

    for (const [role, address, label] of SeedSigners1786200000000.SIGNERS) {
      // Idempotent: a re-run, or a database already seeded by `npm run seed`,
      // must not fail the migration that every boot depends on.
      await queryRunner.query(
        `INSERT INTO "signers" ("role", "address", "chainId", "label")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT "UQ_signers_role_address" DO NOTHING`,
        [role, address, chainId, label],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [role, address] of SeedSigners1786200000000.SIGNERS) {
      await queryRunner.query(
        `DELETE FROM "signers" WHERE "role" = $1 AND "address" = $2`,
        [role, address],
      );
    }
  }
}
