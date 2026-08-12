import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * TEMPORARY: traces the auth and secrets-backup round trip in production.
 *
 * Logged at `error` level on purpose — the deploy only ships error lines, and
 * a `log`-level trace would be invisible there. Delete this file and its
 * `APP_INTERCEPTOR` entry in `app.module.ts` once the login bug is found.
 *
 * ponytail: prefix allowlist, not a per-route decorator — one file to delete.
 */
const TRACED_PATHS = ['/auth/', '/secrets'];

/** Anything whose plaintext must never reach a log line, at any nesting. */
const SECRET_KEYS = new Set([
  'idToken',
  'accessToken',
  'refreshToken',
  'token',
  'entropy',
  'seed',
  'blob',
  'mnemonic',
  'privateKey',
]);

function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return `<string len=${value.length}>`;
  if (Array.isArray(value))
    return depth > 3 ? '<array>' : value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 3) return '<object>';
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key,
        SECRET_KEYS.has(key) ? '<redacted>' : redact(val, depth + 1),
      ]),
    );
  }
  return value;
}

@Injectable()
export class DebugTraceInterceptor implements NestInterceptor {
  private readonly logger = new Logger('DebugTrace');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!TRACED_PATHS.some((prefix) => req.path.includes(prefix))) {
      return next.handle();
    }

    const tag = `${req.method} ${req.path}`;
    const startedAt = Date.now();
    this.logger.error(
      `trace_request ${tag} body=${JSON.stringify(redact(req.body))}`,
    );

    return next.handle().pipe(
      tap({
        next: (body) =>
          this.logger.error(
            `trace_response ${tag} ${Date.now() - startedAt}ms ` +
              `body=${JSON.stringify(redact(body))}`,
          ),
        error: (err: unknown) =>
          this.logger.error(
            `trace_error ${tag} ${Date.now() - startedAt}ms ` +
              `status=${err instanceof HttpException ? err.getStatus() : 500} ` +
              `body=${
                err instanceof HttpException
                  ? JSON.stringify(err.getResponse())
                  : String(err)
              }`,
          ),
      }),
    );
  }
}
