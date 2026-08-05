import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';

import { ConfirmationPolicy } from '@/payments/confirmation-policy';

const ETHEREUM = 1;
const TRON = 4_294_967_297;
const BITCOIN = 4_294_967_298;
const SPARK = 4_294_967_299;

const getBlockNumber = jest.fn(async () => 21_000_000n);

jest.mock('viem', () => ({
  ...jest.requireActual('viem'),
  createPublicClient: jest.fn(() => ({ getBlockNumber })),
  http: jest.fn(() => 'transport'),
}));

const DEPTHS = JSON.stringify({
  [ETHEREUM]: 12,
  [TRON]: 19,
  [BITCOIN]: 3,
  [SPARK]: 1,
});

async function build(
  options: {
    rpcUrls?: Record<string, string>;
    http?: Partial<HttpService> | null;
  } = {},
) {
  const rpcUrls = options.rpcUrls ?? {
    [ETHEREUM]: 'https://eth.invalid/rpc',
    [TRON]: 'https://tron.invalid/',
    [BITCOIN]: 'https://btc.invalid',
    [SPARK]: 'https://spark.invalid',
  };

  const providers: Parameters<typeof Test.createTestingModule>[0]['providers'] =
    [
      ConfirmationPolicy,
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) =>
            key === 'CONFIRMATION_DEPTHS' ? DEPTHS : JSON.stringify(rpcUrls),
          ),
        },
      },
    ];

  if (options.http !== null) {
    providers.push({
      provide: HttpService,
      useValue: options.http ?? {
        get: jest.fn(() => of({ data: 850_000 })),
        post: jest.fn(() =>
          of({ data: { block_header: { raw_data: { number: 60_000_000 } } } }),
        ),
      },
    });
  }

  const moduleRef = await Test.createTestingModule({ providers }).compile();
  return moduleRef.get(ConfirmationPolicy);
}

beforeEach(() => {
  getBlockNumber.mockClear();
  getBlockNumber.mockResolvedValue(21_000_000n);
});

describe('ConfirmationPolicy.depthFor', () => {
  it('returns the configured depth', async () => {
    const policy = await build();

    expect(policy.depthFor(ETHEREUM)).toBe(12);
  });

  it('refuses a chain with no configured depth', async () => {
    const policy = await build();

    expect(() => policy.depthFor(137)).toThrow(
      'No confirmation depth configured for 137',
    );
  });
});

describe('ConfirmationPolicy.confirmations', () => {
  it('counts the payment block itself as the first confirmation', async () => {
    const policy = await build();

    await expect(policy.confirmations(ETHEREUM, 21_000_000)).resolves.toBe(1);
    await expect(policy.confirmations(ETHEREUM, 20_999_989)).resolves.toBe(12);
  });

  it('never goes negative for a block ahead of the head', async () => {
    const policy = await build();

    await expect(policy.confirmations(ETHEREUM, 21_000_005)).resolves.toBe(0);
  });

  it('caches the head for ten seconds', async () => {
    const policy = await build();

    await policy.confirmations(ETHEREUM, 1);
    await policy.confirmations(ETHEREUM, 2);

    expect(getBlockNumber).toHaveBeenCalledTimes(1);
  });

  it('returns null when the node cannot be reached', async () => {
    getBlockNumber.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const policy = await build();

    await expect(policy.confirmations(ETHEREUM, 1)).resolves.toBeNull();
  });

  it('returns null for a chain with no RPC endpoint', async () => {
    const policy = await build({ rpcUrls: {} });

    await expect(policy.confirmations(ETHEREUM, 1)).resolves.toBeNull();
  });

  it('reads the Tron head from its own endpoint', async () => {
    const post = jest.fn(() =>
      of({ data: { block_header: { raw_data: { number: 60_000_000 } } } }),
    );
    const policy = await build({ http: { post } as never });

    await expect(policy.confirmations(TRON, 59_999_999)).resolves.toBe(2);
    expect(post).toHaveBeenCalledWith(
      'https://tron.invalid/wallet/getnowblock',
      {},
      { timeout: 15_000 },
    );
  });

  it('returns null when Tron answers without a block number', async () => {
    const policy = await build({
      http: { post: jest.fn(() => of({ data: {} })) } as never,
    });

    await expect(policy.confirmations(TRON, 1)).resolves.toBeNull();
  });

  it('reads the Bitcoin tip height', async () => {
    const policy = await build();

    await expect(policy.confirmations(BITCOIN, 849_998)).resolves.toBe(3);
  });

  it('returns null for a nonsense Bitcoin tip', async () => {
    const policy = await build({
      http: { get: jest.fn(() => of({ data: 'not-a-height' })) } as never,
    });

    await expect(policy.confirmations(BITCOIN, 1)).resolves.toBeNull();
  });

  it('returns null for non-EVM chains when no HTTP client is wired', async () => {
    const policy = await build({ http: null });

    await expect(policy.confirmations(TRON, 1)).resolves.toBeNull();
    await expect(policy.confirmations(BITCOIN, 1)).resolves.toBeNull();
  });

  it('returns null for a chain family with no head source', async () => {
    const policy = await build();

    await expect(policy.confirmations(SPARK, 1)).resolves.toBeNull();
  });
});

describe('ConfirmationPolicy.isConfirmed', () => {
  it('is true only once the payment is at least as deep as the policy', async () => {
    const policy = await build();

    await expect(policy.isConfirmed(ETHEREUM, 20_999_989)).resolves.toBe(true);
    await expect(policy.isConfirmed(ETHEREUM, 20_999_990)).resolves.toBe(false);
  });

  it('is false when the head is unknown, so a payment stays pending', async () => {
    const policy = await build({ rpcUrls: {} });

    await expect(policy.isConfirmed(ETHEREUM, 1)).resolves.toBe(false);
  });
});
