/**
 * Asset→USD prices from the WDK pricing sources (BE-08).
 *
 * Wraps `@tetherto/wdk-pricing-bitfinex-http` rather than calling Bitfinex
 * directly: the WDK client already knows the exchange's symbol quirks, and
 * reusing it keeps our number and the wallet's number from drifting apart.
 */
import { Injectable, Logger } from '@nestjs/common';
import { BitfinexPricingClient } from '@tetherto/wdk-pricing-bitfinex-http';

import { HOUR_MS } from '@/common/time';

export interface IPriceQuote {
  price: string;
  source: string;
  providerTimestamp: Date;
}

export class PriceUnavailableError extends Error {}

/**
 * Bitfinex uses its own currency codes: Tether is `UST`, not `USDT`. Unknown
 * codes resolve to null rather than failing, so the mapping lives in one place
 * and an unmapped asset is an explicit error.
 */
const BITFINEX_SYMBOL: Record<string, string | undefined> = {
  BTC: 'BTC',
  USDT: 'UST',
  XAUT: 'XAUT',
  ETH: 'ETH',
};

/** Indexer `{token}` path segment → our canonical asset symbol. */
const ASSET_BY_TOKEN: Record<string, string | undefined> = {
  btc: 'BTC',
  usdt: 'USDT',
  xaut: 'XAUT',
  eth: 'ETH',
};

export function assetForToken(token: string): string {
  const asset = ASSET_BY_TOKEN[token.toLowerCase()];
  if (!asset)
    throw new PriceUnavailableError(`No asset mapped for token ${token}`);
  return asset;
}

interface IPricePoint {
  price: number;
  ts?: number;
  timestamp?: number;
}

function timestampOf(point: IPricePoint): number | undefined {
  return point.ts ?? point.timestamp;
}

/**
 * The provider returns hourly points in descending order, and its loop only runs
 * when the window is wider than an hour — so ask for several hours and pick from
 * the result rather than requesting a point.
 */
const WINDOW_BEFORE_MS = 6 * HOUR_MS;
const WINDOW_AFTER_MS = HOUR_MS;

@Injectable()
export class PriceSource {
  private readonly logger = new Logger(PriceSource.name);
  private readonly client = new BitfinexPricingClient();

  /**
   * The price as it stood at `at` — the moment of the payment, never the moment
   * of accrual, so polling latency cannot change the number.
   *
   * Throws `PriceUnavailableError` rather than returning a guess: a coupon that
   * waits is a delay, a coupon accrued at an invented price is a wrong mint.
   */
  async priceAt(asset: string, at: Date): Promise<IPriceQuote> {
    const symbol = BITFINEX_SYMBOL[asset];
    if (!symbol) {
      throw new PriceUnavailableError(`No Bitfinex symbol for asset ${asset}`);
    }

    const target = at.getTime();
    let points: IPricePoint[];
    try {
      points = (await this.client.getHistoricalPrice(symbol, 'USD', {
        start: target - WINDOW_BEFORE_MS,
        end: target + WINDOW_AFTER_MS,
      })) as IPricePoint[];
    } catch (err) {
      // A provider outage is a handled state, not a crash.
      throw new PriceUnavailableError(
        `${symbol}/USD history unavailable at ${at.toISOString()}: ${String(err)}`,
      );
    }

    // The price that held when the payment happened is the last one at or
    // before it — never a later point that the payer could not have seen.
    const atOrBefore = points
      .map((point) => ({ price: point.price, ts: timestampOf(point) }))
      .filter(
        (point): point is { price: number; ts: number } =>
          point.ts !== undefined && point.ts <= target,
      )
      .sort((a, b) => b.ts - a.ts)[0];

    if (!atOrBefore) {
      throw new PriceUnavailableError(
        `No ${symbol}/USD price at or before ${at.toISOString()}`,
      );
    }
    if (!Number.isFinite(atOrBefore.price) || atOrBefore.price <= 0) {
      throw new PriceUnavailableError(
        `${symbol}/USD returned a non-price: ${atOrBefore.price}`,
      );
    }

    this.logger.debug(
      `${symbol}/USD = ${atOrBefore.price} at ${new Date(atOrBefore.ts).toISOString()}`,
    );

    return {
      price: String(atOrBefore.price),
      source: 'bitfinex',
      providerTimestamp: new Date(atOrBefore.ts),
    };
  }
}
