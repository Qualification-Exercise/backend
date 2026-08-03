import { EClaimFailureReason } from '@/claims/enums/claim-status.enum';
import type { IssuerConfig } from '@/issuer/issuer-config';
import { IssuerRunnerService } from '@/issuer/services/issuer-runner.service';

const CLAIM = { id: 'clm-1', coupon: { paymentRef: '0xref' } };

function build(outcome: { signed: boolean; reason?: string }) {
  const config = {
    id: 'issuer-a',
    rpcUrl: 'https://issuer-a.example/rpc',
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
    getMany: async () => [CLAIM],
  };
  const claimRepo = { createQueryBuilder: () => qb };
  const signers = {
    findOne: jest.fn().mockResolvedValue({ address: '0xIssuerA' }),
  };

  const service = new IssuerRunnerService(
    config,
    attestation as never,
    claims as never,
    claimRepo as never,
    signers as never,
  );
  return { service, attestation, claims, signers };
}

describe('IssuerRunnerService', () => {
  it('hands a signed claim to the threshold check', async () => {
    const { service, claims } = build({ signed: true });

    await service.tick();

    expect(claims.markAttested).toHaveBeenCalledWith('clm-1');
    expect(claims.fail).not.toHaveBeenCalled();
  });

  it('fails the claim with the reason on disagreement, and never retries it', async () => {
    const { service, claims, attestation } = build({
      signed: false,
      reason: 'AMOUNT_MISMATCH: recomputed 1, claim says 2',
    });
    const logged: string[] = [];
    jest
      .spyOn(service['logger'], 'error')
      .mockImplementation((msg) => logged.push(String(msg)));

    await service.tick();

    expect(claims.fail).toHaveBeenCalledWith(
      'clm-1',
      EClaimFailureReason.ATTESTATION_REJECTED,
      expect.stringContaining('AMOUNT_MISMATCH'),
    );
    expect(claims.markAttested).not.toHaveBeenCalled();
    expect(logged.join()).toContain('security_event=attestation.rejected');

    expect(attestation.attest).toHaveBeenCalledTimes(1);
  });

  it('refuses to start when its address is not a registered active issuer', async () => {
    const { service, signers } = build({ signed: true });
    signers.findOne.mockResolvedValue(null);
    (
      service['config'] as unknown as { pollIntervalMs: number }
    ).pollIntervalMs = 1000;

    await expect(service.onModuleInit()).rejects.toThrow(/signers registry/);
  });

  it('never logs the RPC endpoint whole — the API key lives in the path', async () => {
    const { service } = build({ signed: true });
    const logged: string[] = [];
    jest
      .spyOn(service['logger'], 'log')
      .mockImplementation((msg) => logged.push(String(msg)));

    await service.onModuleInit();

    expect(logged.join()).toContain('https://issuer-a.example');
    expect(logged.join()).not.toContain('/rpc');
  });
});
