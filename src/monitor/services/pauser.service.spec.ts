import { EAlertSeverity } from '@/common/alerts/alert.service';
import type { MonitorConfig } from '@/monitor/monitor-config';
import { PauserService } from '@/monitor/services/pauser.service';

const GUARDIAN = '0x5CBC57Ab603208eC26CDBB5cc54c99c7fb1C0c89';
const COUPON_CLAIM = '0x5Dfc68FD44CCD83DD10cF5aA4B060AAe1602fb13';
const PAUSER_ROLE = `0x${'22'.repeat(32)}`;

interface IWorld {
  autoPause?: boolean;
  paused?: boolean;
  holdsRole?: boolean;
  sendError?: Error;
}

function build(world: IWorld = {}) {
  const config = {
    couponClaim: COUPON_CLAIM,
    chainId: 11155111,
    rpcUrl: 'https://monitor.example/rpc',
    autoPause: world.autoPause ?? true,
    signer: {
      address: GUARDIAN,
      signTransaction: jest.fn().mockResolvedValue('0xsigned'),
    },
  } as unknown as MonitorConfig;

  const alerts = { raise: jest.fn().mockResolvedValue(undefined) };
  const service = new PauserService(config, alerts as never);

  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case 'PAUSER_ROLE':
          return PAUSER_ROLE;
        case 'hasRole':
          return world.holdsRole ?? true;
        case 'paused':
          return world.paused ?? false;
        default:
          throw new Error(`unexpected call: ${functionName}`);
      }
    },
    getTransactionCount: jest.fn().mockResolvedValue(3),
    estimateGas: jest.fn().mockResolvedValue(50_000n),
    estimateFeesPerGas: jest
      .fn()
      .mockResolvedValue({ maxFeePerGas: 20n, maxPriorityFeePerGas: 1n }),
    sendRawTransaction: jest.fn(async () => {
      if (world.sendError) throw world.sendError;
      return '0xpausetx';
    }),
    waitForTransactionReceipt: jest
      .fn()
      .mockResolvedValue({ status: 'success' }),
  };
  (service as unknown as { client: unknown }).client = client;
  jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

  return { service, config, alerts, client };
}

describe('PauserService', () => {
  it('checks it actually holds PAUSER_ROLE before the incident, not during', async () => {
    const { service } = build();
    await expect(service.assertCanPause()).resolves.toBeUndefined();

    const { service: powerless } = build({ holdsRole: false });
    await expect(powerless.assertCanPause()).rejects.toThrow(/PAUSER_ROLE/);
  });

  it('submits pause() and says so, naming what triggered it', async () => {
    const { service, alerts, client, config } = build();

    await service.pause('utl:0xabc', 'supply divergence');

    expect(config.signer.signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 3, to: COUPON_CLAIM }),
    );
    expect(client.sendRawTransaction).toHaveBeenCalled();
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'monitor.paused',
        severity: EAlertSeverity.CRITICAL,
        subject: 'utl:0xabc',
      }),
    );
  });

  it('does not pause on its own when auto-pause is off, but says so loudly', async () => {
    const { service, alerts, client } = build({ autoPause: false });

    await service.pause('utl:0xabc', 'supply divergence');

    expect(client.sendRawTransaction).not.toHaveBeenCalled();
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'monitor.pause_withheld',
        severity: EAlertSeverity.CRITICAL,
        subject: 'utl:0xabc',
      }),
    );
  });

  it('does not pause a contract that is already paused', async () => {
    const { service, client } = build({ paused: true });

    await service.pause('utl:0xabc', 'supply divergence');

    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('alerts when the pause itself could not be submitted', async () => {
    const { service, alerts } = build({ sendError: new Error('no gas') });

    await service.pause('utl:0xabc', 'supply divergence');

    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'monitor.pause_failed',
        severity: EAlertSeverity.CRITICAL,
      }),
    );
  });
});
