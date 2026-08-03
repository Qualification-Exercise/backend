import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClaimStateMachine1785500000000 implements MigrationInterface {
  name = 'ClaimStateMachine1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "claims_status_enum" ADD VALUE IF NOT EXISTS 'FAILED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "claims_status_enum" ADD VALUE IF NOT EXISTS 'EXPIRED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "claims" ADD "chain_id" bigint NOT NULL DEFAULT 11155111`,
    );
    await queryRunner.query(
      `ALTER TABLE "claims" ALTER COLUMN "chain_id" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "claims" ADD "failure_reason" character varying`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION claims_valid_transition() RETURNS trigger AS $$
      DECLARE
          allowed text[];
      BEGIN
          -- A FAILED claim without a reason is an alert nobody can act on.
          IF (NEW.status::text = 'FAILED') <> (NEW.failure_reason IS NOT NULL) THEN
              RAISE EXCEPTION 'a claim is FAILED if and only if it has a failure_reason';
          END IF;

          IF TG_OP = 'INSERT' OR NEW.status = OLD.status THEN
              RETURN NEW;
          END IF;

          allowed := CASE OLD.status::text
              WHEN 'PENDING_ATTESTATION' THEN ARRAY['ATTESTED','FAILED']
              WHEN 'ATTESTED'            THEN ARRAY['CLAIM_SUBMITTED','FAILED','EXPIRED']
              WHEN 'CLAIM_SUBMITTED'     THEN ARRAY['CLAIMED','FAILED']
              ELSE ARRAY[]::text[]
          END;

          IF NOT (NEW.status::text = ANY(allowed)) THEN
              RAISE EXCEPTION 'illegal claim transition % -> %', OLD.status, NEW.status;
          END IF;

          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER claims_state_machine
      BEFORE INSERT OR UPDATE ON "claims"
      FOR EACH ROW EXECUTE FUNCTION claims_valid_transition();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS claims_state_machine ON "claims"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS claims_valid_transition()`,
    );
    await queryRunner.query(
      `ALTER TABLE "claims" DROP COLUMN "failure_reason"`,
    );
    await queryRunner.query(`ALTER TABLE "claims" DROP COLUMN "chain_id"`);
  }
}
