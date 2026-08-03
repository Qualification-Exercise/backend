import { privateKeyToAccount } from 'viem/accounts';

import {
  InvalidAddressError,
  UnsupportedProofError,
  normalizeAddress,
  claimMessage,
  verifyOwnership,
} from '@/wallets/address';

const account = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const other = privateKeyToAccount(
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
);

describe('normalizeAddress', () => {
  it('checksums EVM addresses so case can never split a lookup', () => {
    const lower = account.address.toLowerCase();
    expect(normalizeAddress(lower)).toEqual({
      family: 'EVM',
      address: account.address,
    });
    expect(
      normalizeAddress(account.address.toUpperCase().replace('0X', '0x')),
    ).toEqual({ family: 'EVM', address: account.address });
  });

  it('keeps Tron base58check canonical and converts the hex form', () => {
    const base58 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const hex = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';
    expect(normalizeAddress(base58)).toEqual({
      family: 'TRON',
      address: base58,
    });
    expect(normalizeAddress(hex)).toEqual({ family: 'TRON', address: base58 });
    expect(normalizeAddress(`0x${hex}`)).toEqual({
      family: 'TRON',
      address: base58,
    });
  });

  it('lower-cases bech32 but never re-cases base58check', () => {
    const bech32 = 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4';
    expect(normalizeAddress(bech32)).toEqual({
      family: 'BTC',
      address: bech32.toLowerCase(),
    });

    const p2pkh = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
    expect(normalizeAddress(p2pkh)).toEqual({ family: 'BTC', address: p2pkh });
  });

  it('classifies Spark bech32m addresses and lower-cases them', () => {
    const spark =
      'spark1pgss82uvuvyjggx72gl42qk3285yz0j6lgxw9uk2mvgajsr8w22nudv8w6hqs2';
    expect(normalizeAddress(spark)).toEqual({
      family: 'SPARK',
      address: spark,
    });
    expect(normalizeAddress(spark.toUpperCase())).toEqual({
      family: 'SPARK',
      address: spark,
    });
  });

  it('rejects garbage and bad checksums', () => {
    expect(() => normalizeAddress('not-an-address')).toThrow(
      InvalidAddressError,
    );
    expect(() => normalizeAddress('0x1234')).toThrow(InvalidAddressError);
    expect(() =>
      normalizeAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'),
    ).toThrow(InvalidAddressError);
  });
});

describe('verifyOwnership', () => {
  const message = claimMessage('0xdeadbeef', 'AAAA-BBBB-CCCC-DDDD');

  it('accepts a signature from the address itself', async () => {
    const signature = await account.signMessage({ message });
    await expect(
      verifyOwnership(account.address, message, signature),
    ).resolves.toBe(true);
  });

  it('accepts the same signature via a differently-cased address', async () => {
    const signature = await account.signMessage({ message });
    await expect(
      verifyOwnership(account.address.toLowerCase(), message, signature),
    ).resolves.toBe(true);
  });

  it('rejects a foreign signature', async () => {
    const signature = await other.signMessage({ message });
    await expect(
      verifyOwnership(account.address, message, signature),
    ).resolves.toBe(false);
  });

  it('rejects an unparseable signature instead of throwing', async () => {
    const garbage = `0x${'ab'.repeat(65)}` as const;
    await expect(
      verifyOwnership(account.address, message, garbage),
    ).resolves.toBe(false);
  });

  it('rejects a valid signature over a different nonce', async () => {
    const signature = await account.signMessage({
      message: claimMessage('0xfeedface', 'AAAA-BBBB-CCCC-DDDD'),
    });
    await expect(
      verifyOwnership(account.address, message, signature),
    ).resolves.toBe(false);
  });

  it('verifies Tron addresses through the same secp256k1 recovery', async () => {
    const signature = await account.signMessage({ message });
    const { address: tron } = normalizeAddress(`41${account.address.slice(2)}`);

    await expect(verifyOwnership(tron, message, signature)).resolves.toBe(true);

    const foreign = await other.signMessage({ message });
    await expect(verifyOwnership(tron, message, foreign)).resolves.toBe(false);
  });

  it('refuses Bitcoin proofs loudly instead of accepting them unproven', async () => {
    const signature = await account.signMessage({ message });
    await expect(
      verifyOwnership('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', message, signature),
    ).rejects.toThrow(UnsupportedProofError);
  });
});

describe('ownershipMessage', () => {
  it('binds the nonce and names the app, so a stray signature is not a proof', () => {
    expect(claimMessage('0xabc', 'AAAA-BBBB-CCCC-DDDD')).toContain(
      'WDK Cashback',
    );
    expect(claimMessage('0xabc', 'AAAA-BBBB-CCCC-DDDD')).toContain(
      'Nonce: 0xabc',
    );
    expect(claimMessage('0xabc', 'AAAA-BBBB-CCCC-DDDD')).toContain(
      'Coupon: AAAA-BBBB-CCCC-DDDD',
    );
    expect(claimMessage('0xabc', 'AAAA-BBBB-CCCC-DDDD')).not.toBe(
      claimMessage('0xabd', 'AAAA-BBBB-CCCC-DDDD'),
    );
  });
});
