import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EChainKind } from '@/chains/chain-kind.enum';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import type { PutSecretDTO } from '@/secrets/dtos/put-secret.dto';
import { SECRETS_KDF_FLOOR } from '@/secrets/kdf-floor';
import { SecretsService } from '@/secrets/services/secrets.service';
import { WalletSecret } from '@/wallets/entities/wallet-secret.entity';
import { Wallet } from '@/wallets/entities/wallet.entity';

const USER = 'user-1';
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const AT = new Date('2026-08-05T10:00:00.000Z');

const wrappedKey = (over: Record<string, unknown> = {}) => ({
  ciphertext: 'd3JhcHBlZC1rZXk=',
  kdf: { algo: 'argon2id', salt: 'c2FsdA==', m: 65_536, t: 3, p: 1 },
  ...over,
});

const dto = (over: Partial<PutSecretDTO> = {}): PutSecretDTO =>
  ({
    entropy: 'ZW50cm9weS1jaXBoZXJ0ZXh0',
    wrappedKey: wrappedKey(),
    metadata: { address: ADDRESS, wordCount: 12 },
    ...over,
  }) as PutSecretDTO;

const stored = (over: Partial<WalletSecret> = {}): WalletSecret =>
  ({
    id: 'secret-1',
    userId: USER,
    encryptedEntropy: 'ZW50cm9weS1jaXBoZXJ0ZXh0',
    encryptedSeed: 'c2VlZC1jaXBoZXJ0ZXh0',
    wrappedKey: 'd3JhcHBlZC1rZXk=',
    kdf: { algo: 'argon2id', salt: 'c2FsdA==', m: 65_536, t: 3, p: 1 },
    cipher: 'aes-256-gcm',
    version: 1,
    wordCount: 12,
    primaryAddress: ADDRESS,
    entropyUpdatedAt: AT,
    seedUpdatedAt: AT,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  }) as WalletSecret;

async function build(
  options: {
    existing?: WalletSecret | null;
    wallet?: Partial<Wallet> | null;
    affected?: number;
  } = {},
) {
  const secrets = {
    findOne: jest.fn(async () =>
      options.existing === undefined ? null : options.existing,
    ),
    create: jest.fn((data: Partial<WalletSecret>) => ({ ...data })),
    save: jest.fn(async (row: WalletSecret) => row),
    delete: jest.fn(async () => ({ affected: options.affected ?? 1 })),
  };

  const wallet =
    options.wallet === undefined
      ? {
          id: 'w-1',
          userId: USER,
          chain: EChainKind.EVM,
          isPrimary: true,
          address: ADDRESS,
        }
      : options.wallet;

  const moduleRef = await Test.createTestingModule({
    providers: [
      SecretsService,
      { provide: getRepositoryToken(WalletSecret), useValue: secrets },
      {
        provide: getRepositoryToken(Wallet),
        useValue: { findOne: jest.fn(async () => wallet) },
      },
    ],
  }).compile();

  return { service: moduleRef.get(SecretsService), secrets };
}

describe('SecretsService.put', () => {
  it('stores the entropy blob and the wrapped key on a first write', async () => {
    const { service, secrets } = await build();

    const result = await service.put(USER, 'entropy', dto());

    expect(result).toMatchObject({ stored: 'entropy', wordCount: 12 });
    const saved = secrets.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      userId: USER,
      encryptedEntropy: 'ZW50cm9weS1jaXBoZXJ0ZXh0',
      wrappedKey: 'd3JhcHBlZC1rZXk=',
      cipher: 'aes-256-gcm',
      version: 1,
      primaryAddress: ADDRESS,
    });
  });

  it('stores the seed blob on its own timestamp', async () => {
    const { service, secrets } = await build();

    const result = await service.put(
      USER,
      'seed',
      dto({ entropy: undefined, seed: 'c2VlZC1jaXBoZXJ0ZXh0' } as never),
    );

    expect(result.stored).toBe('seed');
    expect(secrets.save.mock.calls[0][0].encryptedSeed).toBe(
      'c2VlZC1jaXBoZXJ0ZXh0',
    );
  });

  it('honours an explicit cipher and version', async () => {
    const { service, secrets } = await build();

    await service.put(
      USER,
      'entropy',
      dto({
        wrappedKey: wrappedKey({ cipher: 'aes-256-gcm', version: 2 }),
      } as never),
    );

    expect(secrets.save.mock.calls[0][0].version).toBe(2);
  });

  it('refuses a body that does not carry the blob it claims to store', async () => {
    const { service } = await build();

    await expect(
      service.put(USER, 'seed', dto({ seed: undefined } as never)),
    ).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.INVALID_REQUEST } },
    });
  });

  it('refuses a blob larger than the format allows', async () => {
    const { service } = await build();

    await expect(
      service.put(USER, 'entropy', dto({ entropy: 'A'.repeat(129) })),
    ).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.INVALID_BLOB_SIZE } },
    });
  });

  it('refuses a wrapped key larger than the format allows', async () => {
    const { service } = await build();

    await expect(
      service.put(
        USER,
        'entropy',
        dto({
          wrappedKey: wrappedKey({ ciphertext: 'A'.repeat(257) }),
        } as never),
      ),
    ).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.INVALID_BLOB_SIZE } },
    });
  });

  it('requires a wrapped key on the very first write', async () => {
    const { service } = await build();

    await expect(
      service.put(USER, 'entropy', dto({ wrappedKey: undefined } as never)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the stored wrapped key when a later write omits it', async () => {
    const { service, secrets } = await build({ existing: stored() });

    await service.put(USER, 'entropy', dto({ wrappedKey: undefined } as never));

    expect(secrets.save.mock.calls[0][0].wrappedKey).toBe('d3JhcHBlZC1rZXk=');
  });

  it.each([
    ['a weaker algorithm', { algo: 'pbkdf2' }],
    ['too little memory', { m: SECRETS_KDF_FLOOR.m - 1 }],
    ['too few iterations', { t: SECRETS_KDF_FLOOR.t - 1 }],
    ['too little parallelism', { p: SECRETS_KDF_FLOOR.p - 1 }],
  ])('refuses a key derived with %s', async (_label, weak) => {
    const { service } = await build();

    await expect(
      service.put(
        USER,
        'entropy',
        dto({
          wrappedKey: wrappedKey({ kdf: { ...wrappedKey().kdf, ...weak } }),
        } as never),
      ),
    ).rejects.toMatchObject({
      response: {
        error: {
          code: EErrorCodes.WEAK_KDF_PARAMS,
          details: { floor: SECRETS_KDF_FLOOR },
        },
      },
    });
  });

  it('accepts parameters above the floor', async () => {
    const { service } = await build();

    await expect(
      service.put(
        USER,
        'entropy',
        dto({
          wrappedKey: wrappedKey({
            kdf: { ...wrappedKey().kdf, m: 131_072, t: 4, p: 2 },
          }),
        } as never),
      ),
    ).resolves.toMatchObject({ stored: 'entropy' });
  });

  it('refuses a backup before an EVM wallet is linked', async () => {
    const { service } = await build({ wallet: null });

    await expect(service.put(USER, 'entropy', dto())).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.WALLET_NOT_LINKED } },
    });
  });

  it('refuses a blob declared against somebody else’s address', async () => {
    const { service } = await build();

    await expect(
      service.put(
        USER,
        'entropy',
        dto({
          metadata: {
            address: '0x1234567890123456789012345678901234567890',
            wordCount: 12,
          },
        } as never),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a malformed declared address', async () => {
    const { service } = await build();

    await expect(
      service.put(
        USER,
        'entropy',
        dto({ metadata: { address: 'nonsense', wordCount: 12 } } as never),
      ),
    ).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.WALLET_ADDRESS_MISMATCH } },
    });
  });
});

describe('SecretsService.get', () => {
  it('returns the ciphertext with the parameters needed to decrypt it', async () => {
    const { service } = await build({ existing: stored() });

    const result = await service.get(USER, 'entropy');

    expect(result).toMatchObject({
      entropy: 'ZW50cm9weS1jaXBoZXJ0ZXh0',
      wrappedKey: {
        ciphertext: 'd3JhcHBlZC1rZXk=',
        cipher: 'aes-256-gcm',
        version: 1,
      },
      metadata: { address: ADDRESS, wordCount: 12 },
      updatedAt: AT.toISOString(),
    });
  });

  it('returns the seed blob under its own key', async () => {
    const { service } = await build({ existing: stored() });

    await expect(service.get(USER, 'seed')).resolves.toMatchObject({
      seed: 'c2VlZC1jaXBoZXJ0ZXh0',
    });
  });

  it('falls back to the row timestamp when the blob has none', async () => {
    const { service } = await build({
      existing: stored({ entropyUpdatedAt: null as never }),
    });

    await expect(service.get(USER, 'entropy')).resolves.toMatchObject({
      updatedAt: AT.toISOString(),
    });
  });

  it('logs the read whether or not it found anything', async () => {
    const { service } = await build({ existing: null });
    const log = jest.spyOn(service['logger'], 'log');

    await expect(service.get(USER, 'entropy')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('security_event=secrets.read'),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining('found=false'));
  });

  it('404s when the row exists but that blob was never stored', async () => {
    const { service } = await build({
      existing: stored({ encryptedSeed: null }),
    });

    await expect(service.get(USER, 'seed')).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.SECRET_NOT_FOUND } },
    });
  });
});

describe('SecretsService.remove', () => {
  it('deletes both blobs and stays quiet when there was nothing to delete', async () => {
    const { service, secrets } = await build({ affected: 0 });

    await expect(service.remove(USER)).resolves.toBeUndefined();
    expect(secrets.delete).toHaveBeenCalledWith({ userId: USER });
  });
});

describe('SecretsService.status', () => {
  it('reports which blobs exist', async () => {
    const { service } = await build({
      existing: stored({ encryptedSeed: null }),
    });

    await expect(service.status(USER)).resolves.toEqual({
      entropy: true,
      seed: false,
      updatedAt: AT.toISOString(),
    });
  });

  it('reports nothing stored for a fresh user', async () => {
    const { service } = await build({ existing: null });

    await expect(service.status(USER)).resolves.toEqual({
      entropy: false,
      seed: false,
      updatedAt: null,
    });
  });
});
