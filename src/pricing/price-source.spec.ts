import {
  PriceSource,
  PriceUnavailableError,
  assetForToken,
} from '@/pricing/price-source';

const AT = new Date('2026-04-06T15:28:36.000Z');
const HOUR = 3_600_000;

type HistoryArgs = [string, string, { start: number; end: number }];
type HistoryMock = jest.Mock;

/** Replaces the Bitfinex HTTP client without touching the production wiring. */
function withClient(getHistoricalPrice: HistoryMock): PriceSource {
  const source = new PriceSource();
  (source as unknown as { client: unknown }).client = { getHistoricalPrice };
  return source;
}

describe('assetForToken', () => {
  it('maps indexer tokens to canonical assets', () => {
    expect(assetForToken('usdt')).toBe('USDT');
    expect(assetForToken('BTC')).toBe('BTC');
    expect(assetForToken('xaut')).toBe('XAUT');
    expect(assetForToken('eth')).toBe('ETH');
  });

  it('refuses an unknown token rather than pricing it as something else', () => {
    expect(() => assetForToken('doge')).toThrow(PriceUnavailableError);
  });
});

describe('PriceSource.priceAt', () => {
  it('takes the last price at or before the payment, never a later one', async () => {
    const source = withClient(
      jest.fn(async () => [
        { price: 62317, ts: AT.getTime() + 696_000 }, // after the payment
        { price: 62204, ts: AT.getTime() - HOUR },
        { price: 62100, ts: AT.getTime() - 2 * HOUR },
      ]),
    );

    const quote = await source.priceAt('BTC', AT);

    expect(quote.price).toBe('62204');
    expect(quote.source).toBe('bitfinex');
    expect(quote.providerTimestamp).toEqual(new Date(AT.getTime() - HOUR));
  });

  it('reads the provider timestamp under either field name it ships', async () => {
    const source = withClient(
      jest.fn(async () => [{ price: 62204, timestamp: AT.getTime() - HOUR }]),
    );

    await expect(source.priceAt('BTC', AT)).resolves.toMatchObject({
      price: '62204',
    });
  });

  it('translates USDT to the Bitfinex code and asks for USD', async () => {
    const getHistoricalPrice: HistoryMock = jest.fn(async () => [
      { price: 0.99991, ts: AT.getTime() - HOUR },
    ]);
    await withClient(getHistoricalPrice).priceAt('USDT', AT);

    const [from, to] = getHistoricalPrice.mock.calls[0] as HistoryArgs;
    expect(from).toBe('UST');
    expect(to).toBe('USD');
  });

  it('queries a window wider than the provider hourly step', async () => {
    const getHistoricalPrice: HistoryMock = jest.fn(async () => [
      { price: 1, ts: AT.getTime() - HOUR },
    ]);
    await withClient(getHistoricalPrice).priceAt('BTC', AT);

    const [, , { start, end }] = getHistoricalPrice.mock
      .calls[0] as HistoryArgs;
    expect(end - start).toBeGreaterThan(HOUR);
    expect(start).toBeLessThan(AT.getTime());
  });

  it('fails loudly when the provider is down', async () => {
    const source = withClient(
      jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    await expect(source.priceAt('BTC', AT)).rejects.toThrow(
      PriceUnavailableError,
    );
  });

  it('fails when the window holds no price at or before the payment', async () => {
    const source = withClient(
      jest.fn(async () => [{ price: 62317, ts: AT.getTime() + HOUR }]),
    );

    await expect(source.priceAt('BTC', AT)).rejects.toThrow(
      /No BTC\/USD price at or before/,
    );
  });

  it('rejects a non-price rather than snapshotting it', async () => {
    const source = withClient(
      jest.fn(async () => [{ price: 0, ts: AT.getTime() - HOUR }]),
    );

    await expect(source.priceAt('BTC', AT)).rejects.toThrow(/non-price/);
  });

  it('rejects an asset Bitfinex has no symbol for', async () => {
    const source = withClient(jest.fn(async () => []));
    await expect(source.priceAt('DOGE', AT)).rejects.toThrow(
      /No Bitfinex symbol/,
    );
  });
});
