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

### TODO: Authentication Implementation

- [ ] Implement OIDC authorization code exchange (`POST /auth/token`)
- [ ] Add JWKS caching with TTL
- [ ] Implement user lookup/creation on first login (auth strategy `validate()`)
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
