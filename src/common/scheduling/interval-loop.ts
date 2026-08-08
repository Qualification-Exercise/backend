/**
 * The background-loop contract every polling role shares: an interval of zero
 * or less means "do not run" and says so once in the log, a scheduled tick is
 * fired without awaiting it, and the timer is unrefed so it never holds the
 * process open. `disabled()` is separate from `start()` because some roles run
 * async preflight between the two — a disabled loop must skip that preflight,
 * not perform it and then decline to schedule. The tick arrives as a callback
 * rather than bound at construction, so tests can replace the method it aims at.
 */
import type { Logger } from '@nestjs/common';

export class IntervalLoop {
  private timer?: NodeJS.Timeout;

  constructor(private readonly logger: Logger) {}

  disabled(intervalMs: number, message: string): boolean {
    if (intervalMs > 0) return false;
    this.logger.log(message);
    return true;
  }

  start(intervalMs: number, tick: () => Promise<void> | void): void {
    this.timer = setInterval(() => {
      void tick();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
