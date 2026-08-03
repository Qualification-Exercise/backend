import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import { decimalsFor, toScaled } from '@/coupons/accrual';
import { VerificationError } from '@/common/chain/verification-error';
import type { Payment } from '@/payments/entities/payment.entity';
import { assetForToken } from '@/pricing/price-source';

interface IEsploraTx {
  txid?: string;
  status?: { confirmed?: boolean; block_height?: number };
  vout?: { scriptpubkey_address?: string; value?: number }[];
}

/**
 * Verifies a Bitcoin payment against this process's own Esplora endpoint
 * (`blockstream.info/api`, `mempool.space/api`, or a self-hosted instance).
 *
 * UTXOs, not logs: `outputIndex` is the `vout`, the recipient is that output's
 * address, and the amount is in satoshis. There is no sender in a Bitcoin
 * output, so the payer is not re-checked here — attribution for BTC rests on
 * the address the user linked, and the payout still needs a signature.
 */
@Injectable()
export class BitcoinPaymentVerifier {
  constructor(private readonly http: HttpService) {}

  async verify(
    payment: Payment,
    merchantAddresses: string[],
    apiBaseUrl: string,
    requiredConfirmations: number,
  ): Promise<void> {
    const base = apiBaseUrl.replace(/\/$/, '');
    const tx = await this.tx(base, payment.txHash);

    if (!tx.status?.confirmed) {
      throw new VerificationError('UNCONFIRMED: transaction is not in a block');
    }
    if (Number(tx.status.block_height) !== Number(payment.blockNumber)) {
      throw new VerificationError(
        `BLOCK_MISMATCH: chain says ${tx.status.block_height}, row says ${payment.blockNumber}`,
      );
    }

    const tip = await this.tip(base);
    const confirmations = tip - Number(tx.status.block_height) + 1;
    if (confirmations < requiredConfirmations) {
      throw new VerificationError(
        `TOO_SHALLOW: ${confirmations} of ${requiredConfirmations} confirmations`,
      );
    }

    const output = (tx.vout ?? [])[payment.outputIndex];
    if (!output) {
      throw new VerificationError(
        `NO_SUCH_OUTPUT: vout ${payment.outputIndex} is not in this transaction`,
      );
    }

    const to = (output.scriptpubkey_address ?? '').toLowerCase();
    const merchants = merchantAddresses.map((a) => a.toLowerCase());
    if (!merchants.includes(to)) {
      throw new VerificationError(
        `NOT_A_MERCHANT: ${output.scriptpubkey_address} is not a registered merchant address`,
      );
    }
    if (to !== payment.merchantAddress.toLowerCase()) {
      throw new VerificationError(
        `MERCHANT_MISMATCH: chain says ${output.scriptpubkey_address}, row says ${payment.merchantAddress}`,
      );
    }

    const expected = toScaled(
      payment.amount,
      decimalsFor(assetForToken(payment.token)),
    );
    if (BigInt(output.value ?? 0) !== expected) {
      throw new VerificationError(
        `AMOUNT_MISMATCH: chain says ${output.value} sats, row says ${expected}`,
      );
    }
  }

  private async tx(base: string, txid: string): Promise<IEsploraTx> {
    try {
      const response = await firstValueFrom(
        this.http.get<IEsploraTx>(`${base}/tx/${txid.replace(/^0x/, '')}`, {
          timeout: 15_000,
        }),
      );
      if (!response.data?.txid) throw new Error('empty transaction');
      return response.data;
    } catch (err) {
      throw new VerificationError(
        `RECEIPT_UNAVAILABLE: ${txid} not found on this issuer's Bitcoin node (${String(err)})`,
      );
    }
  }

  private async tip(base: string): Promise<number> {
    const response = await firstValueFrom(
      this.http.get<number | string>(`${base}/blocks/tip/height`, {
        timeout: 15_000,
      }),
    );
    const tip = Number(response.data);
    if (!Number.isFinite(tip) || tip <= 0) {
      throw new VerificationError('HEAD_UNAVAILABLE: Esplora returned no tip');
    }
    return tip;
  }
}
