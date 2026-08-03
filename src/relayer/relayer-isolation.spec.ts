import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { RpcEndpointError } from '@/common/chain/rpc-endpoints';
import { RelayerConfig, RelayerConfigError } from '@/relayer/relayer-config';

const RELAYER_DIR = resolve(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('relayer isolation', () => {
  it('never writes an attestation — it reads signatures, it does not make them', () => {
    const writes =
      /attestations\.(insert|save|update|delete|upsert)|AttestationEntity[^;]*\.(insert|save)/;
    const offenders = sourceFiles(RELAYER_DIR).filter((path) =>
      writes.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('never reaches the Indexer API', () => {
    const forbidden =
      /from ['"]@\/indexer|IndexerService|INDEXER_BASE_URL|INDEXER_API_KEY/;
    const offenders = sourceFiles(RELAYER_DIR).filter((path) =>
      forbidden.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('has no controllers — nothing can call in', () => {
    const offenders = sourceFiles(RELAYER_DIR).filter((path) =>
      /@Controller|@Get\(|@Post\(/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

function configWith(overrides: Record<string, unknown>): () => RelayerConfig {
  const values: Record<string, unknown> = {
    RELAYER_ID: 'relayer',
    RELAYER_RPC_URL: 'https://relayer.example/rpc',
    RELAYER_RPC_URLS: '{"1":"https://relayer-mainnet.example/rpc"}',
    ISSUER_RPC_URLS: '{"1":"https://issuer-a-mainnet.example/rpc"}',
    RELAYER_SIGNING_KEY:
      'env:0x315cf32c3a740f31ce5aa397162fc257ca0777cd2b4c6e9ba3d5c0fbd42dbe32',
    RELAYER_POLL_INTERVAL_MS: 0,
    RELAYER_BATCH_SIZE: 10,
    RELAYER_CONFIRMATIONS: 2,
    RELAYER_DEADLINE_MARGIN_SECONDS: 120,
    RELAYER_MAX_FEE_GWEI: 100,
    REWARD_CHAIN_ID: 11155111,
    COUPON_CLAIM_CONTRACT_ADDRESS: '0x5Dfc68FD44CCD83DD10cF5aA4B060AAe1602fb13',
    TOKEN_ADDRESSES: '{"11155111":{"usdt":"0xabc"}}',
    RPC_URLS: '{"11155111":"https://api-node.example/rpc"}',
    RPC_SHARING_ALLOWED_CHAINS: '[]',
    ISSUER_RPC_URL: 'https://issuer-a.example/rpc',
    SIGNER_KEY_PASSWORD: '',
    NODE_ENV: 'development',
    ...overrides,
  };
  const configService = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;

  return () => new RelayerConfig(configService as never);
}

describe('RelayerConfig', () => {
  it('starts with its own endpoint, key and contract', () => {
    const config = configWith({})();
    expect(config.signer.address).toBe(
      '0x95FA3C48A38077e20b47c8Ef426597a7e1F112ab',
    );
    expect(config.maxFeeWei).toBe(100n * 10n ** 9n);
  });

  it("refuses to share the API's node", () => {
    expect(
      configWith({ RELAYER_RPC_URL: 'https://api-node.example/rpc' }),
    ).toThrow(RpcEndpointError);
  });

  it("refuses to share an issuer's node — that would be one verifier, not two", () => {
    expect(
      configWith({ RELAYER_RPC_URL: 'https://issuer-a.example/rpc/' }),
    ).toThrow(RpcEndpointError);
  });

  it("refuses to share an issuer's payment-chain node either", () => {
    expect(
      configWith({
        RELAYER_RPC_URLS: '{"1":"https://issuer-a-mainnet.example/rpc"}',
      }),
    ).toThrow(RpcEndpointError);
  });

  it('refuses to run without a reward-chain node or without the contract', () => {
    expect(configWith({ RELAYER_RPC_URL: '' })).toThrow(RelayerConfigError);
    expect(configWith({ COUPON_CLAIM_CONTRACT_ADDRESS: '' })).toThrow(
      RelayerConfigError,
    );
  });

  it('knows which node answers about which chain', () => {
    const config = configWith({})();
    expect(config.rpcUrlFor(1)).toBe('https://relayer-mainnet.example/rpc');
    expect(config.rewardRpcUrl).toBe('https://relayer.example/rpc');
    expect(config.rpcUrlFor(999)).toBeNull();
  });
});
