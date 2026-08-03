import { EClaimFailureReason } from '@/claims/enums/claim-status.enum';
import { VerificationError } from '@/common/chain/payment-verifier.service';
import type { RelayerConfig } from '@/relayer/relayer-config';
import { NonceManagerService } from '@/relayer/services/nonce-manager.service';
import { AlreadySettledError } from '@/relayer/services/relayer-preflight.service';
import { RelayerRunnerService } from '@/relayer/services/relayer-runner.service';

const CLAIM = {
  id: 'clm-1',
  recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  amount: '5000000000000000000',
  deadline: Math.floor(Date.now() / 1000) + 3600,
  chainId: 11155111,
  coupon: { paymentRef: `0x${'ab'.repeat(32)}` },
};

interface IWorld {
  preflightError?: Error;
  verifyError?: string;
  receiptStatus?: 'success' | 'reverted';
  maxFeePerGas?: bigint;
  sendError?: Error;
}

function build(world: IWorld = {}) {
  const config = {
    id: 'relayer',
    chainId: 11155111,
    verifyingContract: '0x5Dfc68FD44CCD83DD10cF5aA4B060AAe1602fb13',
    rpcUrl: 'https://relayer.example/rpc',
    pollIntervalMs: 0,
    batchSize: 10,
    confirmations: 2,
    deadlineMarginSeconds: 120,
    maxFeeWei: 100n * 10n ** 9n,
    signer: {
      address: '0x95FA3C48A38077e20b47c8Ef426597a7e1F112ab',
      signTransaction: jest.fn().mockResolvedValue('0xsigned'),
    },
  } as unknown as RelayerConfig;

  const preflight = {
    check: jest.fn(async () => {
      if (world.preflightError) throw world.preflightError;
      return { signatures: ['0xsigA', '0xsigB'], signers: ['0x1', '0x2'] };
    }),
  };
  const verifier = {
    verify: jest.fn(async () => {
      if (world.verifyError) throw new VerificationError(world.verifyError);
    }),
  };
  const claims = {
    markSubmitted: jest.fn().mockResolvedValue(undefined),
    markClaimed: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
  };

  const qb = {
    innerJoinAndSelect: () => qb,
    where: () => qb,
    orderBy: () => qb,
    limit: () => qb,
    getMany: async () => [CLAIM],
  };

  const client = {
    getTransactionCount: jest.fn().mockResolvedValue(4),
    estimateGas: jest.fn().mockResolvedValue(200_000n),
    estimateFeesPerGas: jest.fn().mockResolvedValue({
      maxFeePerGas: world.maxFeePerGas ?? 20n * 10n ** 9n,
      maxPriorityFeePerGas: 1n * 10n ** 9n,
    }),
    sendRawTransaction: jest.fn(async () => {
      if (world.sendError) throw world.sendError;
      return '0xtxhash';
    }),
    waitForTransactionReceipt: jest.fn().mockResolvedValue({
      status: world.receiptStatus ?? 'success',
    }),
  };

  const service = new RelayerRunnerService(
    config,
    preflight as never,
    verifier as never,
    new NonceManagerService(),
    claims as never,
    { createQueryBuilder: () => qb } as never,
    {
      find: async () => [{ issuerAddress: '0x1', signature: '0xsigA' }],
    } as never,
    {
      findOne: async () => ({
        srcChainId: 11155111,
        paymentRef: CLAIM.coupon.paymentRef,
      }),
    } as never,
    { find: async () => [] } as never,
    {
      findOne: jest.fn().mockResolvedValue({ address: config.signer.address }),
    } as never,
  );
  (service as unknown as { client: unknown }).client = client;
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

  return { service, config, preflight, verifier, claims, client };
}

describe('RelayerRunnerService', () => {
  it('re-verifies against its own node, submits, and settles the claim', async () => {
    const { service, verifier, preflight, claims, client, config } = build();

    await service.tick();

    expect(verifier.verify).toHaveBeenCalled();
    expect(preflight.check).toHaveBeenCalled();
    // The nonce came from the sequence, not from whatever the node felt like.
    expect(config.signer.signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 4, type: 2, chainId: 11155111 }),
    );
    expect(client.sendRawTransaction).toHaveBeenCalledWith({
      serializedTransaction: '0xsigned',
    });
    expect(claims.markSubmitted).toHaveBeenCalledWith('clm-1', '0xtxhash', 4);
    expect(claims.markClaimed).toHaveBeenCalledWith('clm-1');
    expect(claims.fail).not.toHaveBeenCalled();
  });

  it('does not spend anything when its own node disagrees about the payment', async () => {
    const { service, preflight, claims, client } = build({
      verifyError: 'REORG: block hash no longer canonical',
    });

    await service.tick();

    expect(preflight.check).not.toHaveBeenCalled();
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
    expect(claims.fail).toHaveBeenCalledWith(
      'clm-1',
      EClaimFailureReason.SUBMISSION_FAILED,
      expect.stringContaining('REORG'),
    );
  });

  it('fails locally on a cap rather than paying for the revert', async () => {
    const { service, claims, client } = build({
      preflightError: new Error('EXCEEDS_EPOCH_CAP: 900 + 200 > 1000'),
    });

    await service.tick();

    expect(client.sendRawTransaction).not.toHaveBeenCalled();
    expect(claims.fail).toHaveBeenCalledWith(
      'clm-1',
      EClaimFailureReason.SUBMISSION_FAILED,
      expect.stringContaining('EXCEEDS_EPOCH_CAP'),
    );
  });

  it('records an already-nullified payment as claimed instead of retrying it', async () => {
    const { service, claims, client } = build({
      preflightError: new AlreadySettledError('already nullified'),
    });
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    await service.tick();

    expect(client.sendRawTransaction).not.toHaveBeenCalled();
    expect(claims.markClaimed).toHaveBeenCalledWith('clm-1');
    expect(claims.fail).not.toHaveBeenCalled();
  });

  it('refuses to submit above the configured fee ceiling', async () => {
    const { service, claims, client } = build({
      maxFeePerGas: 500n * 10n ** 9n,
    });

    await service.tick();

    expect(client.sendRawTransaction).not.toHaveBeenCalled();
    expect(claims.fail).toHaveBeenCalledWith(
      'clm-1',
      EClaimFailureReason.SUBMISSION_FAILED,
      expect.stringContaining('GAS_TOO_EXPENSIVE'),
    );
  });

  it('fails the claim when the transaction reverts on-chain', async () => {
    const { service, claims } = build({ receiptStatus: 'reverted' });

    await service.tick();

    expect(claims.markSubmitted).toHaveBeenCalled();
    expect(claims.fail).toHaveBeenCalledWith(
      'clm-1',
      EClaimFailureReason.SUBMISSION_FAILED,
      expect.stringContaining('REVERTED'),
    );
  });

  it('refuses to start when its address is not a registered active relayer', async () => {
    const { service } = build();
    (
      service['signers'] as unknown as { findOne: jest.Mock }
    ).findOne.mockResolvedValue(null);
    (
      service['config'] as unknown as { pollIntervalMs: number }
    ).pollIntervalMs = 1000;
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

    await expect(service.onModuleInit()).rejects.toThrow(/signers registry/);
  });
});
