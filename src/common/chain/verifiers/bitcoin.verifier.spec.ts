import { of, throwError } from 'rxjs';

import { paymentRef } from '@/chains';
import { BitcoinPaymentVerifier } from '@/common/chain/verifiers/bitcoin.verifier';
import type { Payment } from '@/payments/entities/payment.entity';

const BITCOIN = 4294967298;
const BASE = 'https://issuer-a.esplora.example';
const TXID = 'd1f0c9b8a7e6d5c4b3a2918f7e6d5c4b3a2918f7e6d5c4b3a2918f7e6d5c4b3a';
const BLOCK = 900_000;
const MERCHANT = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

function payment(over: Partial<Payment> = {}): Payment {
  return {
    paymentRef: paymentRef(BITCOIN, `0x${TXID}`, 1),
    srcChainId: BITCOIN,
    txHash: TXID,
    outputIndex: 1,
    blockNumber: BLOCK,
    token: 'btc',
    amount: '0.0005',
    fromAddress: 'bc1qpayer',
    merchantAddress: MERCHANT,
    ...over,
  } as Payment;
}

interface IWorld {
  tx?: Record<string, unknown>;
  tip?: number;
  txThrows?: boolean;
}

function build(world: IWorld = {}) {
  const http = {
    get: jest.fn((url: string) => {
      if (url.endsWith('/blocks/tip/height')) {
        return of({ data: world.tip ?? BLOCK + 5 });
      }
      if (world.txThrows) return throwError(() => new Error('404'));
      return of({
        data: world.tx ?? {
          txid: TXID,
          status: { confirmed: true, block_height: BLOCK },
          vout: [
            { scriptpubkey_address: 'bc1qchange', value: 12_345 },
            // 0.0005 BTC = 50 000 sats, at vout 1
            { scriptpubkey_address: MERCHANT, value: 50_000 },
          ],
        },
      });
    }),
  };
  return new BitcoinPaymentVerifier(http as never);
}

describe('BitcoinPaymentVerifier', () => {
  it('accepts an output its own Esplora endpoint confirms', async () => {
    await expect(
      build().verify(payment(), [MERCHANT], BASE, 3),
    ).resolves.toBeUndefined();
  });

  it('refuses a transaction the node has never seen', async () => {
    await expect(
      build({ txThrows: true }).verify(payment(), [MERCHANT], BASE, 3),
    ).rejects.toThrow(/RECEIPT_UNAVAILABLE/);
  });

  it('refuses an unconfirmed transaction', async () => {
    const verifier = build({
      tx: { txid: TXID, status: { confirmed: false }, vout: [] },
    });
    await expect(
      verifier.verify(payment(), [MERCHANT], BASE, 3),
    ).rejects.toThrow(/UNCONFIRMED/);
  });

  it('refuses a payment that is not buried deep enough', async () => {
    await expect(
      build({ tip: BLOCK }).verify(payment(), [MERCHANT], BASE, 3),
    ).rejects.toThrow(/TOO_SHALLOW/);
  });

  it('refuses a vout that does not exist', async () => {
    await expect(
      build().verify(
        payment({
          outputIndex: 7,
          paymentRef: paymentRef(BITCOIN, `0x${TXID}`, 7),
        }),
        [MERCHANT],
        BASE,
        3,
      ),
    ).rejects.toThrow(/NO_SUCH_OUTPUT/);
  });

  it('refuses an output paid to someone who is not a merchant', async () => {
    await expect(
      build().verify(
        payment({
          outputIndex: 0,
          paymentRef: paymentRef(BITCOIN, `0x${TXID}`, 0),
        }),
        [MERCHANT],
        BASE,
        3,
      ),
    ).rejects.toThrow(/NOT_A_MERCHANT/);
  });

  it('refuses an amount that differs from the row', async () => {
    await expect(
      build().verify(payment({ amount: '0.001' }), [MERCHANT], BASE, 3),
    ).rejects.toThrow(/AMOUNT_MISMATCH/);
  });
});
