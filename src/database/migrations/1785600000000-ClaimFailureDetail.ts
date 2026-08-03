import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClaimFailureDetail1785600000000 implements MigrationInterface {
  name = 'ClaimFailureDetail1785600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "claims" ADD "failure_detail" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "claims" DROP COLUMN "failure_detail"`,
    );
  }
}
