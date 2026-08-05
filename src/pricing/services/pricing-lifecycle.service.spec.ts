import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Payment } from '@/payments/entities/payment.entity';
import { PriceSnapshot } from '@/pricing/entities/price-snapshot.entity';
import { PriceSource } from '@/pricing/price-source';
import { PricingService } from '@/pricing/services/pricing.service';

async function build(
  options: { intervalMs?: number; dueError?: unknown } = {},
) {
  const queryBuilder = {
    where: () => queryBuilder,
    andWhere: () => queryBuilder,
    orderBy: () => queryBuilder,
    limit: () => queryBuilder,
    getMany: async (): Promise<Payment[]> => {
      if (options.dueError) throw options.dueError;
      return [];
    },
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      PricingService,
      { provide: PriceSource, useValue: { priceAt: jest.fn() } },
      {
        provide: getRepositoryToken(Payment),
        useValue: { createQueryBuilder: () => queryBuilder },
      },
      {
        provide: getRepositoryToken(PriceSnapshot),
        useValue: { create: jest.fn(), insert: jest.fn(), findOne: jest.fn() },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            ({
              PRICING_POLL_INTERVAL_MS: options.intervalMs ?? 0,
              PRICING_BATCH_SIZE: 25,
            })[key],
        },
      },
    ],
  }).compile();

  return moduleRef.get(PricingService);
}

afterEach(() => jest.useRealTimers());

describe('PricingService lifecycle', () => {
  it('stays off when the interval is zero', async () => {
    const service = await build({ intervalMs: 0 });
    const tick = jest.spyOn(service, 'tick');

    service.onModuleInit();
    service.onModuleDestroy();

    expect(tick).not.toHaveBeenCalled();
  });

  it('prices on each tick until shutdown', async () => {
    jest.useFakeTimers();
    const service = await build({ intervalMs: 1_000 });
    const tick = jest.spyOn(service, 'tick').mockResolvedValue(undefined);

    service.onModuleInit();
    jest.advanceTimersByTime(2_000);
    expect(tick).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    jest.advanceTimersByTime(2_000);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});

describe('PricingService.tick', () => {
  it('skips a pass while the previous one is still running', async () => {
    const service = await build();
    let release: () => void = () => undefined;
    jest
      .spyOn(service as unknown as { due: () => Promise<Payment[]> }, 'due')
      .mockImplementationOnce(
        () =>
          new Promise<Payment[]>((resolve) => {
            release = () => resolve([]);
          }),
      );
    const warn = jest.spyOn(service['logger'], 'warn');

    const first = service.tick();
    await service.tick();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('still running'));
    release();
    await first;
  });

  it('survives a failing pass and unlocks for the next one', async () => {
    const service = await build({ dueError: new Error('db down') });
    const error = jest.spyOn(service['logger'], 'error');

    await expect(service.tick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Pricing tick failed'),
    );

    await expect(service.tick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe('PricingService.getLivePricing', () => {
  it('returns one row per requested source, defaulting the quote to USD', async () => {
    const service = await build();
    service['client'] = {
      getMultiCurrentPrices: jest.fn(async () => [62_204, 0.9999]),
    } as never;

    await expect(
      service.getLivePricing({ fromSources: ['BTC', 'USDT'] }),
    ).resolves.toEqual({
      data: [
        { from: 'BTC', to: 'USD', price: 62_204 },
        { from: 'USDT', to: 'USD', price: 0.9999 },
      ],
    });
  });

  it('honours an explicit quote currency', async () => {
    const service = await build();
    const getMultiCurrentPrices = jest.fn(async () => [1]);
    service['client'] = { getMultiCurrentPrices } as never;

    await service.getLivePricing({ fromSources: ['BTC'], to: 'EUR' });

    expect(getMultiCurrentPrices).toHaveBeenCalledWith([
      { from: 'BTC', to: 'EUR' },
    ]);
  });

  it('reports a missing price as null rather than dropping the row', async () => {
    const service = await build();
    service['client'] = {
      getMultiCurrentPrices: jest.fn(async () => [undefined]),
    } as never;

    await expect(
      service.getLivePricing({ fromSources: ['XAUT'] }),
    ).resolves.toEqual({
      data: [{ from: 'XAUT', to: 'USD', price: null }],
    });
  });
});
