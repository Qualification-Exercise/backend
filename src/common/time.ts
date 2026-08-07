/** Durations in milliseconds, so call sites read as time rather than as digits. */

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;

export function hoursToMs(hours: number): number {
  return hours * HOUR_MS;
}
