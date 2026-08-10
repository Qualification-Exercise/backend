import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EErrorCodes } from '@/common/enums/error-codes.enum';
import type { StoreSecretDTO } from '@/secrets/dtos/store-secret.dto';
import { SecretsService } from '@/secrets/services/secrets.service';
import {
  ESecretKind,
  WalletSecret,
} from '@/wallets/entities/wallet-secret.entity';

const USER = 'user-1';
const AT = new Date('2026-08-05T10:00:00.000Z');

const row = (over: Partial<WalletSecret> = {}): WalletSecret =>
  ({
    id: 'secret-1',
    userId: USER,
    kind: ESecretKind.ENTROPY,
    blob: 'ZW50cm9weS1jaXBoZXJ0ZXh0',
    metadata: { v: 1 },
    createdAt: AT,
    ...over,
  }) as WalletSecret;

async function build(rows: WalletSecret[] = []) {
  const secrets = {
    find: jest.fn(async (options: { where: { kind?: ESecretKind } }) =>
      options.where.kind
        ? rows.filter((item) => item.kind === options.where.kind)
        : rows,
    ),
    create: jest.fn((data: Partial<WalletSecret>) => ({ ...data })),
    save: jest.fn(async (item: WalletSecret) => item),
    delete: jest.fn(async ({ kind }: { kind: ESecretKind }) => ({
      affected: rows.filter((item) => item.kind === kind).length,
    })),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      SecretsService,
      { provide: getRepositoryToken(WalletSecret), useValue: secrets },
    ],
  }).compile();

  return { service: moduleRef.get(SecretsService), secrets };
}

describe('SecretsService.store', () => {
  it('appends the blob with its free-form metadata', async () => {
    const { service, secrets } = await build();

    await service.store(USER, ESecretKind.ENTROPY, {
      entropy: 'cipher',
      metadata: { kdf: 'whatever-the-client-used' },
    });

    expect(secrets.save).toHaveBeenCalledWith({
      userId: USER,
      kind: ESecretKind.ENTROPY,
      blob: 'cipher',
      metadata: { kdf: 'whatever-the-client-used' },
    });
  });

  it('stores a seed under its own kind, metadata optional', async () => {
    const { service, secrets } = await build();

    await service.store(USER, ESecretKind.SEED, { seed: 'cipher' });

    expect(secrets.save).toHaveBeenCalledWith({
      userId: USER,
      kind: ESecretKind.SEED,
      blob: 'cipher',
      metadata: null,
    });
  });

  it('refuses a body that does not carry the blob it claims to store', async () => {
    const { service } = await build();

    await expect(
      service.store(USER, ESecretKind.SEED, {
        entropy: 'cipher',
      } as StoreSecretDTO),
    ).rejects.toMatchObject({
      response: { error: { code: EErrorCodes.INVALID_REQUEST } },
    });
  });
});

describe('SecretsService.list', () => {
  it('returns every blob of that kind keyed by kind', async () => {
    const { service } = await build([
      row(),
      row({ id: 'secret-2', metadata: null }),
      row({ id: 'secret-3', kind: ESecretKind.SEED, blob: 'seed-cipher' }),
    ]);

    await expect(service.list(USER, ESecretKind.ENTROPY)).resolves.toEqual([
      { entropy: 'ZW50cm9weS1jaXBoZXJ0ZXh0', metadata: { v: 1 } },
      { entropy: 'ZW50cm9weS1jaXBoZXJ0ZXh0' },
    ]);
    await expect(service.list(USER, ESecretKind.SEED)).resolves.toEqual([
      { seed: 'seed-cipher', metadata: { v: 1 } },
    ]);
  });

  it('returns an empty list for a user with no backup, and logs the miss', async () => {
    const { service } = await build();
    const log = jest.spyOn(service['logger'], 'log');

    await expect(service.list(USER, ESecretKind.ENTROPY)).resolves.toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('found=0'));
  });
});

describe('SecretsService.status', () => {
  it('reports which kinds exist and the newest write', async () => {
    const { service } = await build([row()]);

    await expect(service.status(USER)).resolves.toEqual({
      entropy: true,
      seed: false,
      updatedAt: AT.toISOString(),
    });
  });

  it('reports nothing stored for a fresh user', async () => {
    const { service } = await build();

    await expect(service.status(USER)).resolves.toEqual({
      entropy: false,
      seed: false,
      updatedAt: null,
    });
  });
});

describe('SecretsService.remove', () => {
  it('wipes only the requested kind and reports the count', async () => {
    const { service, secrets } = await build([
      row(),
      row({ id: 'secret-2', kind: ESecretKind.SEED }),
    ]);

    await expect(service.remove(USER, ESecretKind.ENTROPY)).resolves.toEqual({
      deleted: 1,
    });
    expect(secrets.delete).toHaveBeenCalledWith({
      userId: USER,
      kind: ESecretKind.ENTROPY,
    });
  });

  it('is a no-op for a user with nothing stored', async () => {
    const { service } = await build();

    await expect(service.remove(USER, ESecretKind.SEED)).resolves.toEqual({
      deleted: 0,
    });
  });
});
