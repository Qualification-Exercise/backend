/**
 * Read-only viem clients, cached per endpoint URL. Every process that reads a
 * chain builds its client the same way — an HTTP transport and nothing else,
 * because the RPC endpoint each role may use is decided by its own config, not
 * here. The cache is per owner instance rather than global so one role's
 * endpoints never leak into another's.
 */
import { createPublicClient, http, type PublicClient } from 'viem';

const RPC_TIMEOUT_MS = 5_000;

export class ChainClientCache {
  private readonly clients = new Map<string, PublicClient>();

  get(url: string): PublicClient {
    const cached = this.clients.get(url);
    if (cached) return cached;

    const client = createPublicClient({
      transport: http(url, { timeout: RPC_TIMEOUT_MS }),
    });
    this.clients.set(url, client);
    return client;
  }
}
