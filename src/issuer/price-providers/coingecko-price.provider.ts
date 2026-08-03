import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import {
  PriceUnavailableError,
  type IPriceQuote,
} from '@/pricing/price-source';

const COIN_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  USDT: 'tether',
  XAUT: 'tether-gold',
  ETH: 'ethereum',
};

const WINDOW_BEFORE_MS = 6 * 60 * 60 * 1000;
const WINDOW_AFTER_MS = 60 * 60 * 1000;

@Injectable()
export class CoinGeckoPriceProvider {
  constructor(private readonly http: HttpService) {}

  async priceAt(asset: string, at: Date): Promise<IPriceQuote> {
    const coin = COIN_IDS[asset];
    if (!coin) {
      throw new PriceUnavailableError(`No CoinGecko id for asset ${asset}`);
    }

    const target = at.getTime();
    const url = `https://api.coingecko.com/api/v3/coins/${coin}/market_chart/range`;

    let points: [number, number][];
    try {
      const response = await firstValueFrom(
        this.http.get<{ prices: [number, number][] }>(url, {
          params: {
            vs_currency: 'usd',
            from: Math.floor((target - WINDOW_BEFORE_MS) / 1000),
            to: Math.floor((target + WINDOW_AFTER_MS) / 1000),
          },
          timeout: 10_000,
        }),
      );
      points = response.data?.prices ?? [];
    } catch (err) {
      throw new PriceUnavailableError(
        `CoinGecko ${asset}/USD unavailable at ${at.toISOString()}: ${String(err)}`,
      );
    }

    const [ts, price] =
      points
        .filter(([pointTs]) => pointTs <= target)
        .sort((a, b) => b[0] - a[0])[0] ?? [];

    if (ts === undefined || !Number.isFinite(price) || price <= 0) {
      throw new PriceUnavailableError(
        `No CoinGecko ${asset}/USD price at or before ${at.toISOString()}`,
      );
    }

    return {
      price: String(price),
      source: 'coingecko',
      providerTimestamp: new Date(ts),
    };
  }
}
