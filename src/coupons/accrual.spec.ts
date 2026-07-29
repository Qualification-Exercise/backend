import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AccrualInputError,
  accrualAmount,
  decimalsFor,
  generateCouponCode,
  toWad,
} from '@/coupons/accrual';

const GOLDEN = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../test/fixtures/accrual/golden-amounts.json'),
    'utf8',
  ),
) as {
  vectors: {
    note: string;
    paymentAmount: string;
    asset: string;
    assetUsdPrice: string;
    utlUsdRate: string;
    cashbackBps: number;
    amount: string;
  }[];
};

describe('accrualAmount — golden vectors', () => {
  it.each(GOLDEN.vectors.map((v) => [v.note, v] as const))(
    'matches the committed vector: %s',
    (_note, vector) => {
      expect(accrualAmount(vector)).toBe(vector.amount);
    },
  );

  it('covers every asset precision we accrue', () => {
    const assets = new Set(GOLDEN.vectors.map((v) => v.asset));
    expect(assets.has('USDT')).toBe(true); // 6 decimals
    expect(assets.has('BTC')).toBe(true); // 8 decimals
    expect(assets.has('ETH')).toBe(true); // 18 decimals, no re-scaling
  });
});

describe('accrualAmount — rounding', () => {
  const base = {
    asset: 'USDT',
    utlUsdRate: '1',
    cashbackBps: 500,
  };

  it('floors instead of rounding up, on either side of a half wei', () => {
    const justUnder = accrualAmount({
      ...base,
      paymentAmount: '0.000001',
      assetUsdPrice: '0.0000000000399999',
    });
    const justOver = accrualAmount({
      ...base,
      paymentAmount: '0.000001',
      assetUsdPrice: '0.0000000000400001',
    });
    expect(justUnder).toBe('1');
    expect(justOver).toBe('2');
  });

  it('never rounds a real entitlement up into a mint', () => {
    // Anything strictly below one wei is zero, however close it gets.
    expect(
      accrualAmount({
        ...base,
        paymentAmount: '0.000001',
        assetUsdPrice: '0.0000000000199999999999',
      }),
    ).toBe('0');
  });

  it('truncates the payment at the asset precision before pricing it', () => {
    // USD₮ carries 6 decimals; the 7th is noise and must not be paid for.
    expect(
      accrualAmount({
        ...base,
        paymentAmount: '1.0000009',
        assetUsdPrice: '1',
      }),
    ).toBe(
      accrualAmount({ ...base, paymentAmount: '1.000000', assetUsdPrice: '1' }),
    );
  });

  it('leaves an 18-decimal asset unscaled', () => {
    // ETH is already the contract's unit: 1 wei in, no multiplication.
    expect(toWad('0.000000000000000001', 18)).toBe(1n);
    expect(
      accrualAmount({
        ...base,
        asset: 'ETH',
        paymentAmount: '10',
        assetUsdPrice: '1920.55',
      }),
    ).toBe('960275000000000000000');
  });

  it('keeps satoshi precision for BTC', () => {
    expect(
      accrualAmount({
        ...base,
        asset: 'BTC',
        paymentAmount: '0.00000001',
        assetUsdPrice: '62204',
      }),
    ).toBe('31102000000000');
  });

  it('scales the rate: doubling the UTL price halves the coupon', () => {
    const atOne = accrualAmount({
      ...base,
      paymentAmount: '1',
      assetUsdPrice: '1',
    });
    const atTwo = accrualAmount({
      ...base,
      paymentAmount: '1',
      assetUsdPrice: '1',
      utlUsdRate: '2',
    });
    expect(BigInt(atOne) / 2n).toBe(BigInt(atTwo));
  });

  it('rejects inputs it cannot price rather than guessing', () => {
    expect(() =>
      accrualAmount({ ...base, paymentAmount: '-1', assetUsdPrice: '1' }),
    ).toThrow(AccrualInputError);
    expect(() =>
      accrualAmount({ ...base, paymentAmount: 'NaN', assetUsdPrice: '1' }),
    ).toThrow(AccrualInputError);
    expect(() =>
      accrualAmount({
        ...base,
        paymentAmount: '1',
        assetUsdPrice: '1',
        utlUsdRate: '0',
      }),
    ).toThrow(/greater than zero/);
    expect(() =>
      accrualAmount({
        ...base,
        asset: 'DOGE',
        paymentAmount: '1',
        assetUsdPrice: '1',
      }),
    ).toThrow(/No decimals known/);
  });
});

describe('toWad / decimalsFor', () => {
  it('normalises each asset from its own precision to 18', () => {
    expect(decimalsFor('USDT')).toBe(6);
    expect(decimalsFor('BTC')).toBe(8);
    expect(toWad('1', 6)).toBe(10n ** 18n);
    expect(toWad('0.000001', 6)).toBe(10n ** 12n);
    expect(toWad('0.00000001', 8)).toBe(10n ** 10n);
  });
});

describe('generateCouponCode', () => {
  it('is unguessable from anything the user can see', () => {
    const codes = new Set(Array.from({ length: 5000 }, generateCouponCode));
    expect(codes.size).toBe(5000); // no collisions, no sequence
  });

  it('uses a human-safe alphabet in fixed-width groups', () => {
    for (let i = 0; i < 200; i++) {
      // No I, L, O or U: nothing a person can misread into another valid code.
      expect(generateCouponCode()).toMatch(
        /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/,
      );
    }
  });
});
