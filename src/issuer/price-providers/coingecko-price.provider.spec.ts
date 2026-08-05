import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';

import { CoinGeckoPriceProvider } from '@/issuer/price-providers/coingecko-price.provider';
import { PriceUnavailableError } from '@/pricing/price-source';

const AT = new Date('2026-08-05T12:00:00.000Z');

function build(behaviour: { prices?: unknown; error?: unknown }) {
  const get = jest.fn(() =>
    behaviour.error
      ? throwError(() => behaviour.error)
      : of({ data: { prices: behaviour.prices } }),
  );
  return {
    provider: new CoinGeckoPriceProvider({ get } as unknown as HttpService),
    get,
  };
}

describe('CoinGeckoPriceProvider', () => {
  it('takes the most recent point at or before the payment', async () => {
    const { provider } = build({
      prices: [
        [AT.getTime() - 7_200_000, 61_000],
        [AT.getTime() - 3_600_000, 62_204],
        [AT.getTime() + 600_000, 63_000],
      ],
    });

    await expect(provider.priceAt('BTC', AT)).resolves.toEqual({
      price: '62204',
      source: 'coingecko',
      providerTimestamp: new Date(AT.getTime() - 3_600_000),
    });
  });

  it('asks for a window around the payment in seconds', async () => {
    const { provider, get } = build({ prices: [[AT.getTime(), 1]] });

    await provider.priceAt('USDT', AT);

    expect(get).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/coins/tether/market_chart/range',
      expect.objectContaining({
        params: {
          vs_currency: 'usd',
          from: Math.floor((AT.getTime() - 6 * 3_600_000) / 1000),
          to: Math.floor((AT.getTime() + 3_600_000) / 1000),
        },
        timeout: 10_000,
      }),
    );
  });

  it('refuses an asset it has no CoinGecko id for', async () => {
    const { provider, get } = build({ prices: [] });

    await expect(provider.priceAt('DOGE', AT)).rejects.toBeInstanceOf(
      PriceUnavailableError,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('reports the provider being down as a price being unavailable', async () => {
    const { provider } = build({ error: new Error('ETIMEDOUT') });

    await expect(provider.priceAt('BTC', AT)).rejects.toThrow(
      PriceUnavailableError,
    );
  });

  it('refuses to guess when every point is after the payment', async () => {
    const { provider } = build({ prices: [[AT.getTime() + 1, 62_000]] });

    await expect(provider.priceAt('BTC', AT)).rejects.toThrow(
      /No CoinGecko BTC\/USD price at or before/,
    );
  });

  it('refuses an empty or missing price series', async () => {
    await expect(
      build({ prices: [] }).provider.priceAt('BTC', AT),
    ).rejects.toBeInstanceOf(PriceUnavailableError);
    await expect(
      build({ prices: undefined }).provider.priceAt('BTC', AT),
    ).rejects.toBeInstanceOf(PriceUnavailableError);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['not a number', Number.NaN],
  ])('refuses a %s price', async (_label, price) => {
    const { provider } = build({ prices: [[AT.getTime() - 1000, price]] });

    await expect(provider.priceAt('ETH', AT)).rejects.toBeInstanceOf(
      PriceUnavailableError,
    );
  });
});
