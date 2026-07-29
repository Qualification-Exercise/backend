import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccrualCoupons1785272858122 implements MigrationInterface {
  name = 'AccrualCoupons1785272858122';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coupons" DROP CONSTRAINT "FK_a768b82097ee49bb0a46be80546"`,
    );
    await queryRunner.query(`ALTER TABLE "coupons" DROP COLUMN "value"`);
    await queryRunner.query(
      `ALTER TABLE "coupons" DROP COLUMN "sourceTransactionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupons" ADD "paymentRef" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupons" ADD CONSTRAINT "UQ_0352dde23c7e3eef9c14c0115b1" UNIQUE ("paymentRef")`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupons" ADD "amount" numeric(78,0) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupons" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupons" ALTER COLUMN "status" SET DEFAULT 'ISSUED'`,
    );
    await queryRunner.query(`ALTER TABLE "coupons" DROP COLUMN "expiresAt"`);
    await queryRunner.query(
      `ALTER TABLE "coupons" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_81dcb5419991c66b6fd4a1b618" ON "coupons"  ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed793a952de93a5f8d5dfdace5" ON "coupons"  ("status") `,
    );

    // The coupon state machine, enforced by the database. A service that
    // moves a coupon somewhere the diagram does not allow gets an error, not
    // a silently wrong row that a later claim reads as authorisation.
    //
    //   PENDING -> ISSUED -> PENDING_ATTESTATION -> ATTESTED
    //           -> CLAIM_SUBMITTED -> CLAIMED
    //   issuer rejection / deadline / reorg / tx failure -> back to ISSUED
    //   anything still open -> EXPIRED / ORPHANED
    //   CLAIMED -> ORPHANED only (a reorg after payout is an incident, and
    //   an expired-after-payout coupon is meaningless)
    await queryRunner.query(`
            CREATE OR REPLACE FUNCTION coupons_valid_transition() RETURNS trigger AS $$
            DECLARE
                allowed text[];
            BEGIN
                IF NEW.status = OLD.status THEN
                    RETURN NEW;
                END IF;

                allowed := CASE OLD.status
                    WHEN 'PENDING'             THEN ARRAY['ISSUED','EXPIRED','ORPHANED']
                    WHEN 'ISSUED'              THEN ARRAY['PENDING_ATTESTATION','EXPIRED','ORPHANED']
                    WHEN 'PENDING_ATTESTATION' THEN ARRAY['ATTESTED','ISSUED','EXPIRED','ORPHANED']
                    WHEN 'ATTESTED'            THEN ARRAY['CLAIM_SUBMITTED','ISSUED','EXPIRED','ORPHANED']
                    WHEN 'CLAIM_SUBMITTED'     THEN ARRAY['CLAIMED','ISSUED','EXPIRED','ORPHANED']
                    WHEN 'CLAIMED'             THEN ARRAY['ORPHANED']
                    ELSE ARRAY[]::text[]
                END;

                IF NOT (NEW.status = ANY(allowed)) THEN
                    RAISE EXCEPTION 'illegal coupon transition % -> %', OLD.status, NEW.status;
                END IF;

                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
    await queryRunner.query(`
            CREATE TRIGGER coupons_state_machine
            BEFORE UPDATE ON "coupons"
            FOR EACH ROW EXECUTE FUNCTION coupons_valid_transition();
        `);
    // A coupon may only be born somewhere the machine starts.
    await queryRunner.query(`
            ALTER TABLE "coupons" ADD CONSTRAINT "coupons_initial_status"
            CHECK (status IN ('PENDING','ISSUED','PENDING_ATTESTATION','ATTESTED',
                              'CLAIM_SUBMITTED','CLAIMED','EXPIRED','ORPHANED'));
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coupons" DROP CONSTRAINT IF EXISTS "coupons_initial_status"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS coupons_state_machine ON "coupons"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS coupons_valid_transition()`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed793a952de93a5f8d5dfdace5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_81dcb5419991c66b6fd4a1b618"`,
    );
    await queryRunner.query(`ALTER TABLE "coupons" DROP COLUMN "expiresAt"`);
    await queryRunner.query(`ALTER TABLE "coupons" ADD "expiresAt" TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "coupons" ALTER COLUMN "status" SET DEFAULT 'issued'`,
    );
    await queryRunner.query(`ALTER TABLE "coupons" DROP COLUMN "updatedAt"`);
    await queryRunner.query(`ALTER TABLE "coupons" DROP COLUMN "amount"`);
    await queryRunner.query(
      `ALTER TABLE "coupons" DROP CONSTRAINT "UQ_0352dde23c7e3eef9c14c0115b1"`,
    );
    await queryRunner.query(`ALTER TABLE "coupons" DROP COLUMN "paymentRef"`);
    await queryRunner.query(
      `ALTER TABLE "coupons" ADD "sourceTransactionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupons" ADD "value" numeric(18,8) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupons" ADD CONSTRAINT "FK_a768b82097ee49bb0a46be80546" FOREIGN KEY ("sourceTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
