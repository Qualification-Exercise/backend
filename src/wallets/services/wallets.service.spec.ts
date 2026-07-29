import {
  BadRequestException,
  ConflictException,
  NotImplementedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { privateKeyToAccount } from 'viem/accounts';

import { ownershipMessage } from '@/wallets/address';
import { Wallet } from '@/wallets/entities/wallet.entity';
import { WalletChallenge } from '@/wallets/entities/wallet-challenge.entity';
import { WalletsService } from '@/wallets/services/wallets.service';

const USER = 'user-1';
const OTHER_USER = 'user-2';

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

function walletRepo(rows: Partial<Wallet>[] = []) {
  const store = [...rows];
  return {
    _store: store,
    find: jest.fn(async ({ where }: { where: { userId: string } }) =>
      store.filter((w) => w.userId === where.userId),
    ),
    findOne: jest.fn(async ({ where }: { where: { address: string } }) =>
      store.find((w) => w.address === where.address),
    ),
    insert: jest.fn(async (w: Partial<Wallet>) => {
      if (store.some((existing) => existing.address === w.address)) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      store.push({ ...w, createdAt: new Date() });
    }),
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

describe('WalletsService.linkWallet', () => {
  const nonce = '0x' + '11'.repeat(32);
  const message = ownershipMessage(nonce);
  let signature: string;

  beforeAll(async () => {
    signature = await account.signMessage({ message });
  });

  const challenges = () => challengeRepo({ 'chl-1': { userId: USER, nonce } });

  it('stores the mapping when the proof checks out', async () => {
    const wallets = walletRepo();
    const service = await build(wallets, challenges());

    await expect(
      service.linkWallet(USER, {
        address: account.address.toLowerCase(),
        challengeId: 'chl-1',
        signature,
      }),
    ).resolves.toEqual({ address: account.address, linked: true });

    // Stored checksummed, not as the client sent it.
    expect(wallets._store[0]).toMatchObject({
      userId: USER,
      address: account.address,
      chainFamily: 'EVM',
    });
  });

  it('rejects a replay of a spent challenge', async () => {
    const wallets = walletRepo();
    const service = await build(wallets, challenges());
    const req = {
      address: account.address,
      challengeId: 'chl-1',
      signature,
    };

    await service.linkWallet(USER, req);
    await expect(service.linkWallet(USER, req)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects another user's challenge id", async () => {
    const service = await build(walletRepo(), challenges());
    await expect(
      service.linkWallet(OTHER_USER, {
        address: account.address,
        challengeId: 'chl-1',
        signature,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a foreign signature and burns the challenge anyway', async () => {
    const wallets = walletRepo();
    const service = await build(wallets, challenges());
    const foreign = await attacker.signMessage({ message });

    await expect(
      service.linkWallet(USER, {
        address: account.address,
        challengeId: 'chl-1',
        signature: foreign,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(wallets._store).toHaveLength(0);

    // Same nonce is not available for a second attempt.
    await expect(
      service.linkWallet(USER, {
        address: account.address,
        challengeId: 'chl-1',
        signature,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a malformed address before spending the challenge', async () => {
    const service = await build(walletRepo(), challenges());
    await expect(
      service.linkWallet(USER, {
        address: 'nonsense',
        challengeId: 'chl-1',
        signature,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses an unproven Bitcoin address instead of storing it', async () => {
    const wallets = walletRepo();
    const service = await build(wallets, challenges());
    await expect(
      service.linkWallet(USER, {
        address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
        challengeId: 'chl-1',
        signature,
      }),
    ).rejects.toThrow(NotImplementedException);
    expect(wallets._store).toHaveLength(0);
  });

  it('is a no-op when the same user re-links the address they already own', async () => {
    const wallets = walletRepo([{ userId: USER, address: account.address }]);
    const service = await build(wallets, challenges());

    await expect(
      service.linkWallet(USER, {
        address: account.address,
        challengeId: 'chl-1',
        signature,
      }),
    ).resolves.toEqual({ address: account.address, linked: true });
    expect(wallets._store).toHaveLength(1);
  });

  it('logs a security event and 409s when the address belongs to someone else', async () => {
    const wallets = walletRepo([
      { userId: OTHER_USER, address: account.address },
    ]);
    const service = await build(wallets, challenges());
    const logged: string[] = [];
    jest
      .spyOn(service['logger'], 'error')
      .mockImplementation((msg) => logged.push(String(msg)));

    await expect(
      service.linkWallet(USER, {
        address: account.address,
        challengeId: 'chl-1',
        signature,
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
        address: account.address,
        chainFamily: 'EVM',
        createdAt: new Date(),
      },
      {
        userId: OTHER_USER,
        address: attacker.address,
        chainFamily: 'EVM',
        createdAt: new Date(),
      },
    ]);
    const service = await build(wallets, challengeRepo({}));

    const mine = await service.listWallets(USER);
    expect(mine).toHaveLength(1);
    expect(mine[0].address).toBe(account.address);
  });
});
