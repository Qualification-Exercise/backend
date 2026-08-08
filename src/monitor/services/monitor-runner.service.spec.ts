import { Test } from '@nestjs/testing';

import { AlertService } from '@/common/alerts/alert.service';
import { MonitorConfig } from '@/monitor/monitor-config';
import { HealthSignalsService } from '@/monitor/services/health-signals.service';
import { MonitorRunnerService } from '@/monitor/services/monitor-runner.service';
import { PauserService } from '@/monitor/services/pauser.service';
import { PaymentSamplerService } from '@/monitor/services/payment-sampler.service';
import { SupplyReconcilerService } from '@/monitor/services/supply-reconciler.service';

async function build(
  options: {
    pollIntervalMs?: number;
    assertCanPause?: jest.Mock;
    failing?: 'supply' | 'epoch' | 'payments' | 'health';
  } = {},
) {
  const fail = (name: string) =>
    options.failing === name
      ? jest.fn(async () => {
          throw new Error(`${name} exploded`);
        })
      : jest.fn(async () => undefined);

  const supply = {
    check: fail('supply'),
    checkEpochUtilisation: fail('epoch'),
  };
  const payments = { check: fail('payments') };
  const health = { check: fail('health') };
  const pauser = {
    assertCanPause: options.assertCanPause ?? jest.fn(async () => undefined),
  };
  const alerts = { raise: jest.fn(async () => undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      MonitorRunnerService,
      {
        provide: MonitorConfig,
        useValue: {
          pollIntervalMs: options.pollIntervalMs ?? 0,
          autoPause: false,
          signer: { address: '0x5CBC57Ab603208eC26CDBB5cc54c99c7fb1C0c89' },
        },
      },
      { provide: SupplyReconcilerService, useValue: supply },
      { provide: PaymentSamplerService, useValue: payments },
      { provide: HealthSignalsService, useValue: health },
      { provide: PauserService, useValue: pauser },
      { provide: AlertService, useValue: alerts },
    ],
  }).compile();

  return {
    service: moduleRef.get(MonitorRunnerService),
    supply,
    payments,
    health,
    pauser,
    alerts,
  };
}

afterEach(() => jest.useRealTimers());

describe('MonitorRunnerService.tick', () => {
  it('runs every check in order', async () => {
    const { service, supply, payments, health } = await build();

    await service.tick();

    expect(supply.check).toHaveBeenCalledTimes(1);
    expect(supply.checkEpochUtilisation).toHaveBeenCalledTimes(1);
    expect(payments.check).toHaveBeenCalledTimes(1);
    expect(health.check).toHaveBeenCalledTimes(1);
  });

  it.each(['supply', 'epoch', 'payments'] as const)(
    'keeps the later checks running when the %s check throws',
    async (failing) => {
      const { service, health } = await build({ failing });

      await expect(service.tick()).resolves.toBeUndefined();
      // The reason one check failed is often the reason another would fire.
      expect(health.check).toHaveBeenCalledTimes(1);
    },
  );

  it('swallows a failure in the last check too', async () => {
    const { service } = await build({ failing: 'health' });

    await expect(service.tick()).resolves.toBeUndefined();
  });

  it('skips a pass while the previous one is still running', async () => {
    let release: () => void = () => undefined;
    const { service, supply } = await build();
    supply.check.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          release = () => resolve(undefined);
        }),
    );

    const first = service.tick();
    await service.tick();
    expect(supply.check).toHaveBeenCalledTimes(1);

    release();
    await first;

    await service.tick();
    expect(supply.check).toHaveBeenCalledTimes(2);
  });
});

describe('MonitorRunnerService lifecycle', () => {
  it('stays off when the poll interval is zero, and asks nothing of the guardian', async () => {
    const { service, pauser } = await build({ pollIntervalMs: 0 });

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(pauser.assertCanPause).not.toHaveBeenCalled();
  });

  it('proves the guardian can pause before it starts polling', async () => {
    jest.useFakeTimers();
    const { service, pauser, supply } = await build({ pollIntervalMs: 1_000 });

    await service.onModuleInit();
    expect(pauser.assertCanPause).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(supply.check).toHaveBeenCalled();

    service.onModuleDestroy();
  });

  // Going dark is the one failure the monitor cannot report about itself, so an
  // unreadable contract downgrades auto-pause rather than cancelling the watch.
  it('keeps watching when the guardian check fails, and alerts about it', async () => {
    jest.useFakeTimers();
    const assertCanPause = jest.fn(async () => {
      throw new Error('guardian lacks PAUSER_ROLE');
    });
    const { service, supply, alerts } = await build({
      pollIntervalMs: 1_000,
      assertCanPause,
    });

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'monitor.pause_rights_unconfirmed' }),
    );

    await jest.advanceTimersByTimeAsync(1_000);
    expect(supply.check).toHaveBeenCalled();

    service.onModuleDestroy();
  });

  it('stops re-checking the guardian once it holds the role', async () => {
    jest.useFakeTimers();
    const { service, pauser } = await build({ pollIntervalMs: 1_000 });

    await service.onModuleInit();
    await service.tick();
    await service.tick();

    expect(pauser.assertCanPause).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });
});
