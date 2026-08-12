import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Hex } from 'viem';

import type { IChainViewConfig } from '@/common/chain/chain-view.config';
import { assertDistinct, buildEndpoints } from '@/common/chain/rpc-endpoints';
import { createWdkSigner, type IWdkSigner } from '@/common/signing/wdk-signer';
import type { Env } from '@/config/env';

export class RelayerConfigError extends Error {}

/**
 * The only process in the system with a key that can spend.
 *
 * It reads the chain through its own endpoint for the same reason the issuers
 * do: it is the second independent verifier, and a relayer sharing the API's
 * node would re-check nothing. It refuses to start on a shared endpoint rather
 * than quietly becoming an echo.
 */
@Injectable()
export class RelayerConfig implements IChainViewConfig {
  readonly id: string;
  readonly endpoints: Record<string, string>;
  readonly rewardRpcUrl: string;
  readonly signer: IWdkSigner;
  readonly chainId: number;
  readonly verifyingContract: Hex;
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly confirmations: number;
  readonly deadlineMarginSeconds: number;
  readonly maxFeeWei: bigint;
  private readonly tokens: Record<string, Record<string, string>>;

  constructor(configService: ConfigService<Env, true>) {
    this.id = configService.get('RELAYER_ID');
    this.endpoints = buildEndpoints(
      configService.get('REWARD_CHAIN_ID'),
      configService.get('RELAYER_RPC_URL'),
      configService.get('RELAYER_RPC_URLS'),
    );
    this.chainId = configService.get('REWARD_CHAIN_ID');
    this.pollIntervalMs = configService.get('RELAYER_POLL_INTERVAL_MS');
    this.batchSize = configService.get('RELAYER_BATCH_SIZE');
    this.confirmations = configService.get('RELAYER_CONFIRMATIONS');
    this.deadlineMarginSeconds = configService.get(
      'RELAYER_DEADLINE_MARGIN_SECONDS',
    );
    this.maxFeeWei =
      BigInt(Math.round(configService.get('RELAYER_MAX_FEE_GWEI') * 1e6)) *
      1_000n;
    this.tokens = JSON.parse(configService.get('TOKEN_ADDRESSES'));

    const contract = configService.get('COUPON_CLAIM_CONTRACT_ADDRESS');
    if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
      throw new RelayerConfigError(
        'COUPON_CLAIM_CONTRACT_ADDRESS must be set: it is what the relayer calls',
      );
    }
    this.verifyingContract = contract as Hex;

    const reward = this.endpoints[String(this.chainId)];
    if (!reward) {
      throw new RelayerConfigError(
        'RELAYER_RPC_URL must name a node on the reward chain: that is where claim() goes',
      );
    }
    this.rewardRpcUrl = reward;

    const shared: Record<string, string> = JSON.parse(
      configService.get('RPC_URLS'),
    );
    const issuerEndpoints = Object.values(
      JSON.parse(configService.get('ISSUER_RPC_URLS')) as Record<
        string,
        string
      >,
    );
    assertDistinct(
      this.endpoints,
      [
        ...Object.values(shared),
        ...issuerEndpoints,
        configService.get('ISSUER_RPC_URL'),
      ],
      'Relayer',
      JSON.parse(configService.get('RPC_SHARING_ALLOWED_CHAINS')) as number[],
    );

    this.signer = createWdkSigner(
      configService.get('RELAYER_SIGNING_KEY') || '',
      {
        password: configService.get('SIGNER_KEY_PASSWORD'),
        allowPlaintextKey: configService.get('ALLOW_PLAINTEXT_SIGNING_KEY'),
      },
    );
  }

  rpcUrlFor(srcChainId: number): string | null {
    return this.endpoints[String(srcChainId)] ?? null;
  }

  tokenAddress(srcChainId: number, token: string): string | null {
    return this.tokens[String(srcChainId)]?.[token.toLowerCase()] ?? null;
  }
}
