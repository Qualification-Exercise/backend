import { HttpException } from '@nestjs/common';

/**
 * `String(err)` on an HttpException built from an `apiError` object yields
 * "HttpException: Http Exception" — the code, message and details live only in
 * `getResponse()`, so logs made that way say nothing about what failed.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    return typeof body === 'string' ? body : JSON.stringify(body);
  }
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
