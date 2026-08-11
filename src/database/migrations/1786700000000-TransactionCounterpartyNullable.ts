import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mint, burn and contract creation reach the indexer with one side of the
 * transfer missing. NOT NULL forced the poller to invent an address for it, so
 * the column now carries the absence the chain actually reported.
 */
export class TransactionCounterpartyNullable1786700000000 implements MigrationInterface {
  name = 'TransactionCounterpartyNullable1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "fromAddress" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "toAddress" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "transactions" SET "fromAddress" = '' WHERE "fromAddress" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "transactions" SET "toAddress" = '' WHERE "toAddress" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "fromAddress" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "toAddress" SET NOT NULL`,
    );
  }
}
