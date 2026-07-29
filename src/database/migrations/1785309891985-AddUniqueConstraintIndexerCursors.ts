import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueConstraintIndexerCursors1785309891985 implements MigrationInterface {
  name = 'AddUniqueConstraintIndexerCursors1785309891985';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_indexer_cursors_merchant_chain_token"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_indexer_cursors_merchant_chain_token" ON "indexer_cursors"  ("merchant_id", "src_chain_id", "token_address") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_indexer_cursors_merchant_chain_token"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_indexer_cursors_merchant_chain_token" ON "indexer_cursors"  ("merchant_id", "src_chain_id", "token_address") `,
    );
  }
}
