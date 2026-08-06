import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Merchant } from '@/payments/entities/merchant.entity';
import { MerchantsService } from '@/payments/services/merchants.service';

const SEPOLIA = 11155111;
const BITCOIN = 4294967298;

// Lowercase on purpose: a caller pasting from a block explorer rarely sends the
// checksummed form, and the poller only ever compares the canonical one.
const ADDRESS = '0x95fa3c48a38077e20b47c8ef426597a7e1f112ab';
const CHECKSUMMED = '0x95FA3C48A38077e20b47c8Ef426597a7e1F112ab';

function row(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: 'e2b1c0de-0000-4000-8000-000000000001',
    name: 'Demo Merchant',
    srcChainId: SEPOLIA,
    address: CHECKSUMMED,
    token: 'usdt',
    priority: 100,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as Merchant;
}

async function build(insert: jest.Mock = jest.fn(async () => undefined)) {
  const merchants = {
    find: jest.fn(async () => [row()]),
    findOne: jest.fn(async () => row()),
    create: jest.fn((data: Partial<Merchant>) => row(data)),
    insert,
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      MerchantsService,
      { provide: getRepositoryToken(Merchant), useValue: merchants },
      {
        provide: ConfigService,
        useValue: { get: jest.fn(() => 500) },
      },
    ],
  }).compile();

  return { service: moduleRef.get(MerchantsService), merchants };
}

const valid = {
  name: 'Demo Merchant',
  srcChainId: SEPOLIA,
  address: ADDRESS,
  token: 'USDT',
};

describe('MerchantsService.register', () => {
  it('stores the canonical address and lowercased token', async () => {
    const insert = jest.fn(async () => undefined);
    const { service, merchants } = await build(insert);

    const result = await service.register({ ...valid });

    expect(merchants.create).toHaveBeenCalledWith(
      expect.objectContaining({ address: CHECKSUMMED, token: 'usdt' }),
    );
    expect(result.address).toBe(CHECKSUMMED);
    // Without this the poller compares a lowercase `to` against a mixed-case
    // row and silently ingests nothing.
    expect(result.cashbackBps).toBe(500);
  });

  it('defaults priority and active so a new merchant is polled', async () => {
    const { service } = await build();

    const result = await service.register({ ...valid });

    expect(result.active).toBe(true);
    expect(result.priority).toBe(100);
  });

  it('rejects an address from the wrong chain family', async () => {
    const { service, merchants } = await build();

    await expect(
      service.register({ ...valid, srcChainId: BITCOIN, token: 'btc' }),
    ).rejects.toThrow(BadRequestException);
    expect(merchants.insert).not.toHaveBeenCalled();
  });

  it('rejects an unparseable address', async () => {
    const { service } = await build();

    await expect(
      service.register({ ...valid, address: 'not-an-address' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'INVALID_MERCHANT_ADDRESS' } },
    });
  });

  it('rejects an unknown chain', async () => {
    const { service } = await build();

    await expect(
      service.register({ ...valid, srcChainId: 999999 }),
    ).rejects.toMatchObject({
      response: { error: { code: 'UNSUPPORTED_CHAIN' } },
    });
  });

  it('rejects a token the chain does not carry', async () => {
    const { service, merchants } = await build();

    await expect(service.register({ ...valid, token: 'xaut' })).rejects.toThrow(
      BadRequestException,
    );
    expect(merchants.insert).not.toHaveBeenCalled();
  });

  it('reports a duplicate as a conflict, not a 500', async () => {
    const insert = jest.fn(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });
    const { service } = await build(insert);

    await expect(service.register({ ...valid })).rejects.toThrow(
      ConflictException,
    );
  });

  it('lets an unexpected database error through', async () => {
    const insert = jest.fn(async () => {
      throw Object.assign(new Error('connection reset'), { code: '08006' });
    });
    const { service } = await build(insert);

    await expect(service.register({ ...valid })).rejects.toThrow(
      'connection reset',
    );
  });
});

describe('MerchantsService reads', () => {
  it('lists active merchants only by default', async () => {
    const { service, merchants } = await build();

    await service.list(true);

    expect(merchants.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('lists everything when asked', async () => {
    const { service, merchants } = await build();

    await service.list(false);

    expect(merchants.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('404s on an unknown id', async () => {
    const { service, merchants } = await build();
    merchants.findOne.mockResolvedValueOnce(null as unknown as Merchant);

    await expect(service.findById('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns the merchant a payer needs to pay', async () => {
    const { service } = await build();

    await expect(service.findById(row().id)).resolves.toMatchObject({
      address: CHECKSUMMED,
      token: 'usdt',
      cashbackBps: 500,
    });
  });
});
