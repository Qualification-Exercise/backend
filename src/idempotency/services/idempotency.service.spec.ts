import { ConflictException } from '@nestjs/common';

import {
  IdempotencyService,
  hashRequest,
} from '@/idempotency/services/idempotency.service';

interface IRow {
  id: string;
  user_id: string;
  idempotency_key: string;
  request_hash: string;
  response_data: unknown;
}

function fakeKeysRepo() {
  const rows: IRow[] = [];
  let seq = 0;

  const em = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: async (sql: string, params: any[]): Promise<any[]> => {
      if (sql.includes('INSERT INTO idempotency_keys')) {
        const [userId, key, hash] = params as string[];
        if (
          rows.some((r) => r.user_id === userId && r.idempotency_key === key)
        ) {
          return [];
        }
        const row: IRow = {
          id: `k${++seq}`,
          user_id: userId,
          idempotency_key: key,
          request_hash: hash,
          response_data: {},
        };
        rows.push(row);
        return [{ id: row.id }];
      }
      if (sql.includes('SELECT request_hash')) {
        const [userId, key] = params as string[];
        return rows.filter(
          (r) => r.user_id === userId && r.idempotency_key === key,
        );
      }
      if (sql.includes('UPDATE idempotency_keys')) {
        const [json, id] = params as string[];
        const row = rows.find((r) => r.id === id)!;
        row.response_data = JSON.parse(json);
        return [];
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };

  return {
    rows,
    manager: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transaction: (cb: (m: any) => Promise<unknown>) => cb(em),
    },
  };
}

function build() {
  const keys = fakeKeysRepo();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { keys, service: new IdempotencyService(keys as any) };
}

describe('IdempotencyService', () => {
  const hash = hashRequest({ couponId: 'cpn-1' });

  it('runs the work once and replays the stored response on retry', async () => {
    const { service } = build();
    const work = jest.fn().mockResolvedValue({ claimId: 'clm-1' });

    const first = await service.run('u1', 'key-1', hash, work);
    const second = await service.run('u1', 'key-1', hash, work);

    expect(first).toEqual({ claimId: 'clm-1' });
    expect(second).toEqual({ claimId: 'clm-1' });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('refuses to reuse one key for a different request', async () => {
    const { service } = build();
    await service.run('u1', 'key-1', hash, async () => ({ claimId: 'clm-1' }));

    await expect(
      service.run('u1', 'key-1', hashRequest({ couponId: 'cpn-2' }), async () =>
        Promise.resolve({ claimId: 'clm-2' }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('scopes keys per user, so one user cannot replay another response', async () => {
    const { service } = build();
    const work = jest.fn().mockResolvedValue({ claimId: 'clm-1' });

    await service.run('u1', 'key-1', hash, work);
    await service.run('u2', 'key-1', hash, work);

    expect(work).toHaveBeenCalledTimes(2);
  });
});
