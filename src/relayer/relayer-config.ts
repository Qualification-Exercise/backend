import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Hex } from 'viem';

import type { IChainViewConfig } from '@/common/chain/chain-view.config';
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
  readonly rpcUrl: string;
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
    this.rpcUrl = configService.get('RELAYER_RPC_URL');
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

    if (!this.rpcUrl) {
      throw new RelayerConfigError(
        'RELAYER_RPC_URL must be set: the relayer re-verifies against its own node',
      );
    }
    const shared: Record<string, string> = JSON.parse(
      configService.get('RPC_URLS'),
    );
    const issuerRpc = configService.get('ISSUER_RPC_URL');
    const collisions = [...Object.values(shared), issuerRpc].filter((url) =>
      sameEndpoint(url, this.rpcUrl),
    );
    if (collisions.length > 0) {
      throw new RelayerConfigError(
        'RELAYER_RPC_URL must differ from the API and issuer endpoints',
      );
    }

    this.signer = createWdkSigner(
      configService.get('RELAYER_SIGNING_KEY') || '',
      {
        password: configService.get('SIGNER_KEY_PASSWORD'),
        allowPlaintextKey: configService.get('NODE_ENV') === 'development',
      },
    );
  }

  tokenAddress(srcChainId: number, token: string): string | null {
    return this.tokens[String(srcChainId)]?.[token.toLowerCase()] ?? null;
  }
}

function sameEndpoint(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '');
}
