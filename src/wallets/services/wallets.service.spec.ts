import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { privateKeyToAccount } from 'viem/accounts';
import type { FindOperator } from 'typeorm';

import { EChainKind } from '@/chains/chain-kind.enum';
import { ownershipMessage } from '@/wallets/address';
import { Wallet } from '@/wallets/entities/wallet.entity';
import { WalletChallenge } from '@/wallets/entities/wallet-challenge.entity';
import { WalletsService } from '@/wallets/services/wallets.service';

const USER = 'user-1';
const OTHER_USER = 'user-2';
const SEPOLIA = 11155111;
const BITCOIN = 4294967298;
const BTC_ADDRESS = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

const account = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const attacker = privateKeyToAccount(
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
);

function challengeRepo(
  challenges: Record<string, { userId: string; nonce: string }>,
) {
  const spent = new Set<string>();
  const execute = jest.fn();
  const builder = {
    update: () => builder,
    set: () => builder,
    where: (_sql: string, p: { challengeId: string }) => {
      builder._id = p.challengeId;
      return builder;
    },
    andWhere: (_sql: string, p?: { userId: string }) => {
      if (p?.userId) builder._userId = p.userId;
      return builder;
    },
    returning: () => builder,
    execute,
    _id: '',
    _userId: '',
  };

  execute.mockImplementation(async () => {
    const row = challenges[builder._id];
    if (!row || row.userId !== builder._userId || spent.has(builder._id)) {
      return { raw: [] };
    }
    spent.add(builder._id);
    return { raw: [{ nonce: row.nonce }] };
  });

  return {
    delete: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: () => builder,
  };
}

type Where = {
  userId?: string;
  address?: string | FindOperator<string>;
};

function walletRepo(rows: Partial<Wallet>[] = []) {
  const store: Partial<Wallet>[] = rows.map((row) => ({
    isPrimary: false,
    verified: true,
    createdAt: new Date(),
    ...row,
  }));

  const select = ({ where = {} }: { where?: Where }) => {
    if (where.userId) return store.filter((w) => w.userId === where.userId);
    if (where.address && typeof where.address !== 'string') {
      const wanted = where.address.value as unknown as string[];
      return store.filter((w) => wanted.includes(w.address!));
    }
    return store;
  };

  const entityManager = {
    find: jest.fn(async (_entity: unknown, opts: { where?: Where }) =>
      select(opts),
    ),
    create: jest.fn((_entity: unknown, data: Partial<Wallet>) => ({ ...data })),
    save: jest.fn(async (fresh: Partial<Wallet>[]) => {
      store.push(...fresh.map((w) => ({ ...w, createdAt: new Date() })));
      return fresh;
    }),
  };

  const manager = {
    ...entityManager,
    transaction: jest.fn((cb: (em: unknown) => Promise<unknown>) =>
      cb(entityManager),
    ),
  };

  return {
    _store: store,
    manager,
    find: jest.fn(async (opts: { where?: Where }) => select(opts)),
  };
}

async function build(
  wallets: ReturnType<typeof walletRepo>,
  challenges: ReturnType<typeof challengeRepo>,
) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      WalletsService,
      { provide: getRepositoryToken(Wallet), useValue: wallets },
      { provide: getRepositoryToken(WalletChallenge), useValue: challenges },
    ],
  }).compile();
  return moduleRef.get(WalletsService);
}

describe('WalletsService.linkWallets', () => {
  const nonce = '0x' + '11'.repeat(32);
  const message = ownershipMessage(nonce);
  let signature: string;

  beforeAll(async () => {
    signature = await account.signMessage({ message });
  });

  const challenges = () => challengeRepo({ 'chl-1': { userId: USER, nonce } });

  const evmEntry = (over: Record<string, unknown> = {}) => ({
    chain: EChainKind.EVM,
    srcChainId: SEPOLIA,
    address: account.address.toLowerCase(),
    path: "m/44'/60'/0'/0/0",
    signature,
    ...over,
  });

  it('registers the whole set in one call and checksums what it stores', async () => {
    const wallets = walletRepo();
    const service = await build(wallets, challenges());

    const result = await service.linkWallets(USER, {
      challengeId: 'chl-1',
      wallets: [evmEntry()],
    });

    expect(result.wallets).toEqual([
      expect.objectContaining({
        chain: EChainKind.EVM,
        address: account.address,
        primary: true,
        verified: true,
      }),
    ]);
  });

  it('stores an address it cannot verify as unverified rather than refusing it', async () => {
    const wallets = walletRepo();
    const service = await build(wallets, challenges());

    const result = await service.linkWallets(USER, {
      challengeId: 'chl-1',
      wallets: [
        evmEntry(),
        {
          chain: EChainKind.BITCOIN,
          srcChainId: BITCOIN,
          address: BTC_ADDRESS,
        },
      ],
    });

    const btc = result.wallets.find((w) => w.chain === EChainKind.BITCOIN);
    expect(btc).toMatchObject({ verified: false, primary: false });
    // ...and it never becomes the payout recipient.
    expect(result.wallets.filter((w) => w.primary)).toHaveLength(1);
  });

  it('refuses a set with no EVM address to be the payout recipient', async () => {
    const wallets = walletRepo();
    const service = await build(wallets, challenges());

    await expect(
      service.linkWallets(USER, {
        challengeId: 'chl-1',
        wallets: [
          {
            chain: EChainKind.BITCOIN,
            srcChainId: BITCOIN,
            address: BTC_ADDRESS,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(wallets._store).toHaveLength(0);
  });

  it('refuses an entry whose chain does not match its srcChainId', async () => {
    const service = await build(walletRepo(), challenges());

    await expect(
      service.linkWallets(USER, {
        challengeId: 'chl-1',
        wallets: [evmEntry({ chain: EChainKind.TRON })],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses two addresses for the same chain', async () => {
    const service = await build(walletRepo(), challenges());

    await expect(
      service.linkWallets(USER, {
        challengeId: 'chl-1',
        wallets: [evmEntry(), evmEntry({ address: attacker.address })],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires a signature on a chain that can produce one', async () => {
    const wallets = walletRepo();
    const service = await build(wallets, challenges());

    await expect(
      service.linkWallets(USER, {
        challengeId: 'chl-1',
        wallets: [evmEntry({ signature: undefined })],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(wallets._store).toHaveLength(0);
  });

  it('rejects a foreign signature and burns the challenge anyway', async () => {
    const wallets = walletRepo();
    const service = await build(wallets, challenges());
    const foreign = await attacker.signMessage({ message });

    await expect(
      service.linkWallets(USER, {
        challengeId: 'chl-1',
        wallets: [evmEntry({ signature: foreign })],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(wallets._store).toHaveLength(0);

    // Same nonce is not available for a second attempt.
    await expect(
      service.linkWallets(USER, {
        challengeId: 'chl-1',
        wallets: [evmEntry()],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a replay of a spent challenge', async () => {
    const service = await build(walletRepo(), challenges());
    const req = { challengeId: 'chl-1', wallets: [evmEntry()] };

    await service.linkWallets(USER, req);
    await expect(service.linkWallets(USER, req)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects another user's challenge id", async () => {
    const service = await build(walletRepo(), challenges());

    await expect(
      service.linkWallets(OTHER_USER, {
        challengeId: 'chl-1',
        wallets: [evmEntry()],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('is a no-op when the same user re-posts the set they already own', async () => {
    const wallets = walletRepo([
      {
        userId: USER,
        chain: EChainKind.EVM,
        srcChainId: SEPOLIA,
        address: account.address,
        isPrimary: true,
      },
    ]);
    const service = await build(wallets, challenges());

    const result = await service.linkWallets(USER, {
      challengeId: 'chl-1',
      wallets: [evmEntry()],
    });

    expect(result.wallets).toHaveLength(1);
    expect(wallets._store).toHaveLength(1);
  });

  it('409s on a different address for a chain the user already registered', async () => {
    const wallets = walletRepo([
      {
        userId: USER,
        chain: EChainKind.EVM,
        srcChainId: SEPOLIA,
        address: attacker.address,
        isPrimary: true,
      },
    ]);
    const service = await build(wallets, challenges());

    await expect(
      service.linkWallets(USER, {
        challengeId: 'chl-1',
        wallets: [evmEntry()],
      }),
    ).rejects.toThrow(ConflictException);
    expect(wallets._store).toHaveLength(1);
  });

  it('logs a security event and 409s when the address belongs to someone else', async () => {
    const wallets = walletRepo([
      {
        userId: OTHER_USER,
        chain: EChainKind.EVM,
        srcChainId: SEPOLIA,
        address: account.address,
        isPrimary: true,
      },
    ]);
    const service = await build(wallets, challenges());
    const logged: string[] = [];
    jest
      .spyOn(service['logger'], 'error')
      .mockImplementation((msg) => logged.push(String(msg)));

    await expect(
      service.linkWallets(USER, {
        challengeId: 'chl-1',
        wallets: [evmEntry()],
      }),
    ).rejects.toThrow(ConflictException);

    expect(logged.join()).toContain(
      'security_event=wallet.address_already_linked',
    );
    expect(logged.join()).toContain(OTHER_USER);
  });
});

describe('WalletsService.listWallets', () => {
  it('returns the caller mappings only', async () => {
    const wallets = walletRepo([
      {
        userId: USER,
        chain: EChainKind.EVM,
        srcChainId: SEPOLIA,
        address: account.address,
        isPrimary: true,
      },
      {
        userId: OTHER_USER,
        chain: EChainKind.EVM,
        srcChainId: SEPOLIA,
        address: attacker.address,
        isPrimary: true,
      },
    ]);
    const service = await build(wallets, challengeRepo({}));

    const mine = await service.listWallets(USER);
    expect(mine).toHaveLength(1);
    expect(mine[0].address).toBe(account.address);
  });
});
