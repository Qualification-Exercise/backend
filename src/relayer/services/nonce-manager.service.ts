import { Injectable, Logger } from '@nestjs/common';

export type NonceReader = () => Promise<number>;

/**
 * One sender, one sequence, one transaction in flight at a time.
 *
 * With per-payment claims this process is the throughput bottleneck by design,
 * and the failure mode of getting that wrong is nasty: two transactions built
 * from the same "pending" count replace each other, so one claim silently never
 * lands. Serialising submission and handing out nonces from a local counter is
 * the boring fix — the queue is what makes the counter correct.
 */
@Injectable()
export class NonceManagerService {
  private readonly logger = new Logger(NonceManagerService.name);
  private next?: number;
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(
    readPendingNonce: NonceReader,
    work: (nonce: number) => Promise<T>,
  ): Promise<T> {
    const run = this.tail.then(async () => {
      const nonce = await this.reserve(readPendingNonce);
      try {
        const result = await work(nonce);
        this.next = nonce + 1;
        return result;
      } catch (err) {
        this.logger.warn(
          `Nonce ${nonce} not consumed; resyncing from the chain: ${String(err)}`,
        );
        this.next = undefined;
        throw err;
      }
    });

    this.tail = run.catch(() => undefined);
    return run;
  }

  resync(): void {
    this.next = undefined;
  }

  private async reserve(readPendingNonce: NonceReader): Promise<number> {
    if (this.next === undefined) {
      this.next = await readPendingNonce();
      this.logger.log(`Nonce sequence starts at ${this.next}`);
    }
    return this.next;
  }
}
