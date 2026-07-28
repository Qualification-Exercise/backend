import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CHAINS,
  chainByIndexerName,
  chainBySrcChainId,
  indexerPath,
  normalizeTxHash,
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

const fixture: IFixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

describe('paymentRef', () => {
  it.each(fixture.vectors.map((v) => [`${v.chain} — ${v.note}`, v] as const))(
    'matches the committed contract vector: %s',
    (_label, v) => {
      expect(paymentRef(v.srcChainId, v.txHash, v.outputIndex)).toBe(
        v.paymentRef,
      );
    },
  );

  it('covers every registry chain', () => {
    const covered = new Set(fixture.vectors.map((v) => v.srcChainId));
    expect([...covered].sort()).toEqual(CHAINS.map((c) => c.srcChainId).sort());
  });

  it('derives a distinct ref per output index in one tx', () => {
    const { srcChainId, txHash } = fixture.vectors[0];
    expect(paymentRef(srcChainId, txHash, 0)).not.toBe(
      paymentRef(srcChainId, txHash, 1),
    );
  });

  it('accepts an un-prefixed, upper-case txid (Bitcoin RPC display form)', () => {
    const btc = fixture.vectors.find((v) => v.chain === 'Bitcoin')!;
    const bare = btc.txHash.slice(2).toUpperCase();
    expect(paymentRef(btc.srcChainId, bare, btc.outputIndex)).toBe(
      btc.paymentRef,
    );
  });

  it('never reverses txid byte order', () => {
    const btc = fixture.vectors.find((v) => v.chain === 'Bitcoin')!;
    const reversed = `0x${(btc.txHash.slice(2).match(/../g) ?? []).reverse().join('')}`;
    expect(paymentRef(btc.srcChainId, reversed, btc.outputIndex)).not.toBe(
      btc.paymentRef,
    );
    expect(normalizeTxHash(btc.txHash)).toBe(btc.txHash.toLowerCase());
  });

  it('rejects unknown chain ids and malformed input', () => {
    expect(() => paymentRef(1, fixture.vectors[0].txHash, 0)).toThrow(
      /Unknown srcChainId/,
    );
    expect(() => paymentRef(11155111, '0xdeadbeef', 0)).toThrow(
      /32 bytes of hex/,
    );
    expect(() => paymentRef(11155111, fixture.vectors[0].txHash, -1)).toThrow(
      /non-negative/,
    );
  });
});

describe('chain registry', () => {
  it('matches the committed registry', () => {
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
