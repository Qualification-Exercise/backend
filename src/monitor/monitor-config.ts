import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Hex } from 'viem';

import type { IChainViewConfig } from '@/common/chain/chain-view.config';
import { assertDistinct, buildEndpoints } from '@/common/chain/rpc-endpoints';
import { createWdkSigner, type IWdkSigner } from '@/common/signing/wdk-signer';
import type { Env } from '@/config/env';

export class MonitorConfigError extends Error {}

/**
 * The monitor: a detective control, deliberately outside the accounts that run
 * the pipeline it watches.
 *
 * It holds the guardian key and nothing else — it cannot attest, cannot submit
 * a claim, cannot write a coupon. The one thing it can do is stop the system,
 * which is the whole point: the caps bound the rate of a compromise, this
 * bounds its duration.
 */
@Injectable()
export class MonitorConfig implements IChainViewConfig {
  readonly id = 'monitor';
  readonly endpoints: Record<string, string>;
  /** The reward chain endpoint: supply, caps and pause() live there. */
  readonly rewardRpcUrl: string;
  readonly signer: IWdkSigner;
  readonly chainId: number;
  readonly couponClaim: Hex;
  readonly utl: Hex;
  readonly pollIntervalMs: number;
  readonly supplyToleranceBps: number;
  readonly sampleSize: number;
  readonly epochUtilisationPct: number;
  readonly maxIndexerLagSeconds: number;
  readonly maxIndexerErrorPct: number;
  readonly autoPause: boolean;
  readonly cashbackBps: number;
  readonly utlUsdRate: string;
  private readonly tokens: Record<string, Record<string, string>>;

  constructor(configService: ConfigService<Env, true>) {
    this.endpoints = buildEndpoints(
      configService.get('REWARD_CHAIN_ID'),
      configService.get('MONITOR_RPC_URL'),
      configService.get('MONITOR_RPC_URLS'),
    );
    this.chainId = configService.get('REWARD_CHAIN_ID');
    this.pollIntervalMs = configService.get('MONITOR_POLL_INTERVAL_MS');
    this.supplyToleranceBps = configService.get('MONITOR_SUPPLY_TOLERANCE_BPS');
    this.sampleSize = configService.get('MONITOR_SAMPLE_SIZE');
    this.epochUtilisationPct = configService.get(
      'MONITOR_EPOCH_UTILISATION_PCT',
    );
    this.maxIndexerLagSeconds = configService.get(
      'MONITOR_MAX_INDEXER_LAG_SECONDS',
    );
    this.maxIndexerErrorPct = configService.get(
      'MONITOR_MAX_INDEXER_ERROR_PCT',
    );
    this.autoPause = configService.get('MONITOR_AUTO_PAUSE');
    this.cashbackBps = configService.get('CASHBACK_BPS');
    this.utlUsdRate = configService.get('UTL_USD_RATE');
    this.tokens = JSON.parse(configService.get('TOKEN_ADDRESSES'));

    this.couponClaim = requireAddress(
      configService.get('COUPON_CLAIM_CONTRACT_ADDRESS'),
      'COUPON_CLAIM_CONTRACT_ADDRESS',
    );
    this.utl = requireAddress(
      configService.get('UTILITY_TOKEN_CONTRACT_ADDRESS'),
      'UTILITY_TOKEN_CONTRACT_ADDRESS',
    );

    const reward = this.endpoints[String(this.chainId)];
    if (!reward) {
      throw new MonitorConfigError(
        'MONITOR_RPC_URL must name a node on the reward chain: supply and pause() live there',
      );
    }
    this.rewardRpcUrl = reward;
    // Sharing a node with the pipeline would make the monitor agree with it by
    // construction, which is the one thing a detective control must not do.
    const shared: Record<string, string> = JSON.parse(
      configService.get('RPC_URLS'),
    );
    assertDistinct(
      this.endpoints,
      [
        ...Object.values(shared),
        ...Object.values(
          JSON.parse(configService.get('ISSUER_RPC_URLS')) as Record<
            string,
            string
          >,
        ),
        ...Object.values(
          JSON.parse(configService.get('RELAYER_RPC_URLS')) as Record<
            string,
            string
          >,
        ),
        configService.get('ISSUER_RPC_URL'),
        configService.get('RELAYER_RPC_URL'),
      ],
      'Monitor',
      JSON.parse(configService.get('RPC_SHARING_ALLOWED_CHAINS')) as number[],
    );

    this.signer = createWdkSigner(
      configService.get('MONITOR_SIGNING_KEY') || '',
      {
        password: configService.get('SIGNER_KEY_PASSWORD'),
        allowPlaintextKey: configService.get('ALLOW_PLAINTEXT_SIGNING_KEY'),
      },
    );
  }

  rpcUrlFor(srcChainId: number): string | null {
    return this.endpoints[String(srcChainId)] ?? null;
  }

  /** Chains this process can see at all — the payment chains it may sample. */
  get chains(): number[] {
    return Object.keys(this.endpoints).map(Number);
  }

  tokenAddress(srcChainId: number, token: string): string | null {
    return this.tokens[String(srcChainId)]?.[token.toLowerCase()] ?? null;
  }
}

function requireAddress(value: string, name: string): Hex {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new MonitorConfigError(`${name} must be a contract address`);
  }
  return value as Hex;
}
