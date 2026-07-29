import { randomBytes } from 'node:crypto';

export const WAD = 10n ** 18n;
export const BPS_DENOMINATOR = 10_000n;

export const ASSET_DECIMALS: Record<string, number> = {
  USDT: 6,
  BTC: 8,
  XAUT: 6,
  ETH: 18,
};

export class AccrualInputError extends Error {}

export function decimalsFor(asset: string): number {
  const decimals = ASSET_DECIMALS[asset];
  if (decimals === undefined) {
    throw new AccrualInputError(`No decimals known for asset ${asset}`);
  }
  return decimals;
}

export function toScaled(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) {
    throw new AccrualInputError(`Not a non-negative decimal: ${value}`);
  }
  const [whole, fraction = ''] = value.trim().split('.');
  const truncated = fraction.slice(0, decimals).padEnd(decimals, '0');
  return BigInt(whole + (decimals > 0 ? truncated : ''));
}

export function toWad(value: string, decimals: number): bigint {
  if (decimals > 18) {
    throw new AccrualInputError(`Asset precision ${decimals} exceeds 18`);
  }
  return toScaled(value, decimals) * 10n ** BigInt(18 - decimals);
}

export interface IAccrualInput {
  paymentAmount: string;
  asset: string;
  assetUsdPrice: string;
  utlUsdRate: string;
  cashbackBps: number;
}

export function accrualAmount(input: IAccrualInput): string {
  const { paymentAmount, asset, assetUsdPrice, utlUsdRate, cashbackBps } =
    input;

  if (!Number.isInteger(cashbackBps) || cashbackBps < 0) {
    throw new AccrualInputError(`cashbackBps must be a non-negative integer`);
  }


  const amountWad = toWad(paymentAmount, decimalsFor(asset));
  const priceWad = toWad(assetUsdPrice, 18);
  const rateWad = toWad(utlUsdRate, 18);

  if (rateWad === 0n) {
    throw new AccrualInputError('utlUsdRate must be greater than zero');
  }

  const numerator = amountWad * priceWad * BigInt(cashbackBps);
  const denominator = BPS_DENOMINATOR * rateWad;
  return (numerator / denominator).toString();
}

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 16;

export function generateCouponCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code.match(/.{4}/g)!.join('-');
}
