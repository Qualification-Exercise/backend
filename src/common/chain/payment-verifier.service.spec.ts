import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  type Hex,
} from 'viem';

import { paymentRef } from '@/chains';
import type { IChainViewConfig } from '@/common/chain/chain-view.config';
import {
  PaymentVerifierService,
  VerificationError,
} from '@/common/chain/payment-verifier.service';
import type { Payment } from '@/payments/entities/payment.entity';

const SEPOLIA = 11155111;
const TOKEN = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const MERCHANT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const PAYER = '0x0981cd7e9f4d51c752546B49b78F6d77412de8A0';
const TX = '0x9c1e5b3d2a7f4e8c0b6d1a3f5e7c9b2d4a6f8e0c1b3d5a7f9e2c4b6d8a0f1e3c';
const BLOCK = 100;
const BLOCK_HASH =
  '0xaaaa000000000000000000000000000000000000000000000000000000000001';

const TRANSFER_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

function transferLog(
  over: { from?: string; to?: string; value?: bigint; address?: string } = {},
) {
  const topics = encodeEventTopics({
    abi: TRANSFER_ABI,
    eventName: 'Transfer',
    args: {
      from: (over.from ?? PAYER) as Hex,
      to: (over.to ?? MERCHANT) as Hex,
    },
  });
  return {
    logIndex: 3,
    address: (over.address ?? TOKEN) as Hex,
    topics,
    data: encodeAbiParameters(
      [{ type: 'uint256' }],
      [over.value ?? 10_000n], // 0.01 USDt, 6 decimals
    ),
  };
}

function payment(over: Partial<Payment> = {}): Payment {
  return {
    paymentRef: paymentRef(SEPOLIA, TX, 3),
    srcChainId: SEPOLIA,
    txHash: TX,
    outputIndex: 3,
    blockNumber: BLOCK,
    token: 'usdt',
    amount: '0.01',
    fromAddress: PAYER,
    merchantAddress: MERCHANT,
    ...over,
  } as Payment;
}

function build(
  chain: {
    receipt?: Record<string, unknown>;
    blockHash?: string;
    head?: number;
    receiptThrows?: boolean;
  } = {},
) {
  const config = {
    id: 'issuer-a',
    rpcUrl: 'https://issuer-a.example/rpc',
    tokenAddress: () => TOKEN,
  } as unknown as IChainViewConfig;

  const verifier = new PaymentVerifierService(config, {
    depthFor: () => 12,
  } as never);

  const client = {
    getTransactionReceipt: async () => {
      if (chain.receiptThrows) throw new Error('not found');
      return (
        chain.receipt ?? {
          status: 'success',
          blockNumber: BigInt(BLOCK),
          blockHash: BLOCK_HASH,
          logs: [transferLog()],
        }
      );
    },
    getBlock: async () => ({ hash: chain.blockHash ?? BLOCK_HASH }),
    getBlockNumber: async () => BigInt(chain.head ?? BLOCK + 20),
  };
  (verifier as unknown as { client: unknown }).client = client;

  return verifier;
}

const MERCHANTS = [MERCHANT];

describe('PaymentVerifierService', () => {
  it('accepts a payment its own node confirms', async () => {
    await expect(build().verify(payment(), MERCHANTS)).resolves.toBeUndefined();
  });

  it('refuses when the row and the derived paymentRef disagree', async () => {
    await expect(
      build().verify(payment({ paymentRef: '0xdead' }), MERCHANTS),
    ).rejects.toThrow(/PAYMENT_REF_MISMATCH/);
  });

  it('refuses a receipt its node has never seen', async () => {
    await expect(
      build({ receiptThrows: true }).verify(payment(), MERCHANTS),
    ).rejects.toThrow(/RECEIPT_UNAVAILABLE/);
  });

  it('refuses a block that is no longer canonical', async () => {
    await expect(
      build({ blockHash: '0xbbbb' }).verify(payment(), MERCHANTS),
    ).rejects.toThrow(/REORG/);
  });

  it('refuses a payment that is not buried deep enough', async () => {
    await expect(
      build({ head: BLOCK + 2 }).verify(payment(), MERCHANTS),
    ).rejects.toThrow(/TOO_SHALLOW/);
  });

  it('refuses a transfer whose amount differs from the row', async () => {
    const verifier = build({
      receipt: {
        status: 'success',
        blockNumber: BigInt(BLOCK),
        blockHash: BLOCK_HASH,
        logs: [transferLog({ value: 999_999n })],
      },
    });
    await expect(verifier.verify(payment(), MERCHANTS)).rejects.toThrow(
      /AMOUNT_MISMATCH/,
    );
  });

  it('refuses a transfer to an address no merchant registered', async () => {
    const stranger = '0x2222222222222222222222222222222222222222';
    const verifier = build({
      receipt: {
        status: 'success',
        blockNumber: BigInt(BLOCK),
        blockHash: BLOCK_HASH,
        logs: [transferLog({ to: stranger })],
      },
    });
    await expect(
      verifier.verify(payment({ merchantAddress: stranger }), MERCHANTS),
    ).rejects.toThrow(/NOT_A_MERCHANT/);
  });

  it('refuses a log emitted by some other contract', async () => {
    const verifier = build({
      receipt: {
        status: 'success',
        blockNumber: BigInt(BLOCK),
        blockHash: BLOCK_HASH,
        logs: [
          transferLog({
            address: '0x3333333333333333333333333333333333333333',
          }),
        ],
      },
    });
    await expect(verifier.verify(payment(), MERCHANTS)).rejects.toThrow(
      /WRONG_TOKEN_CONTRACT/,
    );
  });

  it('refuses a reverted transaction', async () => {
    const verifier = build({
      receipt: {
        status: 'reverted',
        blockNumber: BigInt(BLOCK),
        blockHash: BLOCK_HASH,
        logs: [],
      },
    });
    await expect(verifier.verify(payment(), MERCHANTS)).rejects.toThrow(
      /TX_REVERTED/,
    );
  });

  it('refuses to guess about a chain it has no node for', async () => {
    await expect(
      build().verify(payment({ srcChainId: 4294967298 }), MERCHANTS),
    ).rejects.toThrow(VerificationError);
  });
});
