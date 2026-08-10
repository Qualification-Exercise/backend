import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository, type EntityManager } from 'typeorm';

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  resolvePageLimit,
} from '@/common/pagination/keyset-cursor';
import { isUniqueViolation } from '@/common/database/pg-errors';
import { IntervalLoop } from '@/common/scheduling/interval-loop';
import { chainKindOf, normalizeTxHash } from '@/chains';
import { EChainKind } from '@/chains/chain-kind.enum';
import { apiError } from '@/common/api-error';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import type { Env } from '@/config/env';
import {
  IdempotencyService,
  hashRequest,
} from '@/idempotency/services/idempotency.service';
import { ConfirmationPolicy } from '@/payments/confirmation-policy';
import { IndexerCursor } from '@/payments/entities/indexer-cursor.entity';
import type { CreateTransactionDTO } from '@/transactions/dtos/create-transaction.dto';
import type { ListTransactionsDTO } from '@/transactions/dtos/list-transactions.dto';
import { Transaction } from '@/transactions/entities/transaction.entity';
import { ETxSource, ETxStatus, ETxType } from '@/transactions/enums/tx.enum';
import { InvalidAddressError, normalizeAddress } from '@/wallets/address';
import { Wallet } from '@/wallets/entities/wallet.entity';

const STALE_LAG_SECONDS = 600;

const NOT_OBSERVED = 'NOT_OBSERVED';

export interface ITransactionResponse {
  id: string;
  type: ETxType;
  chain: EChainKind;
  srcChainId: number;
  txHash: string;
  outputIndex: number;
  direction: 'in' | 'out';
  token: string;
  amount: string;
  usdValue: string | null;
  from: string;
  to: string;
  fee: { token: string; amount: string } | null;
  status: ETxStatus;
  failureReason: string | null;
  confirmations: number | null;
  requiredConfirmations: number;
  claimId: string | null;
  source: ETxSource;
  at: string;
}

/**
 * History has two writers: the wallet transfer poller (what the indexer saw)
 * and the device (`POST /transactions`, what it just broadcast). They meet on
 * `UNIQUE (userId, srcChainId, txHash, outputIndex)`, so a device row appears
 * instantly and the poller's row for the same hash updates it in place.
 *
 * A device-written row is a *claim about the chain*, never an entitlement:
 * coupons still come from the poller and the issuers reading chains themselves.
 * A fabricated hash buys an attacker one line in their own history.
 */
@Injectable()
export class TransactionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly observationTimeoutMs: number;
  private readonly sweepIntervalMs: number;
  private readonly loop = new IntervalLoop(this.logger);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectRepository(Wallet)
    private readonly wallets: Repository<Wallet>,
    @InjectRepository(IndexerCursor)
    private readonly cursors: Repository<IndexerCursor>,
    private readonly confirmations: ConfirmationPolicy,
    private readonly idempotency: IdempotencyService,
    configService: ConfigService<Env, true>,
  ) {
    this.observationTimeoutMs = configService.get('TX_OBSERVATION_TIMEOUT_MS');
    this.sweepIntervalMs = configService.get('TX_SWEEP_INTERVAL_MS');
  }

  onModuleInit() {
    const message = 'Transaction observation sweep disabled';
    if (this.loop.disabled(this.sweepIntervalMs, message)) return;

    this.loop.start(this.sweepIntervalMs, () => this.sweepUnobserved());
  }

  onModuleDestroy() {
    this.loop.stop();
  }

  async list(userId: string, query: ListTransactionsDTO) {
    const limit = resolvePageLimit(query.limit);
    const after = query.cursor ? decodeKeysetCursor(query.cursor) : null;

    const qb = this.transactions
      .createQueryBuilder('tx')
      .where('tx."userId" = :userId', { userId })
      .orderBy('tx."occurredAt"', 'DESC')
      .addOrderBy('tx.id', 'DESC')
      .take(limit + 1);

    if (query.chain) qb.andWhere('tx.chain = :chain', { chain: query.chain });
    if (query.srcChainId !== undefined) {
      qb.andWhere('tx."srcChainId" = :srcChainId', {
        srcChainId: query.srcChainId,
      });
    }
    if (query.type) qb.andWhere('tx.type = :type', { type: query.type });
    if (query.status) {
      qb.andWhere('tx.status = :status', { status: query.status });
    }
    if (after) {
      qb.andWhere('(tx."occurredAt", tx.id) < (:at, :id)', after);
    }

    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    const lagSeconds = await this.indexerLagSeconds();

    return {
      items: await Promise.all(page.map((row) => this.toResponse(row))),
      page: {
        limit,
        nextCursor:
          rows.length > limit
            ? encodeKeysetCursor(
                page[page.length - 1].occurredAt,
                page[page.length - 1].id,
              )
            : null,
      },
      indexerLag: {
        seconds: lagSeconds,
        stale: lagSeconds === null || lagSeconds > STALE_LAG_SECONDS,
      },
    };
  }

  async findById(userId: string, id: string): Promise<ITransactionResponse> {
    const row = await this.transactions.findOne({ where: { id, userId } });
    if (!row) {
      throw new NotFoundException(
        apiError(EErrorCodes.TRANSACTION_NOT_FOUND, 'Unknown transaction'),
      );
    }
    return this.toResponse(row);
  }

  async record(
    userId: string,
    dto: CreateTransactionDTO,
    idempotencyKey: string | undefined,
  ): Promise<{ item: ITransactionResponse; created: boolean }> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException(
        apiError(
          EErrorCodes.IDEMPOTENCY_KEY_REQUIRED,
          'POST /transactions requires an Idempotency-Key header',
        ),
      );
    }

    const txHash = this.normalizeHash(dto.txHash);
    const requiredConfirmations = this.requiredConfirmations(dto);
    const wallet = await this.assertOwnAddress(userId, dto);

    return this.idempotency.run(
      userId,
      idempotencyKey.trim(),
      hashRequest({ ...dto, txHash }),
      (em) =>
        this.insertOrLoad(em, userId, dto, {
          txHash,
          requiredConfirmations,
          walletId: wallet.id,
        }),
    );
  }

  private async insertOrLoad(
    em: EntityManager,
    userId: string,
    dto: CreateTransactionDTO,
    resolved: {
      txHash: string;
      requiredConfirmations: number;
      walletId: string;
    },
  ): Promise<{ item: ITransactionResponse; created: boolean }> {
    const outputIndex = dto.outputIndex ?? 0;
    const broadcastAt = dto.broadcastAt
      ? new Date(dto.broadcastAt)
      : new Date();

    const row = em.create(Transaction, {
      userId,
      walletId: resolved.walletId,
      chain: dto.chain,
      srcChainId: dto.srcChainId,
      txHash: resolved.txHash,
      outputIndex,
      type: dto.type ?? ETxType.TRANSFER,
      direction: dto.direction,
      token: dto.token.toUpperCase(),
      amount: dto.amount,
      usdValue: null,
      fromAddress: dto.from,
      toAddress: dto.to,
      feeToken: dto.fee?.token.toUpperCase() ?? null,
      feeAmount: dto.fee?.amount ?? null,
      status: ETxStatus.PENDING,
      confirmations: 0,
      requiredConfirmations: resolved.requiredConfirmations,
      source: ETxSource.CLIENT,
      broadcastAt,
      occurredAt: broadcastAt,
    });

    try {
      await em.save(row);
      return { item: await this.toResponse(row), created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }

    const existing = await em.findOne(Transaction, {
      where: {
        userId,
        srcChainId: dto.srcChainId,
        txHash: resolved.txHash,
        outputIndex,
      },
    });
    if (!existing) throw new Error('Unique violation without a matching row');

    return { item: await this.toResponse(existing), created: false };
  }

  async sweepUnobserved(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - this.observationTimeoutMs);
      const result = await this.transactions.update(
        {
          source: ETxSource.CLIENT,
          status: ETxStatus.PENDING,
          occurredAt: LessThan(cutoff),
        },
        { status: ETxStatus.FAILED, failureReason: NOT_OBSERVED },
      );
      if (result.affected) {
        this.logger.warn(
          `Marked ${result.affected} device-reported transactions ${NOT_OBSERVED}`,
        );
      }
    } catch (err) {
      this.logger.error(`Transaction sweep failed: ${String(err)}`);
    }
  }

  private normalizeHash(txHash: string): string {
    try {
      return normalizeTxHash(txHash);
    } catch {
      throw new BadRequestException(
        apiError(
          EErrorCodes.INVALID_TX_HASH,
          'txHash must be 32 bytes of hex for this chain',
        ),
      );
    }
  }

  private requiredConfirmations(dto: CreateTransactionDTO): number {
    try {
      if (chainKindOf(dto.srcChainId) !== dto.chain) {
        throw new Error(
          `chain ${dto.chain} is not srcChainId ${dto.srcChainId}`,
        );
      }
      return this.confirmations.depthFor(dto.srcChainId);
    } catch (err) {
      throw new BadRequestException(
        apiError(EErrorCodes.UNSUPPORTED_CHAIN, String(err)),
      );
    }
  }

  private async assertOwnAddress(
    userId: string,
    dto: CreateTransactionDTO,
  ): Promise<Wallet> {
    const claimed = dto.direction === 'out' ? dto.from : dto.to;

    let normalized: string;
    try {
      normalized = normalizeAddress(claimed).address;
    } catch (err) {
      if (!(err instanceof InvalidAddressError)) throw err;
      throw this.walletMismatch();
    }

    const wallet = await this.wallets.findOne({
      where: { userId, chain: dto.chain },
    });
    if (!wallet) {
      throw new NotFoundException(
        apiError(
          EErrorCodes.WALLET_NOT_LINKED,
          `No ${dto.chain} wallet linked for this user`,
        ),
      );
    }
    if (wallet.address !== normalized) throw this.walletMismatch();
    return wallet;
  }

  private walletMismatch(): ForbiddenException {
    return new ForbiddenException(
      apiError(
        EErrorCodes.WALLET_MISMATCH,
        'The address is not registered to this user on that chain',
      ),
    );
  }

  private async toResponse(row: Transaction): Promise<ITransactionResponse> {
    return {
      id: row.id,
      type: row.type,
      chain: row.chain,
      srcChainId: Number(row.srcChainId),
      txHash: row.txHash,
      outputIndex: row.outputIndex,
      direction: row.direction,
      token: row.token,
      amount: row.amount,
      usdValue: row.usdValue,
      from: row.fromAddress,
      to: row.toAddress,
      fee:
        row.feeToken && row.feeAmount
          ? { token: row.feeToken, amount: row.feeAmount }
          : null,
      status: row.status,
      failureReason: row.failureReason,
      confirmations: row.blockHeight
        ? await this.confirmations.confirmations(
            Number(row.srcChainId),
            Number(row.blockHeight),
          )
        : row.confirmations,
      requiredConfirmations: row.requiredConfirmations,
      claimId: row.claimId,
      source: row.source,
      at: row.occurredAt.toISOString(),
    };
  }

  private async indexerLagSeconds(): Promise<number | null> {
    const [latest] = await this.cursors.find({
      order: { lastPolledAt: 'DESC' },
      take: 1,
    });
    if (!latest?.lastPolledAt) return null;
    return Math.max(
      0,
      Math.round((Date.now() - latest.lastPolledAt.getTime()) / 1000),
    );
  }
}
