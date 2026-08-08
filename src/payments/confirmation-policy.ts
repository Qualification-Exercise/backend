import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PublicClient } from 'viem';

import { firstValueFrom } from 'rxjs';

import { ChainClientCache } from '@/common/chain/public-client';
import { chainBySrcChainId, chainKindOf } from '@/chains';
import { EChainKind } from '@/chains/chain-kind.enum';
import type { Env } from '@/config/env';

const HEAD_CACHE_MS = 10_000;

@Injectable()
export class ConfirmationPolicy {
  private readonly logger = new Logger(ConfirmationPolicy.name);
  private readonly depths: Record<string, number>;
  private readonly rpcUrls: Record<string, string>;
  private readonly clients = new ChainClientCache();
  private readonly heads = new Map<number, { value: number; at: number }>();
  private readonly warned = new Set<number>();

  constructor(
    configService: ConfigService<Env, true>,
    // Only the non-EVM heads need it, and a process that never asks about Tron
    // or Bitcoin should not have to wire an HTTP client to start.
    @Optional() private readonly http?: HttpService,
  ) {
    this.depths = JSON.parse(configService.get('CONFIRMATION_DEPTHS'));
    this.rpcUrls = JSON.parse(configService.get('RPC_URLS'));
  }

  depthFor(srcChainId: number): number {
    const depth = this.depths[String(srcChainId)];
    if (depth === undefined) {
      throw new Error(`No confirmation depth configured for ${srcChainId}`);
    }
    return depth;
  }

  async confirmations(
    srcChainId: number,
    blockNumber: number,
  ): Promise<number | null> {
    const head = await this.head(srcChainId);
    if (head === null) return null;
    return Math.max(0, head - blockNumber + 1);
  }

  async isConfirmed(srcChainId: number, blockNumber: number): Promise<boolean> {
    const confirmations = await this.confirmations(srcChainId, blockNumber);
    return confirmations !== null && confirmations >= this.depthFor(srcChainId);
  }

  private async head(srcChainId: number): Promise<number | null> {
    const cached = this.heads.get(srcChainId);
    if (cached && Date.now() - cached.at < HEAD_CACHE_MS) return cached.value;

    try {
      const head = await this.readHead(srcChainId);
      if (head === null) return null;
      this.heads.set(srcChainId, { value: head, at: Date.now() });
      return head;
    } catch (err) {
      this.logger.warn(
        `Chain head unavailable for ${srcChainId}; payments stay pending: ${String(err)}`,
      );
      return null;
    }
  }

  /**
   * Three chains, three ways to ask "how far along are you". A payment on a
   * chain we cannot ask stays `pending` rather than being confirmed on
   * optimism — the whole depth check exists to stop a reorg becoming cashback.
   */
  private async readHead(srcChainId: number): Promise<number | null> {
    const url = this.rpcUrls[String(srcChainId)];
    if (!url) {
      this.warnOnce(
        srcChainId,
        `No RPC_URLS entry for ${srcChainId} (${chainBySrcChainId(srcChainId).name}); ` +
          'its payments cannot reach the confirmation depth and stay pending',
      );
      return null;
    }
    const base = url.replace(/\/$/, '');

    switch (chainKindOf(srcChainId)) {
      case EChainKind.EVM: {
        const client = this.clientFor(srcChainId);
        return client ? Number(await client.getBlockNumber()) : null;
      }
      case EChainKind.TRON: {
        if (!this.http) return null;
        const response = await firstValueFrom(
          this.http.post<{ block_header?: { raw_data?: { number?: number } } }>(
            `${base}/wallet/getnowblock`,
            {},
            { timeout: 15_000 },
          ),
        );
        return response.data?.block_header?.raw_data?.number ?? null;
      }
      case EChainKind.BITCOIN: {
        if (!this.http) return null;
        const response = await firstValueFrom(
          this.http.get<number | string>(`${base}/blocks/tip/height`, {
            timeout: 15_000,
          }),
        );
        const tip = Number(response.data);
        return Number.isFinite(tip) && tip > 0 ? tip : null;
      }
      default:
        this.warnOnce(
          srcChainId,
          `No head source for ${chainBySrcChainId(srcChainId).name}; ` +
            'its payments stay pending',
        );
        return null;
    }
  }

  private clientFor(srcChainId: number): PublicClient | null {
    const url = this.rpcUrls[String(srcChainId)];
    if (!url) {
      this.warnOnce(
        srcChainId,
        `No RPC_URLS entry for ${srcChainId} (${chainBySrcChainId(srcChainId).name}); ` +
          'its payments cannot reach the confirmation depth and stay pending',
      );
      return null;
    }
    // ponytail: EVM only. Tron, Bitcoin and Spark need their own head sources —
    // add a per-family provider here, nothing above this line changes.
    if (!chainBySrcChainId(srcChainId).evm) {
      this.warnOnce(
        srcChainId,
        `Head lookup for non-EVM chain ${srcChainId} is not implemented; ` +
          'its payments stay pending',
      );
      return null;
    }

    return this.clients.get(url);
  }

  private warnOnce(srcChainId: number, message: string) {
    if (this.warned.has(srcChainId)) return;
    this.warned.add(srcChainId);
    this.logger.warn(message);
  }
}
