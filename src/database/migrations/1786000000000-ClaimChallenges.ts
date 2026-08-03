import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The ownership proof moves from linking to claiming.
 *
 * Linking a wallet is now a declaration made right after the seed phrase
 * exists, and the signature is asked for once, on the claim screen, where it
 * authorises a payout. So the challenge table belongs to claims, and the
 * poller's partial index — which existed to keep unverified addresses out of
 * payment attribution — no longer describes how attribution works.
 */
export class ClaimChallenges1786000000000 implements MigrationInterface {
  name = 'ClaimChallenges1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallet_challenges" RENAME TO "claim_challenges"`,
    );
    await queryRunner.query(
      `ALTER TABLE "claim_challenges"
         RENAME CONSTRAINT "FK_297c39ba95746fe65e48c6abf17" TO "FK_0b991e47a282e9a867446f36251"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_297c39ba95746fe65e48c6abf1" RENAME TO "IDX_0b991e47a282e9a867446f3625"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallets_lookup"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_wallets_lookup" ON "wallets" ("srcChainId", "address") WHERE "verified"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_0b991e47a282e9a867446f3625" RENAME TO "IDX_297c39ba95746fe65e48c6abf1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "claim_challenges"
         RENAME CONSTRAINT "FK_0b991e47a282e9a867446f36251" TO "FK_297c39ba95746fe65e48c6abf17"`,
    );
    await queryRunner.query(
      `ALTER TABLE "claim_challenges" RENAME TO "wallet_challenges"`,
    );
  }
}
