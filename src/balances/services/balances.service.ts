import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CHAINS, chainBySrcChainId } from '@/chains';
import { EChainKind } from '@/chains/chain-kind.enum';
import type { Env } from '@/config/env';
import { BalanceCache } from '@/balances/entities/balance-cache.entity';
import { IndexerService } from '@/indexer/services/indexer.service';
import { FAMILY_OF_CHAIN_KIND } from '@/wallets/address';
import { Wallet } from '@/wallets/entities/wallet.entity';

export interface IBalanceResponse {
  srcChainId: number;
  chain: EChainKind;
  token: string;
  address: string;
  amount: string;
  decimals: number | null;
  observedAt: string;
  stale: boolean;
}

/**
 * Cached balances, never a proxy.
 *
 * A read here answers from `balance_cache` and, if the copy is older than the
 * TTL, kicks off a refresh in the background. The user gets an instant answer
 * with its age attached; the indexer sees at most one refresh per TTL per user,
 * so the History screen cannot eat the budget payment detection runs on.
 */
@Injectable()
export class BalancesService {
  private readonly logger = new Logger(BalancesService.name);
  private readonly ttlMs: number;
  private readonly refreshing = new Set<string>();

  constructor(
    @InjectRepository(BalanceCache)
    private readonly balances: Repository<BalanceCache>,
    @InjectRepository(Wallet)
    private readonly wallets: Repository<Wallet>,
    private readonly indexer: IndexerService,
    configService: ConfigService<Env, true>,
  ) {
    this.ttlMs = configService.get('BALANCE_CACHE_TTL_MS');
  }

  async list(userId: string): Promise<{
    items: IBalanceResponse[];
    ttlSeconds: number;
  }> {
    const rows = await this.balances.find({ where: { userId } });
    const now = Date.now();

    const stale =
      rows.length === 0 ||
      rows.some((row) => now - row.observedAt.getTime() > this.ttlMs);
    if (stale) void this.refresh(userId);

    return {
      items: rows.map((row) => ({
        srcChainId: Number(row.srcChainId),
        chain: chainBySrcChainId(Number(row.srcChainId)).kind,
        token: row.token.toUpperCase(),
        address: row.address,
        amount: row.amount,
        decimals: row.decimals,
        observedAt: row.observedAt.toISOString(),
        stale: now - row.observedAt.getTime() > this.ttlMs,
      })),
      ttlSeconds: Math.round(this.ttlMs / 1000),
    };
  }

  async refresh(userId: string): Promise<void> {
    if (this.refreshing.has(userId)) return;
    this.refreshing.add(userId);

    try {
      const wallets = await this.wallets.find({ where: { userId } });
      const observedAt = new Date();

      for (const wallet of wallets) {
        for (const chain of CHAINS) {
          if (chain.kind !== wallet.chain) continue;
          for (const token of chain.indexer.tokens) {
            await this.refreshOne(userId, wallet, chain, token, observedAt);
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Balance refresh failed for ${userId}: ${String(err)}`);
    } finally {
      this.refreshing.delete(userId);
    }
  }

  private async refreshOne(
    userId: string,
    wallet: Wallet,
    chain: (typeof CHAINS)[number],
    token: string,
    observedAt: Date,
  ): Promise<void> {
    try {
      const { tokenBalance } = await this.indexer.tokenBalance({
        blockchain: chain.indexer.blockchain,
        token,
        address: wallet.address,
      });

      await this.balances.upsert(
        {
          userId,
          srcChainId: chain.srcChainId,
          token,
          address: wallet.address,
          amount: tokenBalance.amount,
          decimals: tokenBalance.decimals ?? null,
          observedAt,
        },
        ['userId', 'srcChainId', 'token'],
      );
    } catch (err) {
      this.logger.debug(
        `No balance for ${FAMILY_OF_CHAIN_KIND[wallet.chain]} ` +
          `${chain.indexer.blockchain}/${token}: ${String(err)}`,
      );
    }
  }
}
