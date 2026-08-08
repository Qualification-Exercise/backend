import { ConfigService } from '@nestjs/config';

import { EClaimFailureReason } from '@/claims/enums/claim-status.enum';
import { EAlertSeverity } from '@/common/alerts/alert.service';
import { SettlementWatcherService } from '@/settlements/services/settlement-watcher.service';

const CONTRACT = '0x5Dfc68FD44CCD83DD10cF5aA4B060AAe1602fb13';
const PAYMENT_REF = `0x${'ab'.repeat(32)}`;
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const CLAIM = {
  id: 'clm-1',
  recipient: RECIPIENT,
  amount: '5000000000000000000',
  deadline: Math.floor(Date.now() / 1000) + 3600,
  txHash: '0xsubmitted',
  updatedAt: new Date(Date.now() - 60 * 60_000),
  coupon: { paymentRef: PAYMENT_REF },
};

interface IWorld {
  logs?: unknown[];
  claim?: typeof CLAIM | null;
  overdue?: (typeof CLAIM)[];
  cursorBlock?: number;
}

function build(world: IWorld = {}) {
  const config = {
    get: (key: string) =>
      ({
        SETTLEMENT_RPC_URL: 'https://watcher.example/rpc',
        COUPON_CLAIM_CONTRACT_ADDRESS: CONTRACT,
        SETTLEMENT_POLL_INTERVAL_MS: 0,
        SETTLEMENT_CONFIRMATIONS: 5,
        SETTLEMENT_BLOCK_RANGE: 2000,
        SETTLEMENT_TIMEOUT_MS: 900_000,
        SETTLEMENT_START_BLOCK: 100,
      })[key],
  } as unknown as ConfigService;

  const claims = {
    markClaimed: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
  };
  const alerts = { raise: jest.fn().mockResolvedValue(undefined) };
  const settlements = { insert: jest.fn().mockResolvedValue(undefined) };
  const cursors = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        world.cursorBlock === undefined
          ? null
          : { lastBlock: world.cursorBlock },
      ),
    save: jest.fn().mockResolvedValue(undefined),
  };

  const qb = {
    innerJoinAndSelect: () => qb,
    where: () => qb,
    getOne: async () => (world.claim === undefined ? CLAIM : world.claim),
  };
  const claimRepo = {
    createQueryBuilder: () => qb,
    find: async () => world.overdue ?? [],
  };

  const service = new SettlementWatcherService(
    claims as never,
    alerts as never,
    claimRepo as never,
    settlements as never,
    cursors as never,
    config as never,
  );

  (service as unknown as { clients: { get: () => unknown } }).clients = {
    get: () => ({
      getBlockNumber: async () => 1_000n,
      getLogs: async () => world.logs ?? [],
      getBlock: async () => ({ timestamp: 1_785_000_000n }),
    }),
  };
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

  return { service, claims, alerts, settlements, cursors };
}

const claimedLog = (over: Record<string, unknown> = {}) => ({
  args: {
    paymentRef: PAYMENT_REF,
    recipient: RECIPIENT,
    amount: 5_000_000_000_000_000_000n,
  },
  transactionHash: '0xsettled',
  blockNumber: 900n,
  ...over,
});

describe('SettlementWatcherService', () => {
  it('matches a Claimed event to its claim and marks it settled', async () => {
    const { service, claims, settlements, cursors } = build({
      logs: [claimedLog()],
    });

    await service.tick();

    expect(settlements.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentRef: PAYMENT_REF,
        txHash: '0xsettled',
        blockNumber: 900,
      }),
    );
    expect(claims.markClaimed).toHaveBeenCalledWith('clm-1');
    // Cursor stops short of the head so a reorg cannot settle a claim twice.
    expect(cursors.save).toHaveBeenCalledWith(
      expect.objectContaining({ lastBlock: 995 }),
    );
  });

  it('raises a critical alert for a paymentRef the database has never seen', async () => {
    const { service, alerts, claims } = build({
      logs: [claimedLog()],
      claim: null,
    });

    await service.tick();

    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'settlement.unknown_payment_ref',
        severity: EAlertSeverity.CRITICAL,
        subject: PAYMENT_REF,
      }),
    );
    expect(claims.markClaimed).not.toHaveBeenCalled();
  });

  it('warns about a submitted claim that has not settled yet', async () => {
    const { service, alerts, claims } = build({ overdue: [CLAIM] });

    await service.tick();

    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'settlement.claim_not_settled',
        severity: EAlertSeverity.WARNING,
        subject: 'clm-1',
      }),
    );
    // Still inside its deadline: nothing is released yet.
    expect(claims.fail).not.toHaveBeenCalled();
  });

  it('releases the coupon once the entitlement deadline has passed', async () => {
    const expired = {
      ...CLAIM,
      deadline: Math.floor(Date.now() / 1000) - 10,
    };
    const { service, alerts, claims } = build({ overdue: [expired] });

    await service.tick();

    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'settlement.claim_not_settled',
        severity: EAlertSeverity.ERROR,
        subject: 'clm-1',
      }),
    );
    expect(claims.fail).toHaveBeenCalledWith(
      'clm-1',
      EClaimFailureReason.SUBMISSION_FAILED,
      expect.stringContaining('no Claimed event'),
    );
  });
});
