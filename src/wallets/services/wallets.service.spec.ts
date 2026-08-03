import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { privateKeyToAccount } from 'viem/accounts';
import type { FindOperator } from 'typeorm';

import { EChainKind } from '@/chains/chain-kind.enum';
import { Wallet } from '@/wallets/entities/wallet.entity';
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

type Where = {
  userId?: string;
  address?: string | FindOperator<string>;
};

function walletRepo(rows: Partial<Wallet>[] = []) {
  const store: Partial<Wallet>[] = rows.map((row) => ({
    isPrimary: false,
    verified: false,
    createdAt: new Date(),
    ...row,
  }));

  const select = ({ where = {} }: { where?: Where }) => {
    if (where.userId) return store.filter((w) => w.userId === where.userId);
    if (where.address && typeof where.address !== 'string') {
      const wanted = where.address.value as unknown as string[];
      return store.filter((w) => wanted.includes(w.address!));
    }
    if (typeof where.address === 'string') {
      return store.filter((w) => w.address === where.address);
    }
    return store;
  };

  const entityManager = {
    find: jest.fn(async (_entity: unknown, opts: { where?: Where }) =>
      select(opts),
    ),
    findOne: jest.fn(
      async (_entity: unknown, opts: { where?: Where }) =>
        select(opts)[0] ?? null,
    ),
    create: jest.fn((_entity: unknown, data: Partial<Wallet>) => ({ ...data })),
    save: jest.fn(async (fresh: Partial<Wallet>[]) => {
      store.push(...fresh.map((w) => ({ ...w, createdAt: new Date() })));
      return fresh;
    }),
    update: jest.fn(
      async (
        _entity: unknown,
        where: { userId: string; address: string },
        patch: Partial<Wallet>,
      ) => {
        for (const row of store) {
          if (row.userId === where.userId && row.address === where.address) {
            Object.assign(row, patch);
          }
        }
      },
    ),
    delete: jest.fn(async (_entity: unknown, where: { id: string }) => {
      const i = store.findIndex((w) => w.id === where.id);
      if (i >= 0) store.splice(i, 1);
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
    entityManager,
    find: jest.fn(async (opts: { where?: Where }) => select(opts)),
  };
}

async function build(wallets: ReturnType<typeof walletRepo>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      WalletsService,
      { provide: getRepositoryToken(Wallet), useValue: wallets },
    ],
  }).compile();
  return moduleRef.get(WalletsService);
}

const evmEntry = (over: Record<string, unknown> = {}) => ({
  chain: EChainKind.EVM,
  srcChainId: SEPOLIA,
  address: account.address.toLowerCase(),
  path: "m/44'/60'/0'/0/0",
  ...over,
});

describe('WalletsService.linkWallets', () => {
  it('registers the whole set in one call, declared but not yet proven', async () => {
    const wallets = walletRepo();
    const service = await build(wallets);

    const result = await service.linkWallets(USER, {
      wallets: [
        evmEntry(),
        {
          chain: EChainKind.BITCOIN,
          srcChainId: BITCOIN,
          address: BTC_ADDRESS,
        },
      ],
    });

    expect(result.wallets).toHaveLength(2);
    expect(
      result.wallets.find((w) => w.chain === EChainKind.EVM),
    ).toMatchObject({
      address: account.address,
      primary: true,
      verified: false,
    });
  });

  it('refuses a set with no EVM address to be the payout recipient', async () => {
    const wallets = walletRepo();
    const service = await build(wallets);

    await expect(
      service.linkWallets(USER, {
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
    const service = await build(walletRepo());

    await expect(
      service.linkWallets(USER, {
        wallets: [evmEntry({ chain: EChainKind.TRON })],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses two addresses for the same chain', async () => {
    const service = await build(walletRepo());

    await expect(
      service.linkWallets(USER, {
        wallets: [evmEntry(), evmEntry({ address: attacker.address })],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a malformed address', async () => {
    const service = await build(walletRepo());

    await expect(
      service.linkWallets(USER, {
        wallets: [evmEntry({ address: 'nonsense' })],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('is idempotent when the same user re-posts the set they already have', async () => {
    const wallets = walletRepo([
      {
        userId: USER,
        chain: EChainKind.EVM,
        srcChainId: SEPOLIA,
        address: account.address,
        isPrimary: true,
      },
    ]);
    const service = await build(wallets);

    const result = await service.linkWallets(USER, { wallets: [evmEntry()] });

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
    const service = await build(wallets);

    await expect(
      service.linkWallets(USER, { wallets: [evmEntry()] }),
    ).rejects.toThrow(ConflictException);
  });

  it('409s when the address is held by someone else', async () => {
    const wallets = walletRepo([
      {
        userId: OTHER_USER,
        chain: EChainKind.EVM,
        srcChainId: SEPOLIA,
        address: account.address,
        isPrimary: true,
      },
    ]);
    const service = await build(wallets);

    await expect(
      service.linkWallets(USER, { wallets: [evmEntry()] }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('WalletsService.confirmOwnership', () => {
  it('marks the address verified once a claim-time signature proved it', async () => {
    const wallets = walletRepo([
      {
        id: 'w-1',
        userId: USER,
        chain: EChainKind.EVM,
        address: account.address,
        isPrimary: true,
      },
    ]);
    const service = await build(wallets);

    await service.confirmOwnership(
      wallets.entityManager as never,
      USER,
      account.address,
    );

    expect(wallets._store[0]).toMatchObject({ verified: true });
    expect(wallets._store[0].verifiedAt).toBeInstanceOf(Date);
  });

  it('takes the address from someone who declared it without being able to sign', async () => {
    const wallets = walletRepo([
      {
        id: 'squatter',
        userId: OTHER_USER,
        chain: EChainKind.EVM,
        address: account.address,
        verified: false,
      },
    ]);
    const service = await build(wallets);
    const logged: string[] = [];
    jest
      .spyOn(service['logger'], 'error')
      .mockImplementation((msg) => logged.push(String(msg)));

    await service.confirmOwnership(
      wallets.entityManager as never,
      USER,
      account.address,
    );

    // A declaration must never outrank a signature.
    expect(wallets._store.find((w) => w.userId === OTHER_USER)).toBeUndefined();
    expect(logged.join()).toContain('security_event=wallet.address_reassigned');
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
    const service = await build(wallets);

    const mine = await service.listWallets(USER);
    expect(mine).toHaveLength(1);
    expect(mine[0].address).toBe(account.address);
  });
});
