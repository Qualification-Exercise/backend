import { EAlertSeverity } from '@/common/alerts/alert.service';
import type { MonitorConfig } from '@/monitor/monitor-config';
import { SupplyReconcilerService } from '@/monitor/services/supply-reconciler.service';

const UTL = '0x63dE56C3909825e1d83e69daDa3f1e9E379f71AD';
const COUPON_CLAIM = '0x5Dfc68FD44CCD83DD10cF5aA4B060AAe1602fb13';

interface IWorld {
  supply?: bigint;
  couponTotal?: string;
  epochCap?: bigint;
  minted?: bigint;
}

function build(world: IWorld = {}) {
  const config = {
    utl: UTL,
    couponClaim: COUPON_CLAIM,
    rpcUrl: 'https://monitor.example/rpc',
    supplyToleranceBps: 50,
    epochUtilisationPct: 80,
  } as unknown as MonitorConfig;

  const alerts = { raise: jest.fn().mockResolvedValue(undefined) };
  const pauser = { pause: jest.fn().mockResolvedValue(undefined) };
  const coupons = {
    query: jest
      .fn()
      .mockResolvedValue([
        { total: world.couponTotal ?? '1000000000000000000' },
      ]),
  };

  const service = new SupplyReconcilerService(
    config,
    alerts as never,
    pauser as never,
    coupons as never,
  );

  (service as unknown as { client: unknown }).client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case 'totalSupply':
          return world.supply ?? 1_000_000_000_000_000_000n;
        case 'epochCap':
          return world.epochCap ?? 1000n * 10n ** 18n;
        case 'currentEpoch':
          return 20_000n;
        case 'mintedInEpoch':
          return world.minted ?? 0n;
        default:
          throw new Error(`unexpected call: ${functionName}`);
      }
    },
  };
  jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);

  return { service, alerts, pauser };
}

describe('SupplyReconcilerService', () => {
  it('stays quiet while minted UTL matches what the payments justify', async () => {
    const { service, alerts, pauser } = build();

    await service.check();

    expect(alerts.raise).not.toHaveBeenCalled();
    expect(pauser.pause).not.toHaveBeenCalled();
  });

  it('does not alarm when less has been minted than issued — that is just an unclaimed coupon', async () => {
    const { service, alerts } = build({
      supply: 1n,
      couponTotal: '1000000000000000000',
    });

    await service.check();

    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('pauses and alerts when more UTL exists than any payment explains', async () => {
    const { service, alerts, pauser } = build({
      supply: 5_000_000_000_000_000_000n,
      couponTotal: '1000000000000000000',
    });

    await service.check();

    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'monitor.supply_divergence',
        severity: EAlertSeverity.CRITICAL,
        subject: `utl:${UTL}`,
      }),
    );
    expect(pauser.pause).toHaveBeenCalledWith(
      `utl:${UTL}`,
      expect.stringContaining('unexplained'),
    );
  });

  it('tolerates a divergence inside the configured band', async () => {
    // 10 bps over, tolerance is 50.
    const { service, alerts } = build({
      supply: 1_001_000_000_000_000_000n,
      couponTotal: '1000000000000000000',
    });

    await service.check();

    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('reports epoch-cap utilisation over the threshold, naming the epoch', async () => {
    const { service, alerts } = build({
      epochCap: 100n * 10n ** 18n,
      minted: 90n * 10n ** 18n,
    });

    await service.checkEpochUtilisation();

    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'monitor.epoch_cap_utilisation',
        subject: 'epoch:20000',
      }),
    );
  });
});
