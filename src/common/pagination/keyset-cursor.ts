/**
 * Keyset pagination shared by every list route. A cursor is the last row's
 * `(timestamp, id)` pair, base64url-encoded, and the query asks for one row
 * more than the page so the presence of a next page is known without a count.
 * Keyset rather than offset: a row created mid-scroll cannot shift another row
 * from one page onto the next.
 */
import { BadRequestException } from '@nestjs/common';

import { apiError } from '@/common/api-error';
import { EErrorCodes } from '@/common/enums/error-codes.enum';

export const PAGE_SIZE = 10;

export interface IKeysetCursor {
  at: string;
  id: string;
}

export function encodeKeysetCursor(at: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ at: new Date(at).toISOString(), id }),
  ).toString('base64url');
}

export function decodeKeysetCursor(cursor: string): IKeysetCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString(),
    ) as IKeysetCursor;
    if (typeof parsed?.at !== 'string' || typeof parsed?.id !== 'string') {
      throw new Error('bad shape');
    }
    return parsed;
  } catch {
    throw new BadRequestException(
      apiError(EErrorCodes.INVALID_CURSOR, 'Cursor is not one we issued'),
    );
  }
}

export function resolvePageLimit(
  requested: number | undefined,
  fallback: number = PAGE_SIZE,
  max: number = PAGE_SIZE,
): number {
  return Math.min(requested ?? fallback, max);
}
