import { ConfigService } from '@nestjs/config';

import { RpcEndpointError } from '@/common/chain/rpc-endpoints';
import { MonitorConfig, MonitorConfigError } from '@/monitor/monitor-config';

function configWith(overrides: Record<string, unknown>): () => MonitorConfig {
  const values: Record<string, unknown> = {
    MONITOR_RPC_URL: 'https://monitor.example/rpc',
    MONITOR_RPC_URLS: '{"1":"https://monitor-mainnet.example/rpc"}',
    MONITOR_SIGNING_KEY:
      'env:0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    MONITOR_POLL_INTERVAL_MS: 0,
    MONITOR_SUPPLY_TOLERANCE_BPS: 50,
    MONITOR_SAMPLE_SIZE: 25,
    MONITOR_EPOCH_UTILISATION_PCT: 80,
    MONITOR_MAX_INDEXER_LAG_SECONDS: 900,
    MONITOR_MAX_INDEXER_ERROR_PCT: 10,
    MONITOR_AUTO_PAUSE: false,
    REWARD_CHAIN_ID: 11155111,
    CASHBACK_BPS: 500,
    UTL_USD_RATE: '1',
    TOKEN_ADDRESSES:
      '{"1":{"usdt":"0xdAC17F958D2ee523a2206206994597C13D831ec7"}}',
    COUPON_CLAIM_CONTRACT_ADDRESS: '0x5Dfc68FD44CCD83DD10cF5aA4B060AAe1602fb13',
    UTILITY_TOKEN_CONTRACT_ADDRESS:
      '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    RPC_URLS: '{"11155111":"https://api-node.example/rpc"}',
    ISSUER_RPC_URLS: '{"1":"https://issuer-a.example/rpc"}',
    RELAYER_RPC_URLS: '{"11155111":"https://relayer.example/rpc"}',
    ISSUER_RPC_URL: 'https://issuer-a.example/rpc',
    RELAYER_RPC_URL: 'https://relayer.example/rpc',
    RPC_SHARING_ALLOWED_CHAINS: '[]',
    NODE_ENV: 'development',
    ALLOW_PLAINTEXT_SIGNING_KEY: true,
    SIGNER_KEY_PASSWORD: '',
    ...overrides,
  };
  const configService = { get: (key: string) => values[key] } as ConfigService;

  return () => new MonitorConfig(configService as never);
}

describe('MonitorConfig', () => {
  it('holds the guardian key and its own view of the chains', () => {
    const config = configWith({})();

    expect(config.id).toBe('monitor');
    expect(config.rewardRpcUrl).toBe('https://monitor.example/rpc');
    expect(config.rpcUrlFor(1)).toBe('https://monitor-mainnet.example/rpc');
    expect(config.rpcUrlFor(999)).toBeNull();
    expect(config.signer.address).toMatch(/^0x/);
    expect(config.chains).toEqual(expect.arrayContaining([1, 11155111]));
  });

  it('resolves token addresses case-insensitively', () => {
    const config = configWith({})();

    expect(config.tokenAddress(1, 'USDT')).toBe(
      '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    );
    expect(config.tokenAddress(1, 'xaut')).toBeNull();
    expect(config.tokenAddress(137, 'usdt')).toBeNull();
  });

  it('refuses to start without a node on the reward chain', () => {
    expect(configWith({ MONITOR_RPC_URL: '', MONITOR_RPC_URLS: '{}' })).toThrow(
      MonitorConfigError,
    );
  });

  it.each([
    ['the claim contract', 'COUPON_CLAIM_CONTRACT_ADDRESS'],
    ['the utility token', 'UTILITY_TOKEN_CONTRACT_ADDRESS'],
  ])('refuses to start without the address of %s', (_label, key) => {
    expect(configWith({ [key]: '' })).toThrow(MonitorConfigError);
    expect(configWith({ [key]: 'not-an-address' })).toThrow(MonitorConfigError);
  });

  it.each([
    ["the API's", 'RPC_URLS', '{"11155111":"https://monitor.example/rpc"}'],
    ["an issuer's", 'ISSUER_RPC_URL', 'https://monitor.example/rpc'],
    ["the relayer's", 'RELAYER_RPC_URL', 'https://monitor.example/rpc'],
    [
      "an issuer's per-chain",
      'ISSUER_RPC_URLS',
      '{"1":"https://monitor-mainnet.example/rpc"}',
    ],
    [
      "the relayer's per-chain",
      'RELAYER_RPC_URLS',
      '{"1":"https://monitor-mainnet.example/rpc"}',
    ],
  ])('refuses to share %s endpoint', (_label, key, value) => {
    expect(configWith({ [key]: value })).toThrow(RpcEndpointError);
  });

  it('allows a shared endpoint only on the chains explicitly listed', () => {
    const shared = {
      MONITOR_RPC_URLS: '{"4294967297":"https://api.trongrid.io"}',
      RPC_URLS: '{"4294967297":"https://api.trongrid.io"}',
    };

    expect(
      configWith({ ...shared, RPC_SHARING_ALLOWED_CHAINS: '[4294967297]' }),
    ).not.toThrow();
    expect(configWith({ ...shared, RPC_SHARING_ALLOWED_CHAINS: '[]' })).toThrow(
      RpcEndpointError,
    );
  });
});
