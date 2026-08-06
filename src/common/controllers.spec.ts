import { ConfigService } from '@nestjs/config';

import { AuthController } from '@/auth/controllers/auth.controller';
import { BalancesController } from '@/balances/controllers/balances.controller';
import { ClaimsController } from '@/claims/controllers/claims.controller';
import { ConfigController } from '@/config/controllers/config.controller';
import { CouponsController } from '@/coupons/controllers/coupons.controller';
import { HealthController } from '@/health/health.controller';
import { HealthService } from '@/health/services/health.service';
import { IndexerController } from '@/indexer/controllers/indexer.controller';
import { SecretsController } from '@/secrets/controllers/secrets.controller';
import { TransactionsController } from '@/transactions/controllers/transactions.controller';
import { UsersController } from '@/users/controllers/users.controller';
import { WalletsController } from '@/wallets/controllers/wallets.controller';

const USER = { userId: 'user-1', sub: 'dev|local-1', email: 'dev@example.com' };
const returns = <T>(value: T) => jest.fn(async () => value);

describe('AuthController', () => {
  const service = {
    googleLogin: returns({ accessToken: 'a', refreshToken: 'r' }),
    refreshTokens: returns({ accessToken: 'a2', refreshToken: 'r2' }),
    generateDevTestToken: returns({ accessToken: 'dev', refreshToken: 'dev' }),
  };
  const controller = new AuthController(service as never);

  it('exchanges a Google id token for our own pair', async () => {
    await expect(
      controller.googleLogin({ idToken: 'google-token', type: 'ios' } as never),
    ).resolves.toMatchObject({ accessToken: 'a' });
    expect(service.googleLogin).toHaveBeenCalledWith('google-token', 'ios');
  });

  it('rotates a refresh token', async () => {
    await controller.refresh({ refreshToken: 'r' } as never);
    expect(service.refreshTokens).toHaveBeenCalledWith('r');
  });

  it('issues a development token', async () => {
    await expect(controller.testToken()).resolves.toMatchObject({
      accessToken: 'dev',
    });
  });
});

describe('UsersController', () => {
  const build = (wallets: unknown[]) =>
    new UsersController(
      {
        findById: returns({
          id: 'user-1',
          email: 'dev@example.com',
          firstName: 'Dev',
          lastName: 'User',
        }),
      } as never,
      { listWallets: returns(wallets) } as never,
      {
        status: returns({ entropy: true, seed: false, updatedAt: null }),
      } as never,
    );

  it('reports the profile, the primary wallet and which blobs exist', async () => {
    const controller = build([
      { chain: 'EVM', address: '0xabc', primary: true },
      { chain: 'BITCOIN', address: 'bc1q', primary: false },
    ]);

    await expect(controller.me(USER as never)).resolves.toEqual({
      user: {
        id: 'user-1',
        email: 'dev@example.com',
        firstName: 'Dev',
        lastName: 'User',
      },
      wallets: {
        linked: true,
        primaryAddress: '0xabc',
        chains: ['EVM', 'BITCOIN'],
      },
      secrets: { entropy: true, seed: false, updatedAt: null },
    });
  });

  it('reports an unlinked user without inventing a primary address', async () => {
    const controller = build([]);

    await expect(controller.me(USER as never)).resolves.toMatchObject({
      wallets: { linked: false, primaryAddress: null, chains: [] },
    });
  });
});

describe('WalletsController', () => {
  const service = {
    linkWallets: returns({ linked: 1 }),
    listWallets: returns([]),
  };
  const controller = new WalletsController(service as never);

  it('links addresses for the caller, never for an id in the body', async () => {
    const dto = { wallets: [] } as never;

    await controller.link(USER as never, dto);

    expect(service.linkWallets).toHaveBeenCalledWith('user-1', dto);
  });

  it('lists only the caller’s wallets', async () => {
    await controller.list(USER as never);

    expect(service.listWallets).toHaveBeenCalledWith('user-1');
  });
});

describe('CouponsController', () => {
  const service = {
    list: returns({ items: [] }),
    findByCode: returns({ id: 'cpn-1' }),
    findById: returns({ id: 'cpn-1' }),
  };
  const controller = new CouponsController(service as never);

  it('passes the query through to the service', async () => {
    await controller.list(USER as never, { limit: 5 } as never);
    expect(service.list).toHaveBeenCalledWith('user-1', { limit: 5 });
  });

  it('resolves a coupon by code and by id, scoped to the caller', async () => {
    await controller.findByCode(USER as never, 'CB-8F3A21');
    expect(service.findByCode).toHaveBeenCalledWith('user-1', 'CB-8F3A21');

    await controller.findById(USER as never, 'cpn-1');
    expect(service.findById).toHaveBeenCalledWith('user-1', 'cpn-1');
  });
});

describe('ClaimsController', () => {
  const service = {
    create: returns({ claimId: 'clm-1' }),
    list: returns({ items: [] }),
    preview: returns({ claimable: [] }),
    createChallenge: returns({ challengeId: 'chl-1' }),
    findById: returns({ claimId: 'clm-1' }),
  };
  const controller = new ClaimsController(service as never);

  it('forwards the Idempotency-Key header', async () => {
    const dto = { challengeId: 'chl-1', signature: '0x00' } as never;

    await controller.create(USER as never, dto, 'idem-1');

    expect(service.create).toHaveBeenCalledWith('user-1', dto, 'idem-1');
  });

  it('accepts a claim without the header and lets the service refuse it', async () => {
    await controller.create(USER as never, {} as never, undefined);

    expect(service.create).toHaveBeenCalledWith('user-1', {}, undefined);
  });

  it('serves the challenge, the preview, the list and one claim', async () => {
    await controller.challenge(USER as never, 'CB-1');
    expect(service.createChallenge).toHaveBeenCalledWith('user-1', 'CB-1');

    // A challenge with no coupon named still has to produce a message.
    await controller.challenge(USER as never, undefined as never);
    expect(service.createChallenge).toHaveBeenLastCalledWith('user-1', '');

    await controller.preview(USER as never);
    expect(service.preview).toHaveBeenCalledWith('user-1');

    await controller.list(USER as never, {} as never);
    expect(service.list).toHaveBeenCalledWith('user-1', {});

    await controller.findById(USER as never, 'clm-1');
    expect(service.findById).toHaveBeenCalledWith('user-1', 'clm-1');
  });
});

describe('SecretsController', () => {
  const service = {
    store: returns(undefined),
    list: returns([{ entropy: 'cipher' }]),
  };
  const controller = new SecretsController(service as never);

  it('routes each blob to its own kind', async () => {
    const dto = { entropy: 'cipher', metadata: { v: 1 } } as never;

    await controller.storeEntropy(USER as never, dto);
    expect(service.store).toHaveBeenCalledWith('user-1', 'entropy', dto);

    await controller.storeSeed(USER as never, dto);
    expect(service.store).toHaveBeenCalledWith('user-1', 'seed', dto);
  });

  it('wraps each read in its list key', async () => {
    await expect(controller.getEntropy(USER as never)).resolves.toEqual({
      entropies: [{ entropy: 'cipher' }],
    });
    expect(service.list).toHaveBeenCalledWith('user-1', 'entropy');

    await expect(controller.getSeed(USER as never)).resolves.toEqual({
      seeds: [{ entropy: 'cipher' }],
    });
    expect(service.list).toHaveBeenCalledWith('user-1', 'seed');
  });
});

describe('BalancesController', () => {
  it('serves the caller’s cached balances', async () => {
    const service = { list: returns({ items: [], ttlSeconds: 60 }) };
    const controller = new BalancesController(service as never);

    await expect(controller.list(USER as never)).resolves.toMatchObject({
      ttlSeconds: 60,
    });
    expect(service.list).toHaveBeenCalledWith('user-1');
  });
});

describe('TransactionsController', () => {
  const service = {
    list: returns({ items: [] }),
    findById: returns({ id: 'tx-1' }),
    record: returns({ item: { id: 'tx-1' }, created: true }),
  };
  const controller = new TransactionsController(service as never);
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('answers 201 for a transaction it created', async () => {
    const item = await controller.record(
      USER as never,
      {} as never,
      response as never,
      'idem-1',
    );

    expect(service.record).toHaveBeenCalledWith('user-1', {}, 'idem-1');
    expect(response.status).toHaveBeenCalledWith(201);
    // Passthrough mode: the status is set on the response, the body is returned.
    expect(item).toEqual({ id: 'tx-1' });
  });

  it('answers 200 when the row already existed', async () => {
    service.record.mockResolvedValueOnce({
      item: { id: 'tx-1' },
      created: false,
    } as never);

    await controller.record(
      USER as never,
      {} as never,
      response as never,
      'idem-1',
    );

    // A replayed Idempotency-Key is not a second creation.
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('lists and reads scoped to the caller', async () => {
    await controller.list(USER as never, {} as never);
    expect(service.list).toHaveBeenCalledWith('user-1', {});

    await controller.findById(USER as never, 'tx-1');
    expect(service.findById).toHaveBeenCalledWith('user-1', 'tx-1');
  });
});

describe('IndexerController', () => {
  const service = {
    tokenTransfers: returns({ transfers: [] }),
    tokenBalance: returns({ tokenBalance: { amount: '1' } }),
  };
  const controller = new IndexerController(service as never);

  it('parses the numeric query parameters before passing them on', async () => {
    await controller.getTokenTransfers('sepolia', 'usdt', '0xabc', {
      limit: '25',
      fromTs: '1780272000000',
      toTs: '1780273000000',
    } as never);

    expect(service.tokenTransfers).toHaveBeenCalledWith({
      blockchain: 'sepolia',
      token: 'usdt',
      address: '0xabc',
      limit: 25,
      fromTs: 1780272000000,
      toTs: 1780273000000,
    });
  });

  it('leaves the optional window undefined when it was not asked for', async () => {
    await controller.getTokenTransfers('tron', 'usdt', 'TR7', {
      limit: '10',
    } as never);

    expect(service.tokenTransfers).toHaveBeenCalledWith(
      expect.objectContaining({ fromTs: undefined, toTs: undefined }),
    );
  });

  it('passes a balance lookup straight through', async () => {
    await controller.getTokenBalance('bitcoin', 'btc', 'bc1q');

    expect(service.tokenBalance).toHaveBeenCalledWith({
      blockchain: 'bitcoin',
      token: 'btc',
      address: 'bc1q',
    });
  });
});

describe('ConfigController', () => {
  it('publishes the values a client must not hardcode', () => {
    const values: Record<string, unknown> = {
      UTL_USD_RATE: '1',
      CASHBACK_BPS: 500,
      CONFIRMATION_DEPTHS: '{"1":12,"11155111":3}',
    };
    const controller = new ConfigController({
      get: (key: string) => values[key],
    } as ConfigService<never, true>);

    expect(controller.get()).toEqual({
      utlUsdRate: '1',
      cashbackBps: 500,
      cashbackRate: 0.05,
      confirmationDepths: { 1: 12, 11155111: 3 },
      pageSize: 10,
    });
  });
});

describe('HealthController', () => {
  it('reports the database and the indexer breaker', async () => {
    const service = new HealthService(
      { isInitialized: true } as never,
      { getBreakerState: () => 'closed' } as never,
    );

    await expect(
      new HealthController(service).getHealth(),
    ).resolves.toMatchObject({
      status: 'ok',
      database: 'connected',
      indexer: { breaker: 'closed' },
    });
  });

  it('reports an error while the database is down', async () => {
    const service = new HealthService(
      { isInitialized: false } as never,
      { getBreakerState: () => 'open' } as never,
    );

    await expect(
      new HealthController(service).getHealth(),
    ).resolves.toMatchObject({
      status: 'error',
      database: 'disconnected',
      indexer: { breaker: 'open' },
    });
  });
});
