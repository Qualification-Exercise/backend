import { EClaimFailureReason } from '@/claims/enums/claim-status.enum';
import type { IssuerConfig } from '@/issuer/issuer-config';
import { IssuerRunnerService } from '@/issuer/services/issuer-runner.service';

const CLAIM = { id: 'clm-1', coupon: { paymentRef: '0xref' } };

function build(
  outcome: { signed: boolean; reason?: string },
  pending: (typeof CLAIM)[] = [CLAIM],
) {
  const config = {
    id: 'issuer-a',
    endpoints: {
      '1': 'https://issuer-a-mainnet.example/rpc',
      '11155111': 'https://issuer-a.example/rpc',
    },
    priceProvider: 'bitfinex',
    pollIntervalMs: 0,
    batchSize: 25,
    signer: { address: '0xIssuerA' },
  } as unknown as IssuerConfig;

  const attestation = { attest: jest.fn().mockResolvedValue(outcome) };
  const claims = {
    markAttested: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
  };
  const qb = {
    innerJoinAndSelect: () => qb,
    where: () => qb,
    andWhere: () => qb,
    orderBy: () => qb,
    limit: () => qb,
    getMany: async () => pending,
  };
  const claimRepo = { createQueryBuilder: () => qb };
  const signers = {
    findOne: jest.fn().mockResolvedValue({ address: '0xIssuerA' }),
  };

  const counters = { increment: jest.fn() };
  const alerts = { raise: jest.fn().mockResolvedValue(undefined) };

  const service = new IssuerRunnerService(
    config,
    attestation as never,
    claims as never,
    counters as never,
    alerts as never,
    claimRepo as never,
    signers as never,
  );
  return { service, attestation, claims, signers, counters, alerts };
}

describe('IssuerRunnerService', () => {
  it('hands a signed claim to the threshold check', async () => {
    const { service, claims } = build({ signed: true });

    await service.tick();

    expect(claims.markAttested).toHaveBeenCalledWith('clm-1');
    expect(claims.fail).not.toHaveBeenCalled();
  });

  it('fails the claim with the reason on disagreement, and never retries it', async () => {
    const { service, claims, attestation, alerts } = build({
      signed: false,
      reason: 'AMOUNT_MISMATCH: recomputed 1, claim says 2',
    });

    await service.tick();

    expect(claims.fail).toHaveBeenCalledWith(
      'clm-1',
      EClaimFailureReason.ATTESTATION_REJECTED,
      expect.stringContaining('AMOUNT_MISMATCH'),
    );
    expect(claims.markAttested).not.toHaveBeenCalled();
    // The line itself now comes out of AlertService, which logs and notifies
    // from one place — the runner's job is to hand it the rejection.
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'attestation.rejected' }),
    );

    expect(attestation.attest).toHaveBeenCalledTimes(1);
  });

  // psql is the only window into a host whose logs you cannot read, so a pass
  // that found nothing still has to leave a mark saying it ran.
  it('records the pass even when it signs nothing', async () => {
    const { service, counters } = build({ signed: true }, []);

    await service.tick();

    expect(counters.increment).toHaveBeenCalledWith('issuer.ticks');
    expect(counters.increment).toHaveBeenCalledWith('issuer.claims_seen', 0);
  });

  it('refuses to start when its address is not a registered active issuer', async () => {
    const { service, signers } = build({ signed: true });
    signers.findOne.mockResolvedValue(null);
    (
      service['config'] as unknown as { pollIntervalMs: number }
    ).pollIntervalMs = 1000;

    await expect(service.onModuleInit()).rejects.toThrow(/signers registry/);
  });

  it('never logs an RPC endpoint — the API key lives in its path', async () => {
    const { service } = build({ signed: true });
    const logged: string[] = [];
    jest
      .spyOn(service['logger'], 'log')
      .mockImplementation((msg) => logged.push(String(msg)));

    await service.onModuleInit();

    expect(logged.join()).toContain('chains=1,11155111');
    expect(logged.join()).not.toContain('example');
  });
});
