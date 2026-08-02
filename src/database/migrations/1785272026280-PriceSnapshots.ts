import { MigrationInterface, QueryRunner } from 'typeorm';

export class PriceSnapshots1785272026280 implements MigrationInterface {
  name = 'PriceSnapshots1785272026280';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "price_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "paymentRef" character varying NOT NULL, "asset" character varying NOT NULL, "quote" character varying NOT NULL DEFAULT 'USD', "price" numeric(38,18) NOT NULL, "source" character varying NOT NULL, "providerTimestamp" TIMESTAMP WITH TIME ZONE NOT NULL, "ingestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_506dbfba578050df342b613daec" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6790c0ff211f669151c16afe17" ON "price_snapshots"  ("paymentRef") `,
    );

    // Append-only, enforced by the database rather than by every future
    // service getting its grants right. A snapshot that can be edited is a
    // way to move all K issuers at once, which is the thing this table exists
    // to prevent. BE-02 role grants are the outer layer; this is the floor.
    await queryRunner.query(`
            CREATE OR REPLACE FUNCTION price_snapshots_append_only() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'price_snapshots is append-only (attempted %)', TG_OP;
            END;
            $$ LANGUAGE plpgsql;
        `);
    await queryRunner.query(`
            CREATE TRIGGER price_snapshots_no_update_delete
            BEFORE UPDATE OR DELETE ON "price_snapshots"
            FOR EACH ROW EXECUTE FUNCTION price_snapshots_append_only();
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS price_snapshots_no_update_delete ON "price_snapshots"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS price_snapshots_append_only()`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6790c0ff211f669151c16afe17"`,
    );
    await queryRunner.query(`DROP TABLE "price_snapshots"`);
  }
}
