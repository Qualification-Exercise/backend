import { MigrationInterface, QueryRunner } from 'typeorm';

export class BalanceCacheUserRelation1786300000000 implements MigrationInterface {
  name = 'BalanceCacheUserRelation1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "balance_cache" DROP CONSTRAINT "FK_balance_cache_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "balance_cache" ADD CONSTRAINT "FK_594798525f0bc235b520867a9ec"
         FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "balance_cache" DROP CONSTRAINT "FK_594798525f0bc235b520867a9ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "balance_cache" ADD CONSTRAINT "FK_balance_cache_user"
         FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
