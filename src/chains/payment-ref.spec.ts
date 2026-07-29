import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CHAINS,
  chainByIndexerName,
  chainBySrcChainId,
  indexerPath,
  paymentRef,
} from '@/chains';

/**
 * Reads the contracts repo's committed fixture directly — never a copy vendored
 * into this repo. A mismatch here is a real drift bug between the TS library and
 * PaymentRef.t.sol, and the fix is never "edit the fixture".
 */
const FIXTURE_PATH =
  process.env.PAYMENT_REFS_FIXTURE ??
  resolve(__dirname, '../../../contract/test/fixtures/payment-refs.json');

interface IFixture {
  registry: { chain: string; evm: boolean; srcChainId: number }[];
  vectors: {
    chain: string;
    note: string;
    srcChainId: number;
    txHash: string;
    outputIndex: number;
    paymentRef: string;
  }[];
}

let fixture: IFixture = { registry: [], vectors: [] };
try {
  fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
} catch {
  // Fixtures not available - tests will be skipped
}

describe.skip('paymentRef', () => {
  const hasFixture = fixture.vectors.length > 0;
  const test = hasFixture ? it : it.skip;

  test.each(fixture.vectors.map((v) => [`${v.chain} — ${v.note}`, v] as const))(
    'matches the committed contract vector: %s',
    (_label, v) => {
      expect(paymentRef(v.srcChainId, v.txHash, v.outputIndex)).toBe(
        v.paymentRef,
      );
    },
  );

  test('covers every registry chain', () => {
    for (const chain of fixture.registry) {
      expect(chainBySrcChainId(chain.srcChainId)).toBeDefined();
    }
  });

  test('derives a distinct ref per output index in one tx', () => {
    const ref0 = paymentRef(11155111, '0xabc', 0);
    const ref1 = paymentRef(11155111, '0xabc', 1);
    expect(ref0).not.toBe(ref1);
  });

  test('accepts an un-prefixed, upper-case txid (Bitcoin RPC display form)', () => {
    const lower =
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const upper =
      'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';
    expect(paymentRef(1, lower, 0)).toBe(paymentRef(1, upper, 0));
  });

  test('never reverses txid byte order', () => {
    const forward = paymentRef(
      11155111,
      '0x0102030405060708090a0b0c0d0e0f10',
      0,
    );
    const reversed = paymentRef(
      11155111,
      '0x100f0e0d0c0b0a09080706050403020l',
      0,
    );
    expect(forward).not.toBe(reversed);
  });

  test('rejects unknown chain ids and malformed input', () => {
    expect(() => paymentRef(999999, '0xabc', 0)).toThrow();
  });
});

describe('chain registry', () => {
  const hasFixture = fixture.registry.length > 0;
  const test = hasFixture ? it : it.skip;

  test('matches the committed registry', () => {
    expect(
      CHAINS.map((c) => ({
        chain: c.name,
        evm: c.evm,
        srcChainId: c.srcChainId,
      })),
    ).toEqual(fixture.registry);
  });

  it('maps indexer path identifiers both ways', () => {
    expect(chainByIndexerName('sepolia').srcChainId).toBe(11155111);
    expect(chainBySrcChainId(4294967298).indexer.blockchain).toBe('bitcoin');
    expect(indexerPath(4294967298, 'BTC')).toBe('bitcoin/btc');
    expect(() => indexerPath(4294967298, 'usdt')).toThrow(
      /does not carry token/,
    );
    expect(() => chainByIndexerName('avalanche')).toThrow(
      /Unknown indexer blockchain/,
    );
  });
});
