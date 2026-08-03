import { MigrationInterface, QueryRunner } from 'typeorm';

export class ServiceCounters1785900000000 implements MigrationInterface {
  name = 'ServiceCounters1785900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "service_counters" (
        "name"       character varying NOT NULL PRIMARY KEY,
        "value"      bigint NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "service_counters"`);
  }
}
