import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentIngestion1785270185648 implements MigrationInterface {
  name = 'PaymentIngestion1785270185648';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "indexer_cursors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "srcChainId" bigint NOT NULL, "token" character varying NOT NULL, "address" character varying NOT NULL, "seenCount" integer NOT NULL DEFAULT '0', "lastBlockNumber" bigint NOT NULL DEFAULT '-1', "lastTransactionIndex" integer NOT NULL DEFAULT '-1', "lastTransferIndex" integer NOT NULL DEFAULT '-1', "lastPolledAt" TIMESTAMP WITH TIME ZONE, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_d5609694d56b614fbb4bfcb97e0" UNIQUE ("srcChainId", "token", "address"), CONSTRAINT "PK_6084369c64a3ecc40e49695e02e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "merchants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "srcChainId" bigint NOT NULL, "address" character varying NOT NULL, "token" character varying NOT NULL, "priority" integer NOT NULL DEFAULT '100', "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4fcedcc2cbe47ef775577a863dd" UNIQUE ("srcChainId", "address"), CONSTRAINT "PK_4fd312ef25f8e05ad47bfe7ed25" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "paymentRef" character varying NOT NULL, "srcChainId" bigint NOT NULL, "txHash" character varying NOT NULL, "outputIndex" integer NOT NULL, "blockNumber" bigint NOT NULL, "token" character varying NOT NULL, "amount" character varying NOT NULL, "fromAddress" character varying NOT NULL, "merchantAddress" character varying NOT NULL, "userId" uuid, "status" character varying NOT NULL DEFAULT 'pending', "transferredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "confirmedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_0195e1ffe15ff56475334393ae0" UNIQUE ("paymentRef"), CONSTRAINT "UQ_120e5bda262f06220b5aa023032" UNIQUE ("srcChainId", "txHash", "outputIndex"), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_886dc448a0e13161bf9a8dadb8" ON "payments"  ("merchantAddress") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32b41cdb985a296213e9a928b5" ON "payments"  ("status") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_32b41cdb985a296213e9a928b5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_886dc448a0e13161bf9a8dadb8"`,
    );
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TABLE "merchants"`);
    await queryRunner.query(`DROP TABLE "indexer_cursors"`);
  }
}
