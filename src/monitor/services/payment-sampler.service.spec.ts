import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { paymentRef } from '@/chains';
import { AlertService, EAlertSeverity } from '@/common/alerts/alert.service';
import { PaymentVerifierService } from '@/common/chain/payment-verifier.service';
import { MonitorConfig } from '@/monitor/monitor-config';
import { PaymentSamplerService } from '@/monitor/services/payment-sampler.service';
import { EventCursorEntity } from '@/common/chain/event-cursor.entity';
import { Merchant } from '@/payments/entities/merchant.entity';
import { Payment } from '@/payments/entities/payment.entity';

const CHAIN = 1;
const MERCHANT_ADDRESS = '0x1234567890123456789012345678901234567890';
const TOKEN = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const TX_HASH = `0x${'cd'.repeat(32)}`;

const getBlockNumber = jest.fn(async () => 21_000_000n);
const getLogs = jest.fn(async () => [] as unknown[]);
const cursorUpsert = jest.fn(async () => undefined);

jest.mock('viem', () => ({
  ...jest.requireActual('viem'),
  createPublicClient: jest.fn(() => ({ getBlockNumber, getLogs })),
  http: jest.fn(() => 'transport'),
}));

const payment = (over: Partial<Payment> = {}): Payment =>
  ({
    id: 'pay-1',
    paymentRef: '0xref-1',
    srcChainId: CHAIN,
    txHash: TX_HASH,
    outputIndex: 7,
    merchantAddress: MERCHANT_ADDRESS,
    status: 'confirmed',
    ...over,
  }) as Payment;

const merchant = (over: Partial<Merchant> = {}): Merchant =>
  ({
    id: 'm-1',
    name: 'qa-merchant',
    srcChainId: CHAIN,
    address: MERCHANT_ADDRESS,
    token: 'usdt',
    active: true,
    ...over,
  }) as Merchant;

async function build(
  options: {
    payments?: Payment[];
    merchants?: Merchant[];
    known?: Payment | null;
    verifyError?: unknown;
    logs?: unknown[];
    rpcUrl?: string | null;
    token?: string | null;
    cursorBlock?: number;
  } = {},
) {
  getBlockNumber.mockClear();
  getLogs.mockClear();
  getLogs.mockResolvedValue(options.logs ?? []);

  cursorUpsert.mockClear();
  const alerts = { raise: jest.fn(async () => undefined) };
  const verifier = {
    verify: jest.fn(async () => {
      if (options.verifyError) throw options.verifyError;
      return undefined;
    }),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      PaymentSamplerService,
      {
        provide: MonitorConfig,
        useValue: {
          chains: [CHAIN],
          sampleSize: 25,
          rpcUrlFor: jest.fn(() =>
            options.rpcUrl === undefined
              ? 'https://monitor.example/rpc'
              : options.rpcUrl,
          ),
          tokenAddress: jest.fn(() =>
            options.token === undefined ? TOKEN : options.token,
          ),
        },
      },
      { provide: AlertService, useValue: alerts },
      { provide: PaymentVerifierService, useValue: verifier },
      {
        provide: getRepositoryToken(Payment),
        useValue: {
          find: jest.fn(async () => options.payments ?? []),
          findOne: jest.fn(async () =>
            options.known === undefined ? null : options.known,
          ),
        },
      },
      {
        provide: getRepositoryToken(Merchant),
        useValue: { find: jest.fn(async () => options.merchants ?? []) },
      },
      {
        provide: getRepositoryToken(EventCursorEntity),
        useValue: {
          findOne: jest.fn(async () =>
            options.cursorBlock === undefined
              ? null
              : { name: 'c', lastBlock: options.cursorBlock },
          ),
          upsert: cursorUpsert,
        },
      },
    ],
  }).compile();

  return {
    service: moduleRef.get(PaymentSamplerService),
    alerts,
    verifier,
    cursorUpsert,
  };
}

describe('PaymentSamplerService — payments the indexer reported', () => {
  it('stays quiet when its own node confirms the sample', async () => {
    const { service, alerts, verifier } = await build({
      payments: [payment()],
      merchants: [merchant()],
    });

    await service.check();

    expect(verifier.verify).toHaveBeenCalledWith(payment(), [MERCHANT_ADDRESS]);
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('raises a critical alert for a payment the chain does not show', async () => {
    const { service, alerts } = await build({
      payments: [payment()],
      merchants: [merchant()],
      verifyError: new Error('no such log'),
    });

    await service.check();

    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'monitor.payment_not_on_chain',
        severity: EAlertSeverity.CRITICAL,
        subject: '0xref-1',
        message: expect.stringContaining('no such log'),
      }),
    );
  });

  it('reports a non-Error rejection without losing it', async () => {
    const { service, alerts } = await build({
      payments: [payment()],
      merchants: [merchant()],
      verifyError: 'plain string failure',
    });

    await service.check();

    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('plain string failure'),
      }),
    );
  });
});

describe('PaymentSamplerService — payments the indexer never reported', () => {
  const log = (over: Record<string, unknown> = {}) => ({
    transactionHash: TX_HASH,
    logIndex: 7,
    blockNumber: 20_999_999n,
    ...over,
  });

  it('alerts on a merchant transfer that is on-chain but not in our database', async () => {
    const { service, alerts } = await build({
      merchants: [merchant()],
      logs: [log()],
      known: null,
    });

    await service.check();
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'monitor.payment_not_indexed',
        severity: EAlertSeverity.ERROR,
        subject: paymentRef(CHAIN, TX_HASH, 7),
        context: expect.objectContaining({
          merchant: MERCHANT_ADDRESS,
          logIndex: 7,
          blockNumber: '20999999',
        }),
      }),
    );
  });

  it('stays quiet for a transfer already stored', async () => {
    const { service, alerts } = await build({
      merchants: [merchant()],
      logs: [log()],
      known: payment(),
    });

    await service.check();

    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('scans the last 500 blocks up to the head', async () => {
    const { service } = await build({ merchants: [merchant()] });

    await service.check();

    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: TOKEN,
        fromBlock: 20_999_500n,
        toBlock: 21_000_000n,
      }),
    );
  });

  it('resumes from the stored cursor instead of rescanning the window', async () => {
    const { service, cursorUpsert } = await build({
      merchants: [merchant()],
      cursorBlock: 20_999_900,
    });

    await service.check();

    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlock: 20_999_901n,
        toBlock: 21_000_000n,
      }),
    );
    expect(cursorUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ lastBlock: 21_000_000 }),
      expect.anything(),
    );
  });

  it('starts from the genesis block on a chain shorter than the lookback', async () => {
    getBlockNumber.mockResolvedValueOnce(200n);
    const { service } = await build({ merchants: [merchant()] });

    await service.check();

    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 0n, toBlock: 200n }),
    );
  });

  it('skips a log with no transaction hash or index', async () => {
    const { service, alerts } = await build({
      merchants: [merchant()],
      logs: [log({ transactionHash: null }), log({ logIndex: null })],
    });

    await service.check();

    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('skips merchants on chains the monitor has no node for', async () => {
    const { service } = await build({
      merchants: [merchant()],
      rpcUrl: null,
    });

    await service.check();

    expect(getLogs).not.toHaveBeenCalled();
  });

  it('skips a merchant whose token address is unknown', async () => {
    const { service } = await build({ merchants: [merchant()], token: null });

    await service.check();

    expect(getLogs).not.toHaveBeenCalled();
  });
});
