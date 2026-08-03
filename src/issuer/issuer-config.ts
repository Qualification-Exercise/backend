import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Hex } from 'viem';

import type { Env } from '@/config/env';
import { createIssuerSigner, type IIssuerSigner } from '@/issuer/signer';

export class IssuerConfigError extends Error {}

@Injectable()
export class IssuerConfig {
  readonly id: string;
  readonly rpcUrl: string;
  readonly priceProvider: 'bitfinex' | 'coingecko';
  readonly signer: IIssuerSigner;
  readonly chainId: number;
  readonly verifyingContract: Hex;
  readonly toleranceBps: number;
  readonly priceWindowSeconds: number;
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly cooldownHours: number;
  readonly utlUsdRate: string;
  readonly cashbackBps: number;
  readonly tokenAddresses: Record<string, Record<string, string>>;

  constructor(configService: ConfigService<Env, true>) {
    this.id = configService.get('ISSUER_ID');
    this.rpcUrl = configService.get('ISSUER_RPC_URL');
    this.priceProvider = configService.get('ISSUER_PRICE_PROVIDER');
    this.chainId = configService.get('REWARD_CHAIN_ID');
    this.toleranceBps = configService.get('PRICE_TOLERANCE_BPS');
    this.priceWindowSeconds = configService.get('PRICE_WINDOW_SECONDS');
    this.pollIntervalMs = configService.get('ISSUER_POLL_INTERVAL_MS');
    this.batchSize = configService.get('ISSUER_BATCH_SIZE');
    this.cooldownHours = configService.get('CLAIM_COOLDOWN_HOURS');
    this.utlUsdRate = configService.get('UTL_USD_RATE');
    this.cashbackBps = configService.get('CASHBACK_BPS');
    this.tokenAddresses = JSON.parse(configService.get('TOKEN_ADDRESSES'));

    const contract = configService.get('COUPON_CLAIM_CONTRACT_ADDRESS');
    if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
      throw new IssuerConfigError(
        'COUPON_CLAIM_CONTRACT_ADDRESS must be set: it is half of the domain separator',
      );
    }
    this.verifyingContract = contract as Hex;

    if (!this.id) throw new IssuerConfigError('ISSUER_ID must be set');
    if (!this.rpcUrl) {
      throw new IssuerConfigError(
        'ISSUER_RPC_URL must be set: an issuer verifies against its own node',
      );
    }

    const shared: Record<string, string> = JSON.parse(
      configService.get('RPC_URLS'),
    );
    if (Object.values(shared).some((url) => sameEndpoint(url, this.rpcUrl))) {
      throw new IssuerConfigError(
        `ISSUER_RPC_URL must differ from the API's RPC endpoints (${this.id})`,
      );
    }

    this.signer = createIssuerSigner(
      configService.get('ISSUER_SIGNING_KEY') || '',
      {
        password: configService.get('SIGNER_KEY_PASSWORD'),
        allowPlaintextKey: configService.get('NODE_ENV') === 'development',
      },
    );
  }

  /** The token contract a Transfer log must have come from, if we know it. */
  tokenAddress(srcChainId: number, token: string): string | null {
    return (
      this.tokenAddresses[String(srcChainId)]?.[token.toLowerCase()] ?? null
    );
  }
}

function sameEndpoint(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '');
}
