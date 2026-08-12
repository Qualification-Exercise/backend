import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { RpcEndpointError } from '@/common/chain/rpc-endpoints';
import { IssuerConfig, IssuerConfigError } from '@/issuer/issuer-config';

const ISSUER_DIR = resolve(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('issuer independence', () => {
  it('never reaches the Indexer API', () => {
    const forbidden =
      /from ['"]@\/indexer|IndexerService|INDEXER_BASE_URL|INDEXER_API_KEY/;
    const offenders = sourceFiles(ISSUER_DIR).filter((path) =>
      forbidden.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('has no controllers — nothing can call in', () => {
    const offenders = sourceFiles(ISSUER_DIR).filter((path) =>
      /@Controller|@Get\(|@Post\(/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

function configWith(overrides: Record<string, unknown>): () => IssuerConfig {
  const values: Record<string, unknown> = {
    ISSUER_ID: 'issuer-a',
    ISSUER_RPC_URL: 'https://issuer-a.example/rpc',
    ISSUER_RPC_URLS: '{"1":"https://issuer-a-mainnet.example/rpc"}',
    ISSUER_SIGNING_KEY:
      'env:0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    ISSUER_PRICE_PROVIDER: 'bitfinex',
    ISSUER_POLL_INTERVAL_MS: 0,
    ISSUER_BATCH_SIZE: 25,
    REWARD_CHAIN_ID: 11155111,
    PRICE_TOLERANCE_BPS: 100,
    PRICE_WINDOW_SECONDS: 21600,
    CLAIM_COOLDOWN_HOURS: 24,
    UTL_USD_RATE: '1',
    CASHBACK_BPS: 500,
    TOKEN_ADDRESSES: '{"11155111":{"usdt":"0xabc"}}',
    COUPON_CLAIM_CONTRACT_ADDRESS: '0x5Dfc68FD44CCD83DD10cF5aA4B060AAe1602fb13',
    RPC_URLS: '{"11155111":"https://api-node.example/rpc"}',
    RPC_SHARING_ALLOWED_CHAINS: '[]',
    NODE_ENV: 'development',
    ALLOW_PLAINTEXT_SIGNING_KEY: true,
    SIGNER_KEY_PASSWORD: '',
    ...overrides,
  };
  const configService = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;

  return () => new IssuerConfig(configService as never);
}

describe('IssuerConfig', () => {
  it('accepts an issuer with its own node, key and price provider', () => {
    const config = configWith({})();
    expect(config.id).toBe('issuer-a');
    expect(config.rpcUrlFor(1)).toBe('https://issuer-a-mainnet.example/rpc');
    expect(config.rpcUrlFor(11155111)).toBe('https://issuer-a.example/rpc');
    expect(config.rpcUrlFor(999)).toBeNull();
    expect(config.signer.address).toMatch(/^0x/);
    expect(config.tokenAddress(11155111, 'USDT')).toBe('0xabc');
  });

  it("refuses to share the API's RPC endpoint", () => {
    expect(
      configWith({ ISSUER_RPC_URL: 'https://api-node.example/rpc/' }),
    ).toThrow(RpcEndpointError);
  });

  it('refuses to run without a node of its own', () => {
    expect(configWith({ ISSUER_RPC_URL: '', ISSUER_RPC_URLS: '{}' })).toThrow(
      IssuerConfigError,
    );
  });

  it("refuses to share the API's node on any chain, not just the reward one", () => {
    expect(
      configWith({
        ISSUER_RPC_URLS: '{"1":"https://api-node.example/rpc"}',
      }),
    ).toThrow(RpcEndpointError);
  });

  it('refuses to run without the contract it signs for', () => {
    expect(configWith({ COUPON_CLAIM_CONTRACT_ADDRESS: '' })).toThrow(
      IssuerConfigError,
    );
  });

  it('allows a shared endpoint only on chains explicitly listed — the sharing exception', () => {
    // Tron and Bitcoin have one free public API each. The exception is opt-in
    // and per chain, so the guarantee still holds everywhere it can.
    expect(
      configWith({
        ISSUER_RPC_URLS: '{"4294967297":"https://api.trongrid.io"}',
        RPC_URLS: '{"4294967297":"https://api.trongrid.io"}',
        RPC_SHARING_ALLOWED_CHAINS: '[4294967297]',
      }),
    ).not.toThrow();

    expect(
      configWith({
        ISSUER_RPC_URLS: '{"4294967297":"https://api.trongrid.io"}',
        RPC_URLS: '{"4294967297":"https://api.trongrid.io"}',
        RPC_SHARING_ALLOWED_CHAINS: '[]',
      }),
    ).toThrow(RpcEndpointError);
  });

  it('a second issuer is configuration: a different key gives a different signer', () => {
    const a = configWith({})();
    const b = configWith({
      ISSUER_ID: 'issuer-b',
      ISSUER_RPC_URL: 'https://issuer-b.example/rpc',
      ISSUER_RPC_URLS: '{"1":"https://issuer-b-mainnet.example/rpc"}',
      ISSUER_PRICE_PROVIDER: 'coingecko',
      ISSUER_SIGNING_KEY:
        'env:0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
    })();

    expect(b.signer.address).not.toBe(a.signer.address);
    expect(b.rpcUrlFor(11155111)).not.toBe(a.rpcUrlFor(11155111));
    expect(b.priceProvider).not.toBe(a.priceProvider);
  });
});

/**
 * Module-graph isolation, not just import hygiene: the indexer client and the
 * payment poller must not exist inside the issuer process at all. A transitive
 * import would start a second poller against the shared indexer budget and put
 * the client one `inject()` away from the layer that exists to distrust it.
 */
describe('issuer module graph', () => {
  it('pulls in neither the indexer client nor the payment poller', async () => {
    const { IssuerModule } = await import('@/issuer/issuer.module');

    // Walk the declared `imports` of every module reachable from the issuer.
    const seen = new Set<object>();
    const collect = (mod: object | undefined): void => {
      if (!mod || seen.has(mod)) return;
      seen.add(mod);
      const imports = (Reflect.getMetadata('imports', mod) ?? []) as object[];
      for (const imported of imports) {
        // `forRoot`-style dynamic modules carry their own `module` reference.
        const target = (imported as { module?: object }).module ?? imported;
        collect(target);
      }
    };
    collect(IssuerModule);

    const names = [...seen].map((m) => (m as { name?: string }).name ?? '');
    expect(names).not.toContain('IndexerModule');
    expect(names).not.toContain('PaymentsModule');
  });
});
