import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, type PublicClient } from 'viem';

import { chainBySrcChainId } from '@/chains';
import type { Env } from '@/config/env';

const HEAD_CACHE_MS = 10_000;

@Injectable()
export class ConfirmationPolicy {
  private readonly logger = new Logger(ConfirmationPolicy.name);
  private readonly depths: Record<string, number>;
  private readonly rpcUrls: Record<string, string>;
  private readonly clients = new Map<number, PublicClient>();
  private readonly heads = new Map<number, { value: number; at: number }>();
  private readonly warned = new Set<number>();

  constructor(configService: ConfigService<Env, true>) {
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

    const client = this.clientFor(srcChainId);
    if (!client) return null;

    try {
      const head = Number(await client.getBlockNumber());
      this.heads.set(srcChainId, { value: head, at: Date.now() });
      return head;
    } catch (err) {
      this.logger.warn(
        `Chain head unavailable for ${srcChainId}; payments stay pending: ${String(err)}`,
      );
      return null;
    }
  }

  private clientFor(srcChainId: number): PublicClient | null {
    const existing = this.clients.get(srcChainId);
    if (existing) return existing;

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

    const client = createPublicClient({ transport: http(url) });
    this.clients.set(srcChainId, client);
    return client;
  }

  private warnOnce(srcChainId: number, message: string) {
    if (this.warned.has(srcChainId)) return;
    this.warned.add(srcChainId);
    this.logger.warn(message);
  }
}
