import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The signed message names a coupon, but the challenge row did not record
 * which one, so the message was rebuilt from a different source at claim time
 * and any mismatch surfaced as "signature invalid". The binding lives with the
 * challenge now.
 *
 * Existing rows are deleted rather than backfilled: a challenge lives five
 * minutes, and inventing a coupon for one would be inventing consent.
 */
export class ChallengeCouponBinding1787000000000 implements MigrationInterface {
  name = 'ChallengeCouponBinding1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "claim_challenges"`);
    await queryRunner.query(
      `ALTER TABLE "claim_challenges" ADD "couponRef" character varying NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "claim_challenges" DROP COLUMN "couponRef"`,
    );
  }
}
