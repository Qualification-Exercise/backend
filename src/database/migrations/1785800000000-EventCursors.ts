import { MigrationInterface, QueryRunner } from 'typeorm';

export class EventCursors1785800000000 implements MigrationInterface {
  name = 'EventCursors1785800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "event_cursors" (
        "name"       character varying NOT NULL PRIMARY KEY,
        "last_block" bigint NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "event_cursors"`);
  }
}
