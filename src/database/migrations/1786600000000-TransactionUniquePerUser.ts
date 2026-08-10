import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The global unique on (srcChainId, txHash, outputIndex) let one transfer exist
 * once in the whole table, so a payment between two platform users could only
 * be the sender's `out` row — the recipient's `in` row lost the race and was
 * dropped as a duplicate. History is per user, so the key is too.
 */
export class TransactionUniquePerUser1786600000000 implements MigrationInterface {
  name = 'TransactionUniquePerUser1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "UQ_transactions_src_tx_output"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "UQ_transactions_user_src_tx_output" ` +
        `UNIQUE ("userId", "srcChainId", "txHash", "outputIndex")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "UQ_transactions_user_src_tx_output"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "UQ_transactions_src_tx_output" ` +
        `UNIQUE ("srcChainId", "txHash", "outputIndex")`,
    );
  }
}
