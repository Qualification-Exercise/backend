import { MigrationInterface, QueryRunner } from 'typeorm';

export class BalanceCache1786100000000 implements MigrationInterface {
  name = 'BalanceCache1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "balance_cache" (
        "id"          uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
        "userId"      uuid NOT NULL,
        "srcChainId"  bigint NOT NULL,
        "token"       character varying NOT NULL,
        "address"     character varying NOT NULL,
        "amount"      numeric(78,0) NOT NULL,
        "decimals"    integer,
        "observedAt"  TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_balance_cache_user_chain_token"
          UNIQUE ("userId", "srcChainId", "token")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "balance_cache" ADD CONSTRAINT "FK_balance_cache_user"
         FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "balance_cache"`);
  }
}
