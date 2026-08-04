# Indexer client: circuit breaker, retry, redaction

## Context

BE-XX asks for a shared indexer client with resilience against the
published rate limits and API failures. A client already exists at
`src/indexer/services/indexer.service.ts` and is the sole caller of the WDK
indexer API (enforced by a grep-based test at `indexer.service.spec.ts:118-130`).
Per user direction, this plan does **not** build new endpoints (`/health`,
`/chains`, `/token-balances`), a live-API smoke test, or a custom
Postgres-backed token-bucket rate limiter / `@nestjs/throttler` — instead,
outgoing calls are wrapped in a circuit breaker (`opossum`), which fails
fast and stops hammering the indexer once it's unhealthy, protecting the
shared budget reactively rather than by pre-accounting every token.

What's already done (no change needed):
- Single call-site invariant (grep test).
- Batch-first usage (`payment-poller.service.ts` already calls
  `batchTokenTransfers`).
- Response schema validation via zod (`transferSchema` etc).

What's missing and in scope:
1. Wrap the outgoing request in an `opossum` circuit breaker: opens after a
   run of failures, fails fast (no HTTP call at all) while open, half-opens
   to probe recovery.
2. Retry with backoff+jitter on 429 (honoring `Retry-After` if present) and
   a capped retry on 5xx, run *inside* the breaker's guarded function (a
   successful retry counts as one breaker success, not a breaker trip).
   Other 4xx fails immediately, not retried, and is excluded from the
   breaker's failure stats (`errorFilter`) since a bad request isn't the
   indexer's fault.
3. API key redaction: never let a raw axios error (which carries the
   request headers) escape `IndexerService` — extract status + response
   body only.

Explicitly skipped per user direction: Postgres token-bucket, per-caller
reserved budget, in-memory cache for non-payment traffic, `/health`/`/chains`/
`/token-balances` methods, live-API scheduled smoke test / CI changes.

opossum's breaker state is per-process only — it has no built-in
distributed store, so the *decision* to fail fast still lives per-process.
What's shared via Redis (below) is purely the *reported* state for
`/health`, so any process can see if another instance's breaker is open.
`REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` already exist in `env.ts` but are
currently dead (no `ioredis` dependency, nothing reads them) — this is the
first real use of them.

## Design

**Dependency**: add `opossum` + `@types/opossum` to `package.json`.

**`IndexerService.request()`** (`src/indexer/services/indexer.service.ts`):
replace the current in-memory `queue`/`MIN_REQUEST_GAP_MS` serialization
with a single module-level `CircuitBreaker` instance wrapping the axios
call:

```ts
const breaker = new CircuitBreaker(this.doRequest.bind(this), {
  timeout: 15_000,
  errorThresholdPercentage: cbErrorThresholdPct, // env, default 50
  resetTimeout: cbResetTimeoutMs,                // env, default 30_000
  volumeThreshold: cbVolumeThreshold,             // env, default 5
  errorFilter: (err) => !isRetryableIndexerError(err), // 4xx (not 429) doesn't count against the breaker
});
```

`doRequest()` is the existing axios call plus the retry loop:
- 429 → wait `Retry-After` header (seconds) if present, else exponential
  backoff with jitter, up to `INDEXER_MAX_RETRIES` attempts; still failing
  after that → throw `INDEXER_RATE_LIMITED`.
- 5xx → same cap, then throw `INDEXER_UNAVAILABLE`.
- other 4xx → throw immediately as `INDEXER_REQUEST_FAILED`, indexer's own
  `{error, message}` body copied into the exception's details.
- breaker open (fails fast, no HTTP call made) → throw `INDEXER_UNAVAILABLE`
  from the breaker's own rejection.

All thrown as `HttpException` with `apiError(code, message, details)`
(`src/common/api-error.ts`) — matching the pattern actually used in this
codebase (no custom `*Exception` classes exist despite CLAUDE.md describing
one; `GlobalExceptionFilter` already handles plain `HttpException`/`Error`).

**Redaction**: the catch block around the axios call builds the thrown
error from `err.response?.status` and `err.response?.data` only — never
`err.config` or `err.request`, which is where the `x-api-key` header lives.

**Extract `sleep(ms)` as a private method** so retry/backoff tests can mock
it instead of waiting on real timers.

**Error codes** — add to `src/common/enums/error-codes.enum.ts` under a new
`// Indexer` group: `INDEXER_RATE_LIMITED`, `INDEXER_UNAVAILABLE`,
`INDEXER_REQUEST_FAILED`.

**Env vars** — add to `src/config/env.ts` and `.env.example`:
```
INDEXER_MAX_RETRIES=3                    # z.coerce.number().int().nonnegative().default(3)
INDEXER_CB_ERROR_THRESHOLD_PCT=50        # z.coerce.number().int().min(1).max(100).default(50)
INDEXER_CB_RESET_TIMEOUT_MS=30000        # z.coerce.number().int().positive().default(30_000)
INDEXER_CB_VOLUME_THRESHOLD=5            # z.coerce.number().int().positive().default(5)
```

**Health endpoint**: `IndexerService` registers listeners on the breaker's
`open`/`close`/`halfOpen` events; each writes the new state to a single
Redis key (`indexer:breaker:state`, `EX 60`) via `ioredis` — fire-and-forget,
same swallow-on-failure style as `CounterService.increment`
(`src/common/metrics/counter.service.ts:21-32`). The 60s TTL means a crashed
process's stale "open" report clears itself instead of sticking forever.

`getBreakerState(): Promise<'closed' | 'open' | 'half-open'>` reads that
Redis key first; on a miss or Redis error, falls back to the local breaker's
own `.opened`/`.halfOpen` flags. `HealthModule` imports `IndexerModule`
(already exports `IndexerService`) and `HealthService.check()` adds an
`indexer: { breaker: state }` field alongside the existing DB check. No new
call to the indexer's own `/health` — this doesn't touch the indexer's
10 req/hour budget.

## Files touched

- `package.json` — add `opossum`, `@types/opossum`, `ioredis`.
- `src/indexer/services/indexer.service.ts` — remove in-memory queue/gap,
  wrap request in `opossum` circuit breaker, add retry loop for 429/5xx,
  sanitize errors before throwing, extract `sleep()`, add breaker event
  listeners publishing to Redis, add `getBreakerState()`.
- `src/health/health.module.ts` — import `IndexerModule`.
- `src/health/services/health.service.ts` — inject `IndexerService`, add
  `indexer.breaker` field to `check()`'s return shape.
- `src/common/enums/error-codes.enum.ts` — add 3 codes.
- `src/config/env.ts`, `.env.example` — add 4 vars.
- `src/indexer/services/indexer.service.spec.ts` — extend: retry-on-429
  (honors `Retry-After`), retry-on-5xx cap, fail-fast-on-other-4xx, error
  redaction (no headers in thrown error), breaker opens after repeated
  failures and fails fast without an HTTP call, `getBreakerState()` reflects
  breaker status (mock `ioredis` so tests don't need a real Redis). Mock
  `sleep` so backoff tests don't need real timers; the existing BE-07
  single-call-site grep test must keep passing untouched.
- `src/health/services/health.service.spec.ts` — new (none exists today):
  `indexer.breaker` reflects `IndexerService.getBreakerState()`.

## Verification

- `npm run test` — extended `indexer.service.spec.ts` plus unchanged
  `payment-poller.service.spec.ts` (no behavior change to its call sites);
  `health.service.spec.ts` new. `REDIS_HOST`/`REDIS_PORT` already exist in
  `env.ts` with defaults and `ci.yml` already runs a `redis:7-alpine`
  service — no CI or `.env.example` changes needed for Redis itself.
- `npm run lint:fix && npm run build`.
- Local: `npm run docker:up` already starts Redis alongside Postgres —
  confirm `redis-cli GET indexer:breaker:state` reflects the breaker after
  forcing failures.
- Manual: hit `GET /indexer/token-transfers` against a stubbed/misbehaving
  indexer (or temporarily point `INDEXER_BASE_URL` at an unreachable host)
  and confirm repeated failures trip the breaker — subsequent calls fail
  fast instead of hanging on a timeout each time.
