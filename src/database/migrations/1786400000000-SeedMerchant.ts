import { MigrationInterface, QueryRunner } from 'typeorm';

import { normalizeAddress } from '@/wallets/address';

/**
 * The first merchant, as reference data rather than a seed script — same reason
 * as SeedSigners: the production image ships `dist/main.js` and no ts-node.
 *
 * Driven by MERCHANT_ADDRESS so no deployment inherits an address nobody owns:
 * the payment poller queries the indexer for every active merchant on every
 * tick, and a placeholder row would burn that budget forever. Unset means seed
 * nothing; register through `POST /api/merchants` instead.
 */
export class SeedMerchant1786400000000 implements MigrationInterface {
  name = 'SeedMerchant1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const raw = process.env.MERCHANT_ADDRESS?.trim();
    if (!raw) return;

    const { address } = normalizeAddress(raw);
    const srcChainId = Number(process.env.MERCHANT_SRC_CHAIN_ID ?? 11155111);
    const token = (process.env.MERCHANT_TOKEN ?? 'usdt').toLowerCase();
    const name = process.env.MERCHANT_NAME ?? 'Demo Merchant';

    await queryRunner.query(
      `INSERT INTO "merchants" ("name", "srcChainId", "address", "token")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("srcChainId", "address") DO NOTHING`,
      [name, srcChainId, address, token],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const raw = process.env.MERCHANT_ADDRESS?.trim();
    if (!raw) return;

    await queryRunner.query(
      `DELETE FROM "merchants" WHERE "srcChainId" = $1 AND "address" = $2`,
      [
        Number(process.env.MERCHANT_SRC_CHAIN_ID ?? 11155111),
        normalizeAddress(raw).address,
      ],
    );
  }
}
