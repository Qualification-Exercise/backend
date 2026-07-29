# WDK Backend Scaffold

Backend service for Tether's "Qualification Exercise for Prospective WDK Service Providers." This is a production-quality scaffold for building a cashback/coupon system with multi-chain asset support, OIDC-based authentication, and integration with a WDK-based blockchain indexer.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Applications                      │
│           (Web, Mobile, Third-party Services)               │
└────────────────────┬────────────────────────────────────────┘
                     │ REST API (Bearer JWT)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   NestJS Backend                             │
│                                                              │
│  ┌──────────┐  ┌─────────┐  ┌──────────┐  ┌────────────┐  │
│  │   Auth   │  │  Users  │  │ Wallets  │  │Transactions│  │
│  └──────────┘  └─────────┘  └──────────┘  └────────────┘  │
│                                                              │
│  ┌──────────┐  ┌─────────┐  ┌──────────┐                   │
│  │ Coupons  │  │ Indexer │  │  Health  │                   │
│  └──────────┘  └─────────┘  └──────────┘                   │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
   ┌─────────┐  ┌─────────┐  ┌──────────┐
   │PostgreSQL  │  Redis   │  │ Indexer  │
   │ (Users,    │(Cache,  │  │(WDK)     │
   │ Wallets,   │ Queues) │  │          │
   │Txs, Coupons)         │  └──────────┘
   └─────────┘  └─────────┘       │
                                   │
                        ┌──────────┴──────────┐
                        │                     │
                        ▼                     ▼
                   ┌──────────┐         ┌──────────┐
                   │Utility   │         │Blockchain│
                   │Token ERC-20        │Networks  │
                   │Contract  │         │(BTC,     │
                   └──────────┘         │Spark,    │
                                        │Arbitrum, │
                                        │etc)      │
                                        └──────────┘
```

## Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Runtime | Node.js 18+ | Stable, widely-used async runtime |
| Language | TypeScript (strict) | Type safety, better maintainability |
| Framework | NestJS | Enterprise-grade, modular architecture |
| Database | PostgreSQL | ACID compliance, strong schema support |
| ORM | TypeORM | First-class TypeScript support, migrations |
| Auth | Passport.js + JWT | Provider-agnostic, industry-standard |
| Config | @nestjs/config + Zod | Type-safe env validation at startup |
| Logging | Pino | Structured, performant logging |
| Testing | Jest | Comprehensive unit/integration testing |
| Linting | ESLint + Prettier | Code quality & consistency |
| Docker | Docker Compose | Local infra (Postgres, Redis, Adminer) |

## Prerequisites

- **Node.js**: 18.0.0 or higher (pin via `.nvmrc`)
- **npm**: 9+ or equivalent
- **Docker & Docker Compose**: For local infrastructure (Postgres, Redis)
- **Git**: For version control

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd backend
npm install
```

### 2. Set Up Environment

```bash
cp .env.example .env
# Edit .env with your configuration
nano .env
```

### 3. Start Infrastructure

```bash
npm run docker:up

# Wait for services to be healthy (~10 seconds)
# Check Postgres: psql -h localhost -U postgres -d wdk_dev
# Check Adminer: http://localhost:8080
```

### 4. Database Migrations

```bash
# Run pending migrations
npm run migration:run

# Optional: seed with reference data
npm run seed
```

### 5. Start Development Server

```bash
npm run dev
# Application available at http://localhost:3000
```

### 6. Health Check

```bash
curl http://localhost:3000/health
# Response: { "status": "ok", "database": "connected", "timestamp": "..." }
```

## Repo Structure

```
src/
├── auth/                      # OIDC/JWT provider integration
│   ├── services/              # Auth logic (JWT validation, OIDC exchange)
│   ├── controllers/           # Auth endpoints (/auth/token, /auth/profile)
│   └── interfaces/            # IAuthPayload, ITokenResponse, etc.
│
├── users/                     # User identity & profile management
│   ├── entities/              # User entity
│   ├── services/              # User business logic
│   ├── controllers/           # User endpoints
│   ├── dtos/                  # CreateUserDTO, UpdateUserDTO
│   └── repositories/          # (Optional) custom query methods
│
├── wallets/                   # Wallet address ↔ user mapping
│   ├── entities/              # Wallet entity (address, chain, seed ref)
│   ├── services/              # Wallet creation, seed encryption
│   ├── controllers/           # Wallet endpoints
│   ├── dtos/                  # CreateWalletDTO
│   └── interfaces/            # IWalletResponse, etc.
│
├── transactions/              # On-chain transaction records
│   ├── entities/              # Transaction entity (txHash, status, amount)
│   ├── services/              # Transaction indexing, status updates
│   ├── controllers/           # Transaction endpoints
│   └── dtos/                  # CreateTransactionDTO
│
├── coupons/                   # Coupon issuance & redemption
│   ├── entities/              # Coupon, UtilityTokenClaim entities
│   ├── services/              # Coupon issuance, claim logic
│   ├── controllers/           # Coupon endpoints (/coupons/issue, /claim)
│   ├── dtos/                  # IssueCouponDTO, ClaimCouponDTO
│   └── interfaces/            # ICouponResponse, IClaimResponse
│
├── indexer/                   # WDK blockchain indexer client
│   ├── services/              # HTTP client for indexer API
│   ├── controllers/           # Indexer endpoints
│   ├── interfaces/            # IIndexerTransaction, IBalance
│   └── dtos/                  # Query DTOs for indexer
│
├── config/                    # Environment configuration
│   ├── env.ts                 # Zod schema, validation logic
│   └── (no additional files needed)
│
├── common/                    # Shared utilities
│   ├── filters/               # Global exception filters
│   ├── guards/                # JwtAuthGuard, RolesGuard, etc.
│   ├── interceptors/          # Response formatting, error handling
│   ├── decorators/            # @IsAuthenticated, @CurrentUser, etc.
│   └── constants/             # App-wide constants
│
├── database/                  # TypeORM configuration & migrations
│   ├── data-source.ts         # DataSource for typeorm CLI
│   ├── database.module.ts     # NestJS database module
│   ├── migrations/            # SQL migration files
│   └── seed.ts                # Reference data seeder
│
├── health/                    # Health check endpoint
│   ├── controllers/           # GET /health
│   ├── services/              # DB connectivity checks
│   └── (minimal module)
│
├── app.module.ts              # Root module (imports all feature modules)
└── main.ts                    # Application entry point
```

## Environment Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | App environment (development, production, test) |
| `PORT` | `3000` | Server port |
| `APP_NAME` | `wdk-backend` | Application name (logging) |
| **Database** |
| `DB_HOST` | `localhost` | Postgres hostname |
| `DB_PORT` | `5432` | Postgres port |
| `DB_USERNAME` | `postgres` | Postgres user |
| `DB_PASSWORD` | `postgres` | Postgres password |
| `DB_NAME` | `wdk_dev` | Database name |
| `DB_SYNCHRONIZE` | `false` | Use migrations, never `true` in production |
| **Redis** |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | `` | Redis password (empty if none) |
| **Auth (OIDC/JWT)** |
| `JWT_SECRET` | (min 32 chars) | Secret for signing JWTs |
| `JWT_EXPIRATION` | `3600` | Token TTL in seconds |
| `AUTH_PROVIDER` | `auth0` | Auth provider (`auth0`, `keycloak`, `cognito`) |
| `AUTH_ISSUER` | `https://your-auth-provider.auth0.com/` | OIDC issuer URL |
| `AUTH_AUDIENCE` | `https://your-backend-api` | JWT audience claim |
| `JWKS_URI` | `https://your-auth-provider.auth0.com/.well-known/jwks.json` | JWKS endpoint for public keys |
| **Encryption** |
| `SEED_BACKUP_ENCRYPTION_KEY` | (min 32 chars) | Key for encrypting seed phrases |
| **Indexer** |
| `INDEXER_BASE_URL` | `http://localhost:8000` | WDK indexer base URL |
| `INDEXER_API_KEY` | `test-api-key` | API key for indexer access |
| **Smart Contract** |
| `UTILITY_TOKEN_CONTRACT_ADDRESS` | `0x0000...` | Deployed utility token contract address |
| `UTILITY_TOKEN_CONTRACT_ABI` | `[...]` | Contract ABI as JSON string |
| **Chains & Assets** |
| `SUPPORTED_CHAINS` | `BTC,SPARK,ARBITRUM,...` | Comma-separated list of supported chains |
| `SUPPORTED_ASSETS` | `BTC,USDT` | Comma-separated list of supported assets |
| **Logging** |
| `LOG_LEVEL` | `debug` | Log level (error, warn, info, debug) |

## Database & Migrations

### Generate a New Migration

After modifying entities, generate the migration:

```bash
npm run migration:generate -- src/database/migrations/InitialSchema
```

Review the generated SQL in `src/database/migrations/`.

### Run Migrations

```bash
npm run migration:run
```

### Revert Last Migration

```bash
npm run migration:revert
```

### Seed Reference Data

```bash
npm run seed
```

See `src/database/seed.ts` for seed logic (currently a stub).

## Testing

### Unit Tests

```bash
npm run test
```

Runs all `*.spec.ts` files. Tests must isolate dependencies (mock repositories, services).

**Example**: `src/users/services/users.service.spec.ts`

### Integration Tests

```bash
npm run test -- test/
```

Runs tests with real Postgres/Redis (requires `docker:up`).

**Example**: `test/users.integration.spec.ts`

### Coverage Report

```bash
npm run test:cov
```

Generates a coverage report in `coverage/`. Current threshold is **20%** (scaffolding phase); increase as features are implemented.

**Excluded from coverage**:
- Entity files (`.entity.ts`)
- Module files (`.module.ts`)
- `src/main.ts`

## Auth

### Provider-Agnostic Design

The auth module supports any OIDC-compliant provider:
- **Auth0**
- **Keycloak**
- **AWS Cognito**
- **Azure AD**
- Others

Configuration is driven entirely by environment variables:
- `AUTH_ISSUER`: OIDC issuer URL
- `AUTH_AUDIENCE`: JWT audience claim
- `JWKS_URI`: Public keys endpoint

### JWT Validation Flow

1. Client exchanges auth code for JWT (handled by auth provider)
2. Client includes JWT in `Authorization: Bearer <token>` header
3. `JwtAuthGuard` (via `passport-jwt`) validates:
   - Signature (fetched from JWKS endpoint, cached)
   - Issuer claim
   - Audience claim
   - Expiration
4. Request continues with `req.user` populated

### Protected Endpoints

```typescript
@Get('profile')
@UseGuards(JwtAuthGuard)
async getProfile(@Request() req: any) {
  return req.user; // Contains sub, email, other claims
}
```

## Coupons API (BE-10)

| Method | Path                    | Purpose                                  |
| ------ | ----------------------- | ---------------------------------------- |
| `GET`  | `/coupons`              | The coupon screen; `?status=&limit=&cursor=` |
| `GET`  | `/coupons/:id`          | One coupon                               |
| `GET`  | `/coupons/by-code/:code`| Resolve a manually typed code            |

All three are JWT-guarded and scoped to the caller. Each item carries the state,
the UTL amount, the source payment (asset, network, smallest-unit amount, USD
value, live confirmations) and whether it is claimable.

- **`PENDING` items are projected from unconfirmed payments.** Accrual only ever
  creates `ISSUED` coupons, so a payment below the confirmation depth has no coupon
  row yet — the list unions those in, with `confirmations` / `requiredConfirmations`
  read live from the chain head, which is what MOB-15 renders as "4 / 12". They get
  a synthetic `pending:<paymentRef>` id that `GET /coupons/:id` also resolves, so
  the ids the API hands out are never dead links.
- **Keyset pagination** over `(createdAt, id)` descending. A coupon issued
  mid-scroll cannot shift a row from one page onto another, which offset paging
  would allow. `nextCursor` is opaque; one we did not issue is a `400`.
- **404, never 403.** Another user's coupon — by id or by code — is `404
  COUPON_NOT_FOUND`, byte-identical to the response for a code that does not exist.
  A 403 would confirm the code exists, which is exactly what a guesser wants. The
  ownership check on the code path is `timingSafeEqual`, so the two outcomes are
  not distinguishable by timing either.
- **`usdValue` carries 6 decimals**, not 2. The demo's payments are worth fractions
  of a cent, and `"0.00"` would tell a user their cashback came from nothing.

## Accrual (BE-09)

Turns one confirmed, priced payment into exactly one coupon:

```
amount = floor( payment_amount × asset_usd_price × cashback / utl_usd_rate )
```

normalised to 18 decimals and stored in UTL wei. Every step is bigint arithmetic —
a float here is a way for two issuers to derive two different digests from the same
inputs, and then no signature reaches the threshold.

| Variable                    | Meaning                                        |
| --------------------------- | ---------------------------------------------- |
| `UTL_USD_RATE`              | Administrative UTL price in USD (demo: `1`)     |
| `CASHBACK_BPS`              | Cashback rate in basis points (`500` = 5 %)     |
| `ACCRUAL_POLL_INTERVAL_MS`  | Tick interval; `0` disables the loop            |
| `ACCRUAL_BATCH_SIZE`        | Payments accrued per tick                       |

Both rates are configuration, never literals, and both are served by `GET /config`
so a client can explain the number it shows:

```json
{ "utlUsdRate": "1", "cashbackBps": 500, "cashbackRate": 0.05, "confirmationDepths": { … } }
```

- **Floor everywhere.** The payment is truncated to the asset's own precision first
  (6 for USD₮, 8 for BTC), and the single division at the end is the only rounding
  step. Nothing rounds up into a mint.
- **Supported assets** are USD₮ (6 decimals), BTC (8), XAUT (6) and ETH (18). ETH
  needs no re-scaling — it is already the contract's unit. Note that ETH prices and
  accrues, but the Indexer API serves no `eth` token on any chain
  (`params/token must be equal to one of the allowed values`), so no ETH payment can
  be ingested today. A merchant registered with `token='eth'` is skipped with a
  warning and the other merchants still poll; a batch request fails as a whole, so
  sending it would stall everyone's cashback.
- **Golden vectors** live in `test/fixtures/accrual/golden-amounts.json` and are
  reused verbatim by BE-13. Both sides must reproduce every amount byte for byte; a
  mismatch is a real bug, never a reason to edit the file.
- **Coupon codes** come from a CSPRNG — 16 Crockford-style base32 characters in
  four groups, no `I`/`L`/`O`/`U`, unrelated to the coupon id or the payment.
- **Orphaned payments void their coupons** before any claim can reach them. A
  coupon that was *already* claimed is not rewritten — it raises
  `security_event=coupon.orphaned_after_claim`, because the money is gone and
  pretending otherwise hides the incident.
- **Illegal state transitions are rejected by the database.** The migration
  installs a trigger over the documented machine:

  ```
  PENDING → ISSUED → PENDING_ATTESTATION → ATTESTED → CLAIM_SUBMITTED → CLAIMED
  issuer rejection / deadline / reorg / tx failure → back to ISSUED
  anything still open → EXPIRED / ORPHANED;  CLAIMED → ORPHANED only
  ```

  `UPDATE coupons SET status='CLAIMED'` from `PENDING_ATTESTATION` fails with
  `illegal coupon transition PENDING_ATTESTATION -> CLAIMED`.

## Pricing (BE-08)

One canonical asset→USD price per confirmed payment, frozen into `price_snapshots`
and keyed by `paymentRef`. It exists so all K issuers compute a **byte-identical**
`amount` — a price each issuer fetched for itself would differ by a few wei and
produce K signatures over K different digests, none of which reach the threshold.

Prices come from `@tetherto/wdk-pricing-bitfinex-http`, the same client the wallet
SDK uses, rather than a hand-rolled Bitfinex call.

| Variable                    | Meaning                              |
| --------------------------- | ------------------------------------ |
| `PRICING_POLL_INTERVAL_MS`  | Tick interval; `0` disables the loop  |
| `PRICING_BATCH_SIZE`        | Payments priced per tick              |

```bash
npm run poll:once   # ingest, then price the newly confirmed payments
```

- **USD₮ takes the same path as BTC.** It is priced at whatever Bitfinex quotes
  (0.99991 on the live run above), never a hardcoded `1`. One code path, not two.
- **The price is taken at the payment's timestamp**, not at accrual time, so
  polling latency cannot change the number. The snapshot keeps the provider's own
  timestamp so issuers can check it falls in the payment's window.
- **Append-only, enforced in the database.** The migration installs a trigger that
  rejects `UPDATE` and `DELETE` on `price_snapshots`. A snapshot that can be edited
  is a way to move all K issuers at once, which is exactly what the table exists to
  prevent. BE-02 role grants are the outer layer; the trigger is the floor. (Note:
  clearing the table in dev needs `TRUNCATE`, which bypasses row triggers.)
- **A provider outage is a handled state.** No price means no snapshot: the coupon
  waits and the payment is retried next tick. It never accrues at a guessed price.

> Bitfinex uses its own currency codes — Tether is `UST`, not `USDT` — so the
> asset mapping lives in one place (`src/pricing/price-source.ts`) and an unmapped
> asset is an explicit error rather than a wrong price. The WDK provider package
> also declares history points as `{ timestamp, price }` while the Bitfinex client
> actually returns `{ ts, price }`; we read both.

## Payment Ingestion (BE-07)

A background loop polls **merchant** addresses — never user addresses — through the
hosted WDK Indexer API and writes `payments`. Merchants are few and users are many,
so the polling cost is bounded by the merchant registry rather than by signups.

```bash
# add a merchant; the poller picks it up on the next tick, no restart
psql -c "INSERT INTO merchants (name,\"srcChainId\",address,token,priority,active)
         VALUES ('Demo','11155111','0xMerchant…','usdt',10,true);"

npm run poll:once          # one pass, then exit (PAYMENT_POLL_INTERVAL_MS=0 locally)
```

| Variable                     | Meaning                                              |
| ---------------------------- | ---------------------------------------------------- |
| `PAYMENT_POLL_INTERVAL_MS`   | Tick interval; `0` disables the loop                 |
| `PAYMENT_POLL_PAGE_SIZE`     | How far past the cursor each poll reaches            |
| `PAYMENT_POLL_MAX_MERCHANTS` | Merchants per tick, lowest `priority` first          |
| `CONFIRMATION_DEPTHS`        | Blocks of depth per `srcChainId` before money counts |
| `RPC_URLS`                   | Chain head source per `srcChainId`                   |

**Idempotency.** `UNIQUE (srcChainId, txHash, outputIndex)` on `payments` is what
makes an overlapping poll window harmless — a re-ingested transfer is an insert that
loses, not a second payment. `paymentRef` comes from `@/chains` (BE-03), so the
indexer's dedup key and the bytes the contract nullifies are literally the same.

**Confirmations.** The indexer reports no confirmation count and no block hash, so
depth is measured against our own chain head via `RPC_URLS`. A chain with no RPC
configured leaves its payments `pending` forever rather than confirming them on
faith — cashback paid on a reorged payment is money minted from nothing. Only EVM
head lookups are implemented; Tron, Bitcoin and Spark need their own head source.

**Reorgs.** A payment the indexer stops reporting, or reports on a different block,
is marked `orphaned` and logged as `security_event=payment.orphaned`.

**Two API constraints worth knowing** (probed against the live service, documented
nowhere): `limit` is the only query parameter that has any effect — `fromBlock`,
`offset` and `sort` are accepted and silently ignored — and results come back
ascending from the *oldest* record retained. So the cursor stores both a `seenCount`
(standing in for the offset the API will not accept) and a
`(blockNumber, transactionIndex, transferIndex)` watermark that stays correct even
when the indexer drops old records.

> **Open item before Bitcoin cashback ships.** The contracts spec derives
> `paymentRef` from the `vout`; the indexer exposes no vout, only a per-transaction
> `transferIndex`. It does separate two outputs to one merchant in one transaction
> (the recorded fixture proves it), so refs stay distinct — but an issuer deriving
> the ref from a real vout on its own node would compute different bytes. Confirm
> with the indexer and contract owners.

## Wallet Mapping (BE-05)

The only place a user proves control of an address. The claim path carries no
per-claim user signature (contracts spec §5.1), so this handshake is what binds a
payout recipient to a person — and what lets the Payment Poller answer "whose
payment was that?" from a `from` address.

| Method | Path                 | Purpose                                        |
| ------ | -------------------- | ---------------------------------------------- |
| `GET`  | `/wallets/challenge` | Single-use, 5-minute nonce to sign             |
| `POST` | `/wallets`           | Link an address, proven by a signed challenge  |
| `GET`  | `/wallets`           | The caller's mappings only                     |

```bash
# 1. get a challenge
curl -H "Authorization: Bearer $JWT" localhost:3000/wallets/challenge
# -> { "challengeId": "...", "nonce": "0x...", "expiresAt": "..." }

# 2. sign ownershipMessage(nonce) with the wallet, then
curl -X POST -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"address":"0x...","challengeId":"...","signature":"0x..."}' \
  localhost:3000/wallets
```

The exact string to sign comes from `ownershipMessage(nonce)` in
`src/wallets/address.ts` — the client must build it the same way.

Properties worth knowing:

- The challenge is spent **before** the signature is checked, so a failed proof
  burns the nonce instead of allowing unlimited attempts against one message.
- Address **validity** comes from `@tetherto/wdk-utils` (`validateEVMAddress`,
  `validateTronAddress`, `validateBitcoinAddress`, `validateSparkAddress`) — the same
  checks the WDK wallet SDK runs on the device, so the two cannot disagree.
- Address **canonical form** is ours, because WDK validates but does not encode
  (`normalizeAddress`): EIP-55 checksum for EVM, base58check for Tron (the `41…` hex
  form is converted), lower-case bech32/bech32m for Bitcoin/Spark. base58check
  addresses are case-sensitive and are never re-cased.
- `address` is globally unique in the database. A second user claiming it gets
  `409 ADDRESS_ALREADY_LINKED` **and** a `security_event=wallet.address_already_linked`
  log line.
- Bitcoin/Spark ownership proofs return `501 WALLET_PROOF_UNSUPPORTED` until the
  device-side message-signing format (BIP-137 vs BIP-322 vs WDK SDK) is pinned.
  Normalisation for those families already works.

### TODO: Authentication Implementation

- [ ] Implement OIDC authorization code exchange (`POST /auth/token`)
- [ ] Add JWKS caching with TTL
- [ ] Implement user creation on first login (`POST /auth/session`; `validate()` only looks up)
- [ ] Add refresh token support (if provider supports)
- [ ] Add logout endpoint (invalidate tokens in Redis)
- [ ] Add rate limiting on auth endpoints

## Indexer & On-Chain Integration

### WDK Indexer

The `indexer/` module is a thin HTTP client for the WDK blockchain indexer. It's currently stubbed and requires integration with the actual WDK API.

See: [https://github.com/tetherto/wdk](https://github.com/tetherto/wdk)

### Configuration

```bash
INDEXER_BASE_URL=http://localhost:8000
INDEXER_API_KEY=your-api-key
```

### Utility Token Contract

```bash
UTILITY_TOKEN_CONTRACT_ADDRESS=0x...
UTILITY_TOKEN_CONTRACT_ABI=[...]  # JSON-stringified ABI
```

### TODO: Indexer Integration

- [ ] Implement WDK indexer HTTP client (transactions, balances, subscriptions)
- [ ] Wire up transaction listener to coupon issuance flow
- [ ] Implement real-time wallet subscription (WebSocket or polling)
- [ ] Add RPC node client for writing utility token claims to chain
- [ ] Implement retry logic for failed on-chain transactions
- [ ] Add gas estimation & fee handling

## Docker Compose

### Services

| Service | Port | Purpose |
|---------|------|---------|
| postgres | 5432 | Primary database |
| redis | 6379 | Caching, queues |
| adminer | 8080 | Web DB client |
| indexer (commented) | 8000 | WDK indexer (uncomment when ready) |

### Up & Down

```bash
npm run docker:up       # Start all services
npm run docker:down     # Stop all services
docker compose -f infra/docker-compose.yml logs -f postgres  # Tail logs
```

## Roadmap / TODOs

### Core Auth & Users
- [ ] Implement `auth/` module: OIDC code exchange, token validation
- [ ] Implement `users/` module: user creation on first login, profile endpoints
- [ ] Add refresh token / logout flow

### Wallet Management
- [ ] Implement `wallets/` module: wallet creation, seed encryption
- [ ] Integrate with key management service (KMS/HSM) for encryption keys
- [ ] Add wallet recovery flow

### Transaction Indexing
- [ ] Implement `indexer/` module: WDK client, transaction listener
- [ ] Sync transactions from indexer into local DB
- [ ] Implement real-time wallet subscriptions

### Coupon System
- [ ] Implement coupon issuance listener (triggers on qualifying payments)
- [ ] Implement coupon code generation & uniqueness
- [ ] Implement coupon redemption flow (call utility token contract)
- [ ] Add coupon expiry & claim status reconciliation

### On-Chain Integration
- [ ] Implement utility token claim (write TX to blockchain)
- [ ] Add RPC client for transaction submission
- [ ] Implement gas estimation & fee handling
- [ ] Add transaction monitoring (pending → confirmed/failed)

### Infrastructure & DevOps
- [ ] Add Swagger/OpenAPI documentation
- [ ] Add structured request logging with correlation IDs
- [ ] Add comprehensive error handling & custom exception filters
- [ ] Add monitoring/observability (metrics, APM)
- [ ] Set up CI/CD to cloud provider (AWS/GCP/Azure)
- [ ] Add secrets management (AWS Secrets Manager / Vault)
- [ ] Implement database connection pooling optimization
- [ ] Add load testing & performance benchmarks

### Security Hardening
- [ ] Add rate limiting on sensitive endpoints (@nestjs/throttler)
- [ ] Implement CORS & helmet middleware
- [ ] Add request validation & sanitization (class-validator)
- [ ] Add secrets scanning in CI (gitleaks, trufflehog)
- [ ] Add database user with least-privilege permissions
- [ ] Implement TLS for database connections
- [ ] Add audit logging for sensitive operations

### Testing & Quality
- [ ] Increase coverage threshold from 20% to 50%+ as features land
- [ ] Add end-to-end tests with real chain interactions
- [ ] Add load / stress testing
- [ ] Add security testing (OWASP top 10)

## Contributing

### Branch Naming

```
feature/<feature-name>     # New features
bugfix/<bug-name>          # Bug fixes
refactor/<refactor-name>   # Refactorings
docs/<doc-name>            # Documentation
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add coupon issuance endpoint
fix: resolve seed encryption bug
docs: add auth setup guide
refactor: simplify wallet service
```

### Pull Request Checklist

- [ ] Branch is up-to-date with `main`
- [ ] Code follows linting rules (`npm run lint:fix`)
- [ ] Tests pass locally (`npm run test`)
- [ ] Coverage thresholds met
- [ ] No hardcoded secrets or credentials
- [ ] Commit messages follow Conventional Commits
- [ ] PR description explains the change and why

## Known Limitations & Assumptions

1. **Provider-Agnostic Auth**: While the scaffold is designed to be provider-agnostic, minor provider-specific glue may be needed for edge cases (Cognito claim shape differences, etc.)
2. **WDK Indexer Stub**: The indexer client is a stub and will need adjustment based on actual WDK API when consulted
3. **Seed Encryption**: Key management strategy (KMS vs. env var) is not yet decided; marked as TODO
4. **Blockchain Connectivity**: The scaffold does not provision RPC nodes or blockchain infrastructure; that's expected to be external
5. **Concurrent Transactions**: Utility token contract interactions may need gas price handling & mempool awareness

## Support & Questions

For issues or questions:
1. Check this README and architecture docs (`docs/architecture.md`)
2. Open a GitHub issue with reproduction steps
3. Reach out to the team

---

Generated as part of Tether's WDK Qualification Exercise. Built with NestJS, TypeORM, PostgreSQL, and Redis.
