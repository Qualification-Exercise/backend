import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { apiError } from '@/common/api-error';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import type { StoreSecretDTO } from '@/secrets/dtos/store-secret.dto';
import {
  ESecretKind,
  WalletSecret,
} from '@/wallets/entities/wallet-secret.entity';

export interface ISecretItem {
  entropy?: string;
  seed?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Ciphertext in, ciphertext out: the blob is an opaque string, `metadata` is
 * whatever the client put there, and a write overwrites, so a user holds at
 * most one blob per kind.
 */
@Injectable()
export class SecretsService {
  constructor(
    @InjectRepository(WalletSecret)
    private readonly secrets: Repository<WalletSecret>,
  ) {}

  async store(
    userId: string,
    kind: ESecretKind,
    dto: StoreSecretDTO,
  ): Promise<void> {
    const blob = dto[kind];
    if (!blob) {
      throw new BadRequestException(
        apiError(EErrorCodes.INVALID_REQUEST, `Body must carry "${kind}"`),
      );
    }

    // Overwrite, not append: the unique (user_id, kind) index turns a second
    // write into an update, and `createdAt` is set explicitly so `status`
    // reports when the blob was last replaced rather than first stored.
    await this.secrets.upsert(
      // Cast: TypeORM's deep-partial type cannot express a free-form jsonb
      // column, and `metadata` is exactly that.
      this.secrets.create({
        userId,
        kind,
        blob,
        metadata: dto.metadata ?? null,
        createdAt: new Date(),
      }) as Parameters<Repository<WalletSecret>['upsert']>[0],
      { conflictPaths: ['userId', 'kind'] },
    );
  }
  async list(userId: string, kind: ESecretKind): Promise<ISecretItem[]> {
    const rows = await this.secrets.find({
      where: { userId, kind },
      order: { createdAt: 'ASC' },
    });

    return rows.map((row) => ({
      [kind]: row.blob,
      ...(row.metadata ? { metadata: row.metadata } : {}),
    }));
  }

  /**
   * Wipes every blob of one kind for the user. The server holds ciphertext it
   * cannot read, so there is nothing to soft-delete and nothing to restore
   * from — a caller who deletes a seed without its own copy has lost the wallet.
   */
  async remove(
    userId: string,
    kind: ESecretKind,
  ): Promise<{ deleted: number }> {
    const { affected } = await this.secrets.delete({ userId, kind });
    const deleted = affected ?? 0;

    return { deleted };
  }

  async status(userId: string) {
    const rows = await this.secrets.find({ where: { userId } });
    const latest = rows.reduce<Date | null>(
      (max, row) => (!max || row.createdAt > max ? row.createdAt : max),
      null,
    );

    return {
      entropy: rows.some((row) => row.kind === ESecretKind.ENTROPY),
      seed: rows.some((row) => row.kind === ESecretKind.SEED),
      updatedAt: latest?.toISOString() ?? null,
    };
  }
}
