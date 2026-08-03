import { NonceManagerService } from '@/relayer/services/nonce-manager.service';

describe('NonceManagerService', () => {
  it('hands out a sequential nonce per submission', async () => {
    const nonces = new NonceManagerService();
    const read = jest.fn().mockResolvedValue(7);
    const used: number[] = [];

    for (let i = 0; i < 3; i++) {
      await nonces.enqueue(read, async (nonce) => {
        used.push(nonce);
      });
    }

    expect(used).toEqual([7, 8, 9]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('serialises concurrent submissions instead of racing them', async () => {
    const nonces = new NonceManagerService();
    const read = jest.fn().mockResolvedValue(0);
    const order: string[] = [];

    const slow = nonces.enqueue(read, async (nonce) => {
      order.push(`start-${nonce}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`end-${nonce}`);
      return nonce;
    });
    const fast = nonces.enqueue(read, async (nonce) => {
      order.push(`start-${nonce}`);
      order.push(`end-${nonce}`);
      return nonce;
    });

    await expect(Promise.all([slow, fast])).resolves.toEqual([0, 1]);
    expect(order).toEqual(['start-0', 'end-0', 'start-1', 'end-1']);
  });

  it('does not burn a nonce a failed submission never used', async () => {
    const nonces = new NonceManagerService();
    const read = jest.fn().mockResolvedValue(5);
    jest.spyOn(nonces['logger'], 'warn').mockImplementation(() => undefined);

    await expect(
      nonces.enqueue(read, async () => {
        throw new Error('broadcast failed');
      }),
    ).rejects.toThrow('broadcast failed');

    const used: number[] = [];
    await nonces.enqueue(read, async (nonce) => {
      used.push(nonce);
    });

    expect(used).toEqual([5]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps running after a failure — one bad claim is not a stuck relayer', async () => {
    const nonces = new NonceManagerService();
    const read = jest.fn().mockResolvedValue(1);
    jest.spyOn(nonces['logger'], 'warn').mockImplementation(() => undefined);

    const failed = nonces.enqueue(read, async () => {
      throw new Error('nope');
    });
    const after = nonces.enqueue(read, async (nonce) => nonce);

    await expect(failed).rejects.toThrow('nope');
    await expect(after).resolves.toBe(1);
  });
});
