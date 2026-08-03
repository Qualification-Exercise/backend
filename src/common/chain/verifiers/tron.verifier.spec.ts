import { of, throwError } from 'rxjs';

import { paymentRef } from '@/chains';
import { TronPaymentVerifier } from '@/common/chain/verifiers/tron.verifier';
import type { Payment } from '@/payments/entities/payment.entity';
import { tronAddressFromHex } from '@/wallets/address';

const TRON = 4294967297;
const BASE = 'https://issuer-a.trongrid.example';
const TX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const BLOCK = 60_000_000;

// TronGrid hands topics back as 32-byte hex; the address is the last 20 bytes.
const topic = (hex20: string) => '0'.repeat(24) + hex20;
const PAYER_HEX = '0981cd7e9f4d51c752546b49b78f6d77412de8a0';
const MERCHANT_HEX = '70997970c51812dc3a010c7d01b50e0d17dc79c8';
const TOKEN_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c'; // USD₮ on Tron
const PAYER = tronAddressFromHex(PAYER_HEX);
const MERCHANT = tronAddressFromHex(MERCHANT_HEX);
const TOKEN = tronAddressFromHex(TOKEN_HEX);

const TRANSFER =
  'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function payment(over: Partial<Payment> = {}): Payment {
  return {
    paymentRef: paymentRef(TRON, `0x${TX}`, 0),
    srcChainId: TRON,
    txHash: TX,
    outputIndex: 0,
    blockNumber: BLOCK,
    token: 'usdt',
    amount: '1.5',
    fromAddress: PAYER,
    merchantAddress: MERCHANT,
    ...over,
  } as Payment;
}

interface IWorld {
  info?: Record<string, unknown>;
  head?: number;
  txThrows?: boolean;
}

function build(world: IWorld = {}) {
  const http = {
    post: jest.fn((url: string) => {
      if (url.endsWith('/wallet/getnowblock')) {
        return of({
          data: {
            block_header: { raw_data: { number: world.head ?? BLOCK + 30 } },
          },
        });
      }
      if (world.txThrows) return throwError(() => new Error('not found'));
      return of({
        data: world.info ?? {
          id: TX,
          blockNumber: BLOCK,
          receipt: { result: 'SUCCESS' },
          log: [
            {
              address: TOKEN_HEX,
              topics: [TRANSFER, topic(PAYER_HEX), topic(MERCHANT_HEX)],
              // 1.5 USD₮ at 6 decimals
              data: (1_500_000).toString(16),
            },
          ],
        },
      });
    }),
  };
  return new TronPaymentVerifier(http as never);
}

describe('TronPaymentVerifier', () => {
  it('accepts a transfer its own TronGrid endpoint confirms', async () => {
    await expect(
      build().verify(payment(), [MERCHANT], BASE, 20, TOKEN),
    ).resolves.toBeUndefined();
  });

  it('refuses a transaction the node has never seen', async () => {
    await expect(
      build({ txThrows: true }).verify(payment(), [MERCHANT], BASE, 20, TOKEN),
    ).rejects.toThrow(/RECEIPT_UNAVAILABLE/);
  });

  it('refuses a failed transaction', async () => {
    const verifier = build({
      info: {
        id: TX,
        blockNumber: BLOCK,
        receipt: { result: 'REVERT' },
        log: [],
      },
    });
    await expect(
      verifier.verify(payment(), [MERCHANT], BASE, 20, TOKEN),
    ).rejects.toThrow(/TX_REVERTED/);
  });

  it('refuses a payment that is not buried deep enough', async () => {
    await expect(
      build({ head: BLOCK + 2 }).verify(payment(), [MERCHANT], BASE, 20, TOKEN),
    ).rejects.toThrow(/TOO_SHALLOW/);
  });

  it('refuses a log from another TRC-20 contract', async () => {
    await expect(
      build().verify(
        payment(),
        [MERCHANT],
        BASE,
        20,
        tronAddressFromHex('41' + '11'.repeat(20)),
      ),
    ).rejects.toThrow(/WRONG_TOKEN_CONTRACT/);
  });

  it('refuses a transfer to an address no merchant registered', async () => {
    const stranger = tronAddressFromHex('41' + '22'.repeat(20));
    await expect(
      build().verify(
        payment({ merchantAddress: stranger }),
        [stranger],
        BASE,
        20,
        TOKEN,
      ),
    ).rejects.toThrow(/NOT_A_MERCHANT|MERCHANT_MISMATCH/);
  });

  it('refuses an amount that differs from the row', async () => {
    await expect(
      build().verify(payment({ amount: '2' }), [MERCHANT], BASE, 20, TOKEN),
    ).rejects.toThrow(/AMOUNT_MISMATCH/);
  });

  it('refuses when no TRC-20 contract is configured', async () => {
    await expect(
      build().verify(payment(), [MERCHANT], BASE, 20, null),
    ).rejects.toThrow(/UNKNOWN_TOKEN/);
  });
});
