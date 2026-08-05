import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CounterService } from '@/common/metrics/counter.service';
import { setupSwagger } from '@/common/utils/swagger.util';
import {
  EAsset,
  EBlockchain,
  SUPPORTED_ASSETS,
  SUPPORTED_BLOCKCHAINS,
} from '@/indexer/enums/blockchain.enum';
import { GetLivePricingDto } from '@/pricing/dtos/get-live-pricing.dto';
import { PricingController } from '@/pricing/controllers/pricing.controller';

const createDocument = jest.fn(() => ({ paths: {} }) as { paths: object });
const setup = jest.fn();

jest.mock('@nestjs/swagger', () => ({
  ...jest.requireActual('@nestjs/swagger'),
  SwaggerModule: {
    createDocument: (...args: unknown[]) => createDocument(...(args as [])),
    setup: (...args: unknown[]) => setup(...(args as [])),
  },
}));

beforeEach(() => {
  createDocument.mockClear();
  setup.mockClear();
});

describe('PricingController', () => {
  const service = { getLivePricing: jest.fn(async () => ({ data: [] })) };
  const controller = new PricingController(service as never);

  beforeEach(() => jest.clearAllMocks());

  it('splits the comma-separated asset list and trims each entry', async () => {
    await controller.getLivePricing({
      fromSources: 'BTC, ETH ,USDT',
      to: 'USD',
    } as GetLivePricingDto);

    expect(service.getLivePricing).toHaveBeenCalledWith({
      fromSources: ['BTC', 'ETH', 'USDT'],
      to: 'USD',
    });
  });

  it('leaves the quote currency to the service when it is omitted', async () => {
    await controller.getLivePricing({
      fromSources: 'BTC',
    } as GetLivePricingDto);

    expect(service.getLivePricing).toHaveBeenCalledWith({
      fromSources: ['BTC'],
      to: undefined,
    });
  });

  it('requires fromSources', () => {
    const errors = validateSync(
      plainToInstance(GetLivePricingDto, { to: 'USD' }),
    );

    expect(errors.map((e) => e.property)).toEqual(['fromSources']);
  });
});

describe('CounterService', () => {
  const build = (queryImpl: () => Promise<unknown>) => {
    const query = jest.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_sql: string, _params: unknown[]) => queryImpl() as unknown,
    );
    return { service: new CounterService({ query } as never), query };
  };

  it('increments by one by default', async () => {
    const { service, query } = build(async () => undefined);

    service.increment('indexer.requests');
    await Promise.resolve();

    expect(query.mock.calls[0][1]).toEqual(['indexer.requests', 1]);
  });

  it('increments by an explicit amount', async () => {
    const { service, query } = build(async () => undefined);

    service.increment('indexer.errors', 5);
    await Promise.resolve();

    expect(query.mock.calls[0][1]).toEqual(['indexer.errors', 5]);
  });

  it('never lets a failed counter surface to the caller', async () => {
    const { service } = build(async () => {
      throw new Error('db down');
    });

    // Telemetry, not bookkeeping: this must not throw, and must not reject.
    expect(() => service.increment('indexer.requests')).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('reads counters and reports the missing ones as zero', async () => {
    const { service } = build(async () => [
      { name: 'indexer.requests', value: '42' },
    ]);

    await expect(
      service.read(['indexer.requests', 'indexer.errors']),
    ).resolves.toEqual({ 'indexer.requests': 42, 'indexer.errors': 0 });
  });
});

describe('setupSwagger', () => {
  it('mounts every route but /health under the /api prefix', () => {
    // "Try it out" hits the documented path verbatim, so a document that keeps
    // the raw controller paths sends every request to the wrong URL.
    createDocument.mockReturnValueOnce({
      paths: {
        '/health': { get: {} },
        '/coupons': { get: {} },
        '/claims/{id}': { get: {} },
      },
    });

    setupSwagger({} as never, 3000);

    const document = setup.mock.calls[0][2] as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/claims/{id}',
      '/api/coupons',
      '/health',
    ]);
  });

  it('serves the JSON document next to the UI', () => {
    createDocument.mockReturnValueOnce({ paths: {} });

    setupSwagger({} as never, 3000);

    expect(setup.mock.calls[0][0]).toBe('docs');
    expect(setup.mock.calls[0][3]).toMatchObject({
      jsonDocumentUrl: 'docs/json',
    });
  });
});

describe('chain enums', () => {
  it('lists every blockchain and asset the indexer understands', () => {
    expect(SUPPORTED_BLOCKCHAINS).toEqual(Object.values(EBlockchain));
    expect(SUPPORTED_ASSETS).toEqual(Object.values(EAsset));
    expect(SUPPORTED_BLOCKCHAINS).toContain('sepolia');
    expect(SUPPORTED_ASSETS).toContain('usdt');
  });
});
