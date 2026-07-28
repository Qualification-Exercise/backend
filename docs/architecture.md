# Architecture

## Overview

This is a NestJS-based backend for the Tether WDK Qualification Exercise. The application follows a modular, layered architecture:

```
Controllers (HTTP Layer)
    ↓
Services (Business Logic)
    ↓
Entities + Repositories (Data Layer)
    ↓
PostgreSQL (Persistence)
```

## Module Structure

Each feature module follows this folder hierarchy:

```
module/
├── entities/              # TypeORM entities
├── services/              # Business logic, repository injection
├── controllers/           # HTTP endpoints
├── dtos/                  # Request/response data transfer objects
├── interfaces/            # TypeScript interfaces (IXxxResponse, etc.)
├── repositories/          # Custom query repositories (if needed)
└── module.ts              # NestJS module definition
```

**Naming Conventions**:
- Interfaces: `I` prefix (e.g., `IUserResponse`, `ICreateUserDTO`)
- Services: `*Service` suffix
- Controllers: `*Controller` suffix
- DTOs: `Create*DTO`, `Update*DTO`, `*ResponseDTO`
- Entities: `*.entity.ts`
- Modules: `*.module.ts`

## Core Modules

### 1. Auth Module (`src/auth/`)

**Responsibility**: OIDC/JWT authentication

**Key Classes**:
- `JwtStrategy`: Passport strategy for JWT validation
- `JwtAuthGuard`: Guard for protecting routes
- `AuthService`: Token validation logic

**Flow**:
```
1. Client receives JWT from auth provider
2. Client sends JWT in Authorization header
3. JwtAuthGuard validates JWT via JwtStrategy
4. Strategy fetches JWKS from issuer (cached)
5. Validates signature, issuer, audience, expiration
6. Request proceeds with req.user populated
```

**TODO**: Implement OIDC authorization code exchange

### 2. Users Module (`src/users/`)

**Responsibility**: User identity and profile management

**Core Entity**:
```typescript
User {
  id: UUID
  externalAuthId: string  // From auth provider (sub claim)
  email: string
  createdAt: Date
  updatedAt: Date
}
```

**Relationships**:
- `User` 1→N `Wallet`
- `User` 1→N `Coupon`

**TODO**: Implement CRUD + user lookup/creation on first login

### 3. Wallets Module (`src/wallets/`)

**Responsibility**: Wallet address ↔ user mapping, seed phrase backups

**Core Entity**:
```typescript
Wallet {
  id: UUID
  userId: UUID (FK)
  address: string
  chain: enum[BTC, SPARK, ARBITRUM, ETHEREUM, POLYGON, TRON]
  encryptedSeedBackupRef: string  // Ref to encryption key store
  createdAt: Date
}
```

**Relationships**:
- `Wallet` N→1 `User`
- `Wallet` 1→N `Transaction`

**TODO**:
- Implement wallet creation
- Integrate with KMS for seed encryption

### 4. Transactions Module (`src/transactions/`)

**Responsibility**: Record on-chain transactions synced from indexer

**Core Entity**:
```typescript
Transaction {
  id: UUID
  walletId: UUID (FK)
  txHash: string
  chain: enum[BTC, SPARK, ARBITRUM, ...]
  asset: enum[BTC, USDT]
  amount: Decimal
  direction: enum[send, receive]
  status: enum[pending, confirmed, failed]
  createdAt: Date
}
```

**Relationships**:
- `Transaction` N→1 `Wallet`
- `Transaction` 1→N `Coupon` (source)

**TODO**: Implement indexer sync logic

### 5. Coupons Module (`src/coupons/`)

**Responsibility**: Coupon issuance and redemption

**Core Entities**:
```typescript
Coupon {
  id: UUID
  code: string (UNIQUE)
  value: Decimal
  asset: enum[BTC, USDT]
  status: enum[issued, claimed, expired]
  userId: UUID (FK)
  sourceTransactionId: UUID (FK, nullable)
  expiresAt: Date (nullable)
  createdAt: Date
}

UtilityTokenClaim {
  id: UUID
  couponId: UUID (FK, UNIQUE)
  walletAddress: string
  amount: Decimal
  txHash: string (nullable)
  claimedAt: Date
}
```

**Relationships**:
- `Coupon` N→1 `User`
- `Coupon` N→1 `Transaction` (source)
- `Coupon` 1→1 `UtilityTokenClaim`

**State Machine**:
```
Coupon:       issued → claimed → (on-chain confirmed) → (final state TBD)
TokenClaim:   (created on claim) → pending → confirmed
```

**TODO**:
- Implement coupon code generation
- Implement issuance listener (triggers on qualifying transactions)
- Implement claim flow (call utility token contract)

### 6. Indexer Module (`src/indexer/`)

**Responsibility**: HTTP client for WDK blockchain indexer

**Client Methods** (TODO):
- `getTransactionsByWallet(address, chain)`: Fetch wallet's transactions
- `getBalance(address, chain)`: Get wallet balance
- `subscribeToTransactions(address, callback)`: Real-time updates

**Configuration**:
```bash
INDEXER_BASE_URL=http://localhost:8000
INDEXER_API_KEY=test-api-key
```

**TODO**: Implement actual WDK client based on https://github.com/tetherto/wdk

### 7. Config Module (`src/config/`)

**Responsibility**: Environment validation and typed config

**Key File**: `config/env.ts`
- Zod schema for all environment variables
- `validateEnv()` function called at startup
- Fails fast if required vars are missing or invalid

**Usage**:
```typescript
constructor(private configService: ConfigService<Env>) {
  const dbHost = configService.get('DB_HOST');
}
```

### 8. Database Module (`src/database/`)

**Responsibility**: TypeORM setup, migrations, seeding

**Key Files**:
- `data-source.ts`: TypeORM CLI configuration
- `database.module.ts`: NestJS module
- `migrations/*.ts`: SQL migration files
- `seed.ts`: Reference data seeder

**Principles**:
- Never use `synchronize: true` in production
- Always use migrations
- Transactions use `migrationsTransactionMode: 'all'`

### 9. Health Module (`src/health/`)

**Responsibility**: `/health` endpoint for readiness checks

**Response**:
```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Data Flow Examples

### 1. User Authentication

```
Client                    Backend                 Auth Provider
  │
  ├─ POST /auth/token ────>
  │  (code, redirectUri)
  │
  │  <──── 401 Unauthorized ──
  │  (if auth fails)
  │
  │  <──── 200 OK ───────────
  │  { accessToken, ... }
  │
  │─ GET /users/me ────────>
  │  (Bearer accessToken)
  │
  │  <──── 200 OK ───────────
  │  { id, email, ... }
```

### 2. Transaction Sync (via Indexer)

```
Indexer                  Backend                  Blockchain
  │
  ├─ broadcast txHash ────>
  │
  │  Service polls: GET /indexer/transactions
  │
  │  <──── [transactions] ──
  │
  │  Create/update Transaction records
  │
  │  Check if qualifies for coupon (5% cashback)
  │
  │  Issue Coupon
```

### 3. Coupon Claim

```
Client                    Backend                  Utility Token Contract
  │
  ├─ POST /coupons/:id/claim ──>
  │  { walletAddress, amount }
  │
  │  Service:
  │  1. Verify coupon exists & user owns it
  │  2. Verify coupon hasn't expired
  │  3. Call contract.claim(address, amount)
  │
  │                          ├─ RPC Node ───────>
  │                          │                    Submit TX
  │                          │
  │                          │  <── txHash ────
  │
  │  Create UtilityTokenClaim record
  │
  │  <──── 201 Created ──────
  │  { id, txHash, status: pending, ... }
  │
  │  (Background task monitors TX status)
```

## Error Handling

**Global Exception Filter**:
```typescript
@Catch(Exception)
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception, host) {
    // Format error response
    // Log structured error
    // Return 400/401/403/500 as appropriate
  }
}
```

**Principles**:
- All business logic throws domain-specific exceptions
- Controller/HTTP layer catches and formats responses
- Structured logging with context (requestId, userId, etc.)

## Security Considerations

1. **JWT Validation**: All requests to protected endpoints go through JwtAuthGuard
2. **CORS**: Configure based on client origins
3. **Rate Limiting**: TODO (add on sensitive endpoints like /coupons/claim)
4. **Input Validation**: Use class-validator on DTOs
5. **SQL Injection**: TypeORM parameterized queries prevent this
6. **Secrets Management**: Never hardcode credentials; use env vars and KMS

## Performance & Scalability

### Database
- Connection pooling via TypeORM
- Migrations run at startup
- Indexes on: `externalAuthId`, `email`, `walletAddress`, `couponCode`

### Caching
- Redis for: coupon cache, user sessions, indexer JWKS
- TTL strategy TBD per endpoint

### Async Tasks
- TODO: Implement BullMQ for coupon issuance & indexer polling
- TODO: Implement webhook retry logic

## Testing Strategy

### Unit Tests (`*.spec.ts`)
- Mock repositories
- Mock external services (indexer, auth provider)
- Test service methods in isolation

### Integration Tests (`test/*.integration.spec.ts`)
- Real Postgres/Redis (via Docker)
- Real HTTP handlers
- End-to-end flows

### CI/CD
- Run tests on every PR to `main`
- Lint + build + test must pass
- Coverage threshold: 20% (scaffold phase), increase as features land

## Deployment Considerations

1. **Environment Parity**: Ensure `.env` is synchronized with production secrets
2. **Database Migrations**: Run `npm run migration:run` as part of deployment
3. **Health Checks**: `/health` endpoint should be configured in load balancer
4. **Graceful Shutdown**: Implement shutdown hooks for open connections
5. **Monitoring**: Add APM, structured logging, error tracking

## Future Architecture Improvements

1. **Multi-tenant**: If serving multiple orgs, add `tenantId` column strategy
2. **CQRS**: Separate read/write models for high-scale scenarios
3. **Event Sourcing**: For immutable audit trail of coupons & claims
4. **Service Mesh**: Consider Istio for multi-service deployments
5. **GraphQL**: Add GraphQL layer in addition to REST if needed
