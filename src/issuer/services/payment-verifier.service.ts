import { Injectable, Logger } from '@nestjs/common';
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbi,
  type Hex,
  type PublicClient,
} from 'viem';

import { chainBySrcChainId, normalizeTxHash, paymentRef } from '@/chains';
import { decimalsFor, toScaled } from '@/coupons/accrual';
import { IssuerConfig } from '@/issuer/issuer-config';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import type { Payment } from '@/payments/entities/payment.entity';
import { assetForToken } from '@/pricing/price-source';
import { normalizeAddress } from '@/wallets/address';

const TRANSFER_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export class VerificationError extends Error {}

function canonical(address: string): string {
  try {
    return normalizeAddress(address).address.toLowerCase();
  } catch {
    return address.trim().toLowerCase();
  }
}

/**
 * Re-verifies a payment **from the chain**, with this issuer's own node.
 *
 * Nothing here reads the Indexer API, and nothing here trusts the `payments`
 * row beyond using it as a claim to be checked: the row says "this transfer
 * happened", and this service goes and looks. That is the entire reason the
 * attestation layer exists — payment detection depends on a third-party API,
 * and this is what stops a wrong or malicious answer from minting.
 */
@Injectable()
export class PaymentVerifierService {
  private readonly logger = new Logger(PaymentVerifierService.name);
  private client?: PublicClient;

  constructor(
    private readonly config: IssuerConfig,
    private readonly confirmations: ConfirmationPolicy,
  ) {}

  async verify(payment: Payment, merchantAddresses: string[]): Promise<void> {
    const srcChainId = Number(payment.srcChainId);
    const chain = chainBySrcChainId(srcChainId);

    if (!chain.evm) {
      throw new VerificationError(
        `NON_EVM_UNVERIFIABLE: no ${chain.name} node configured for this issuer`,
      );
    }

    const derived = paymentRef(srcChainId, payment.txHash, payment.outputIndex);
    if (derived.toLowerCase() !== payment.paymentRef.toLowerCase()) {
      throw new VerificationError(
        `PAYMENT_REF_MISMATCH: derived ${derived}, row says ${payment.paymentRef}`,
      );
    }

    const receipt = await this.receipt(payment.txHash);
    if (receipt.status !== 'success') {
      throw new VerificationError('TX_REVERTED: receipt status is not success');
    }
    if (Number(receipt.blockNumber) !== Number(payment.blockNumber)) {
      throw new VerificationError(
        `BLOCK_MISMATCH: chain says ${receipt.blockNumber}, row says ${payment.blockNumber}`,
      );
    }

    const block = await this.rpc().getBlock({
      blockNumber: receipt.blockNumber,
    });
    if (block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      throw new VerificationError('REORG: block hash no longer canonical');
    }

    const depth = this.confirmations.depthFor(srcChainId);
    const head = Number(await this.rpc().getBlockNumber());
    const confirmations = head - Number(receipt.blockNumber) + 1;
    if (confirmations < depth) {
      throw new VerificationError(
        `TOO_SHALLOW: ${confirmations} of ${depth} confirmations`,
      );
    }

    const log = receipt.logs.find(
      (entry) => Number(entry.logIndex) === payment.outputIndex,
    );
    if (!log) {
      throw new VerificationError(
        `NO_SUCH_LOG: log index ${payment.outputIndex} is not in this receipt`,
      );
    }

    const expectedToken = this.config.tokenAddress(srcChainId, payment.token);
    if (!expectedToken) {
      throw new VerificationError(
        `UNKNOWN_TOKEN: no contract configured for ${payment.token} on ${srcChainId}`,
      );
    }
    if (canonical(log.address) !== canonical(expectedToken)) {
      throw new VerificationError(
        `WRONG_TOKEN_CONTRACT: log came from ${log.address}`,
      );
    }

    let transfer: { from: string; to: string; value: bigint };
    try {
      const decoded = decodeEventLog({
        abi: TRANSFER_ABI,
        data: log.data,
        topics: log.topics,
      });
      transfer = decoded.args as unknown as {
        from: string;
        to: string;
        value: bigint;
      };
    } catch {
      throw new VerificationError(
        'NOT_A_TRANSFER: log is not an ERC-20 Transfer',
      );
    }

    const merchants = merchantAddresses.map(canonical);
    if (!merchants.includes(canonical(transfer.to))) {
      throw new VerificationError(
        `NOT_A_MERCHANT: ${transfer.to} is not a registered merchant address`,
      );
    }
    if (canonical(transfer.to) !== canonical(payment.merchantAddress)) {
      throw new VerificationError(
        `MERCHANT_MISMATCH: chain says ${transfer.to}, row says ${payment.merchantAddress}`,
      );
    }
    if (canonical(transfer.from) !== canonical(payment.fromAddress)) {
      throw new VerificationError(
        `PAYER_MISMATCH: chain says ${transfer.from}, row says ${payment.fromAddress}`,
      );
    }

    const expected = toScaled(
      payment.amount,
      decimalsFor(assetForToken(payment.token)),
    );
    if (transfer.value !== expected) {
      throw new VerificationError(
        `AMOUNT_MISMATCH: chain says ${transfer.value}, row says ${expected}`,
      );
    }

    this.logger.debug(
      `Payment ${payment.paymentRef} verified against ${this.config.id}'s own node`,
    );
  }

  private async receipt(txHash: string) {
    try {
      return await this.rpc().getTransactionReceipt({
        hash: normalizeTxHash(txHash) as Hex,
      });
    } catch (err) {
      throw new VerificationError(
        `RECEIPT_UNAVAILABLE: ${txHash} not found on this issuer's node (${String(err)})`,
      );
    }
  }

  private rpc(): PublicClient {
    this.client ??= createPublicClient({
      transport: http(this.config.rpcUrl),
    });
    return this.client;
  }
}
