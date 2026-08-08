import { Inject, Injectable, Logger } from '@nestjs/common';
import { decodeEventLog, parseAbi, type Hex, type PublicClient } from 'viem';

import {
  chainBySrcChainId,
  chainKindOf,
  normalizeTxHash,
  paymentRef,
} from '@/chains';
import { ChainClientCache } from '@/common/chain/public-client';
import { EChainKind } from '@/chains/chain-kind.enum';
import { decimalsFor, toScaled } from '@/coupons/accrual';
import {
  CHAIN_VIEW_CONFIG,
  type IChainViewConfig,
} from '@/common/chain/chain-view.config';
import { VerificationError } from '@/common/chain/verification-error';
import { BitcoinPaymentVerifier } from '@/common/chain/verifiers/bitcoin.verifier';
import { TronPaymentVerifier } from '@/common/chain/verifiers/tron.verifier';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import type { Payment } from '@/payments/entities/payment.entity';
import { assetForToken } from '@/pricing/price-source';
import { normalizeAddress } from '@/wallets/address';

const TRANSFER_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export { VerificationError };

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
  private readonly clients = new ChainClientCache();

  constructor(
    @Inject(CHAIN_VIEW_CONFIG)
    private readonly config: IChainViewConfig,
    private readonly confirmations: ConfirmationPolicy,
    private readonly tron: TronPaymentVerifier,
    private readonly bitcoin: BitcoinPaymentVerifier,
  ) {}

  async verify(payment: Payment, merchantAddresses: string[]): Promise<void> {
    const srcChainId = Number(payment.srcChainId);

    const derived = paymentRef(srcChainId, payment.txHash, payment.outputIndex);
    if (derived.toLowerCase() !== payment.paymentRef.toLowerCase()) {
      throw new VerificationError(
        `PAYMENT_REF_MISMATCH: derived ${derived}, row says ${payment.paymentRef}`,
      );
    }

    const endpoint = this.config.rpcUrlFor(srcChainId);
    if (!endpoint) {
      throw new VerificationError(
        `NO_NODE: ${this.config.id} has no endpoint for chain ${srcChainId}`,
      );
    }
    const depth = this.confirmations.depthFor(srcChainId);

    switch (chainKindOf(srcChainId)) {
      case EChainKind.EVM:
        return this.verifyEvm(payment, merchantAddresses);
      case EChainKind.TRON:
        return this.tron.verify(
          payment,
          merchantAddresses,
          endpoint,
          depth,
          this.config.tokenAddress(srcChainId, payment.token),
        );
      case EChainKind.BITCOIN:
        return this.bitcoin.verify(payment, merchantAddresses, endpoint, depth);
      default:
        throw new VerificationError(
          `UNVERIFIABLE_CHAIN: ${chainBySrcChainId(srcChainId).name} cannot be re-verified by this process`,
        );
    }
  }

  private async verifyEvm(
    payment: Payment,
    merchantAddresses: string[],
  ): Promise<void> {
    const srcChainId = Number(payment.srcChainId);

    const receipt = await this.receipt(srcChainId, payment.txHash);
    if (receipt.status !== 'success') {
      throw new VerificationError('TX_REVERTED: receipt status is not success');
    }
    if (Number(receipt.blockNumber) !== Number(payment.blockNumber)) {
      throw new VerificationError(
        `BLOCK_MISMATCH: chain says ${receipt.blockNumber}, row says ${payment.blockNumber}`,
      );
    }

    const block = await this.rpc(srcChainId).getBlock({
      blockNumber: receipt.blockNumber,
    });
    if (block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      throw new VerificationError('REORG: block hash no longer canonical');
    }

    const depth = this.confirmations.depthFor(srcChainId);
    const head = Number(await this.rpc(srcChainId).getBlockNumber());
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

  private async receipt(srcChainId: number, txHash: string) {
    try {
      return await this.rpc(srcChainId).getTransactionReceipt({
        hash: normalizeTxHash(txHash) as Hex,
      });
    } catch (err) {
      throw new VerificationError(
        `RECEIPT_UNAVAILABLE: ${txHash} not found on this issuer's node (${String(err)})`,
      );
    }
  }

  private rpc(srcChainId: number): PublicClient {
    const url = this.config.rpcUrlFor(srcChainId);
    if (!url) {
      throw new VerificationError(
        `NO_NODE: ${this.config.id} has no RPC endpoint for chain ${srcChainId}`,
      );
    }
    return this.clients.get(url);
  }
}
