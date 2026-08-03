import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import { decimalsFor, toScaled } from '@/coupons/accrual';
import { VerificationError } from '@/common/chain/verification-error';
import type { Payment } from '@/payments/entities/payment.entity';
import { assetForToken } from '@/pricing/price-source';
import { tronAddressFromHex } from '@/wallets/address';

/** keccak256('Transfer(address,address,uint256)') — TRC-20 mirrors ERC-20. */
const TRANSFER_TOPIC =
  'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

interface ITronLog {
  address?: string;
  topics?: string[];
  data?: string;
}

interface ITronTxInfo {
  id?: string;
  blockNumber?: number;
  receipt?: { result?: string };
  log?: ITronLog[];
}

/**
 * Verifies a Tron payment against this process's own TronGrid endpoint.
 *
 * Tron speaks HTTP rather than JSON-RPC and hands back addresses as 21-byte hex
 * with a `41` prefix, so the shape differs from EVM — but the questions are the
 * same ones the EVM verifier asks, and the answer still has to come from a node
 * this process controls rather than from the indexer.
 */
@Injectable()
export class TronPaymentVerifier {
  constructor(private readonly http: HttpService) {}

  async verify(
    payment: Payment,
    merchantAddresses: string[],
    apiBaseUrl: string,
    requiredConfirmations: number,
    expectedToken: string | null,
  ): Promise<void> {
    const info = await this.txInfo(apiBaseUrl, payment.txHash);

    if (info.receipt?.result && info.receipt.result !== 'SUCCESS') {
      throw new VerificationError(
        `TX_REVERTED: Tron receipt says ${info.receipt.result}`,
      );
    }
    if (Number(info.blockNumber) !== Number(payment.blockNumber)) {
      throw new VerificationError(
        `BLOCK_MISMATCH: chain says ${info.blockNumber}, row says ${payment.blockNumber}`,
      );
    }

    const head = await this.head(apiBaseUrl);
    const confirmations = head - Number(info.blockNumber) + 1;
    if (confirmations < requiredConfirmations) {
      throw new VerificationError(
        `TOO_SHALLOW: ${confirmations} of ${requiredConfirmations} confirmations`,
      );
    }

    const log = (info.log ?? [])[payment.outputIndex];
    if (!log) {
      throw new VerificationError(
        `NO_SUCH_LOG: log index ${payment.outputIndex} is not in this transaction`,
      );
    }
    if (!expectedToken) {
      throw new VerificationError(
        'UNKNOWN_TOKEN: no TRC-20 contract configured for this token',
      );
    }
    if (
      tronAddressFromHex(log.address ?? '').toLowerCase() !==
      expectedToken.toLowerCase()
    ) {
      throw new VerificationError(
        `WRONG_TOKEN_CONTRACT: log came from ${log.address}`,
      );
    }

    const topics = log.topics ?? [];
    if (topics.length < 3 || topics[0]?.toLowerCase() !== TRANSFER_TOPIC) {
      throw new VerificationError(
        'NOT_A_TRANSFER: log is not a TRC-20 Transfer',
      );
    }

    const from = tronAddressFromHex(topics[1]);
    const to = tronAddressFromHex(topics[2]);

    if (!merchantAddresses.includes(to)) {
      throw new VerificationError(
        `NOT_A_MERCHANT: ${to} is not a registered merchant address`,
      );
    }
    if (to !== payment.merchantAddress) {
      throw new VerificationError(
        `MERCHANT_MISMATCH: chain says ${to}, row says ${payment.merchantAddress}`,
      );
    }
    if (from !== payment.fromAddress) {
      throw new VerificationError(
        `PAYER_MISMATCH: chain says ${from}, row says ${payment.fromAddress}`,
      );
    }

    const expected = toScaled(
      payment.amount,
      decimalsFor(assetForToken(payment.token)),
    );
    const value = BigInt(`0x${(log.data ?? '0').replace(/^0x/, '') || '0'}`);
    if (value !== expected) {
      throw new VerificationError(
        `AMOUNT_MISMATCH: chain says ${value}, row says ${expected}`,
      );
    }
  }

  private async txInfo(base: string, txHash: string): Promise<ITronTxInfo> {
    const value = txHash.replace(/^0x/, '');
    try {
      const response = await firstValueFrom(
        this.http.post<ITronTxInfo>(
          `${base.replace(/\/$/, '')}/wallet/gettransactioninfobyid`,
          { value },
          { timeout: 15_000 },
        ),
      );
      // TronGrid answers 200 with `{}` for a transaction it has never seen.
      if (!response.data || !response.data.id) {
        throw new Error('empty transaction info');
      }
      return response.data;
    } catch (err) {
      throw new VerificationError(
        `RECEIPT_UNAVAILABLE: ${txHash} not found on this issuer's Tron node (${String(err)})`,
      );
    }
  }

  private async head(base: string): Promise<number> {
    const response = await firstValueFrom(
      this.http.post<{ block_header?: { raw_data?: { number?: number } } }>(
        `${base.replace(/\/$/, '')}/wallet/getnowblock`,
        {},
        { timeout: 15_000 },
      ),
    );
    const head = response.data?.block_header?.raw_data?.number;
    if (!head) {
      throw new VerificationError(
        'HEAD_UNAVAILABLE: Tron node returned no head',
      );
    }
    return head;
  }
}
