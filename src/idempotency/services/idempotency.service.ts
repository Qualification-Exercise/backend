import { createHash } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';

import { hoursToMs } from '@/common/time';
import { apiError } from '@/common/api-error';
import { EErrorCodes } from '@/common/enums/error-codes.enum';
import { IdempotencyKeyEntity } from '@/idempotency/entities/idempotency-key.entity';

const DEFAULT_TTL_HOURS = 24;

export function hashRequest(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');
}

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKeyEntity)
    private readonly keys: Repository<IdempotencyKeyEntity>,
  ) {}

  async run<T>(
    userId: string,
    key: string,
    requestHash: string,
    work: (em: EntityManager) => Promise<T>,
    ttlHours: number = DEFAULT_TTL_HOURS,
  ): Promise<T> {
    return this.keys.manager.transaction(async (em) => {
      const expiresAt = new Date(Date.now() + hoursToMs(ttlHours));
      const claimed: { id: string }[] = await em.query(
        `INSERT INTO idempotency_keys
           (user_id, idempotency_key, request_hash, response_data, expires_at)
         VALUES ($1, $2, $3, '{}'::jsonb, $4)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [userId, key, requestHash, expiresAt],
      );

      if (claimed.length === 0) {
        return this.replay<T>(em, userId, key, requestHash);
      }

      const result = await work(em);
      await em.query(
        `UPDATE idempotency_keys SET response_data = $1 WHERE id = $2`,
        [JSON.stringify(result), claimed[0].id],
      );
      return result;
    });
  }

  private async replay<T>(
    em: EntityManager,
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<T> {
    const [existing] = (await em.query(
      `SELECT request_hash, response_data FROM idempotency_keys
        WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, key],
    )) as { request_hash: string | null; response_data: T }[];

    if (!existing) {
      throw new ConflictException(
        apiError(
          EErrorCodes.IDEMPOTENCY_KEY_REUSED,
          'Idempotency key is being retried while its first attempt is still resolving',
        ),
      );
    }

    if (existing.request_hash !== requestHash) {
      throw new ConflictException(
        apiError(
          EErrorCodes.IDEMPOTENCY_KEY_REUSED,
          'Idempotency key was already used for a different request',
        ),
      );
    }

    return existing.response_data;
  }
}
