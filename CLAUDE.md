# CLAUDE.md — Working with Claude Code on WDK Backend

This document guides Claude Code on how to work effectively with this project.

## Project Overview

**WDK Backend Scaffold** — Production-quality NestJS backend for Tether's WDK Qualification Exercise.

- **Purpose**: Cashback/coupon system with multi-chain asset support (BTC, Spark, Arbitrum, Ethereum, Polygon, Tron), OIDC authentication, and blockchain indexer integration
- **Tech Stack**: NestJS + TypeScript (strict) + TypeORM + PostgreSQL + Redis
- **Status**: Scaffold phase (core entities, module structure, testing setup in place; business logic stubbed with TODOs)
- **Codebase Size**: ~50 files, ~3000 LOC (rapid to evolve as features land)

## Conventions & Naming

**Entities**: `*.entity.ts` files (e.g., `user.entity.ts` → class `User`)

**Interfaces**: Prefix `I` (e.g., `IUserResponse`, `ICreateUserDTO`, `IAuthPayload`)

**Services**: `*.service.ts` suffix (e.g., `UsersService`, `CouponsService`)

**Controllers**: `*.controller.ts` suffix (e.g., `UsersController`)

**DTOs**: `Create*DTO`, `Update*DTO`, `*ResponseDTO` (e.g., `CreateUserDTO`, `IssueCouponDTO`)

**Module Structure** (per feature):
```
src/users/
├── entities/user.entity.ts
├── services/users.service.ts
├── controllers/users.controller.ts
├── interfaces/             # (to create as needed)
├── dtos/                   # (to create as needed)
├── repositories/           # (to create as needed; optional if TypeORM repo pattern)
└── users.module.ts
```

**Imports**: Use `@/` path alias for absolute imports (`import { User } from '@/users/entities/user.entity'`)

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/main.ts` | Application entry, Pino logger setup |
| `src/app.module.ts` | Root module, imports all feature modules + Config |
| `src/config/env.ts` | Zod schema, environment validation (fail-fast on startup) |
| `src/database/data-source.ts` | TypeORM DataSource for CLI (`typeorm migration:generate`, etc.) |
| `src/database/database.module.ts` | NestJS TypeORM module configuration |
| `src/database/seed.ts` | Seed script (stub; customize for reference data) |
| `.env.example` | Environment variable template (keep in sync with `.env` changes) |
| `infra/docker-compose.yml` | Local dev infrastructure (Postgres, Redis, Adminer) |
| `.github/workflows/ci.yml` | GitHub Actions: lint, build, test on PR |
| `jest.config.js` | Jest testing: 20% threshold for scaffold phase |
| `README.md` | Comprehensive user guide (keep updated) |
| `docs/architecture.md` | Detailed architecture, data flows, deployment notes |

## Working with Modules

Each module is **self-contained**: entity, service (business logic), controller (HTTP layer), and configuration live in one folder.

**When adding a feature**:
1. Create entity in `entities/`
2. Create service in `services/` (inject repository via `@InjectRepository()`)
3. Create controller in `controllers/` (inject service)
4. Create DTOs/interfaces in `dtos/`, `interfaces/` (as needed)
5. Wire up in `module.ts` (import TypeOrmModule, register providers, exports)
6. Add the module to `app.module.ts` imports

**Do NOT**:
- Put business logic in controllers
- Hardcode configuration values (use env vars via `ConfigService`)
- Use `console.log` (use structured logging via `Logger` from `@nestjs/common` or Pino)
- Use `synchronize: true` in TypeORM (migrations only)

## Testing

**Unit Tests** (`*.spec.ts` in `src/`):
- Mock all dependencies (repositories, external services)
- Test service methods in isolation
- Example: `src/users/services/users.service.spec.ts`

**Integration Tests** (`test/*.integration.spec.ts`):
- Use real Postgres/Redis (via Docker)
- Test end-to-end flows
- Requires `npm run docker:up` before running
- Example: `test/users.integration.spec.ts`

**Run Tests**:
```bash
npm run test          # All unit tests
npm run test:cov      # With coverage report
npm test -- test/     # Integration tests only
```

**Coverage Target**: 20% for scaffold phase; increase as features land. Exclusions: `*.entity.ts`, `*.module.ts`, `main.ts`

## Database & Migrations

**Generate Migration** (after entity changes):
```bash
npm run migration:generate -- src/database/migrations/AddCouponTable
```

**Run Migrations**:
```bash
npm run migration:run
```

**Revert Last Migration**:
```bash
npm run migration:revert
```

**Seed Data** (stub; customize in `src/database/seed.ts`):
```bash
npm run seed
```

**DO NOT use `synchronize: true`**. Always use migrations.

## Environment Configuration

All configuration flows through `src/config/env.ts` (Zod schema). Missing or invalid vars cause startup failure (fail-fast).

**To add a new env var**:
1. Add field to Zod schema in `env.ts`
2. Add to `.env.example`
3. Add to `.env` (locally)
4. Document in README.md (Environment Variables section)

**Example**:
```typescript
// env.ts
const envSchema = z.object({
  MY_NEW_VAR: z.string().default('default-value'),
  // ...
});

// .env / .env.example
MY_NEW_VAR=my-value
```

## Docker & Local Dev

**Start Infrastructure**:
```bash
npm run docker:up
# Postgres (5432), Redis (6379), Adminer (8080)
```

**Stop**:
```bash
npm run docker:down
```

**Check Service Health**:
```bash
curl http://localhost:3000/health
# Response: { "status": "ok", "database": "connected", "timestamp": "..." }
```

## Common Tasks

| Task | Command |
|------|---------|
| Start dev server | `npm run dev` |
| Build for prod | `npm run build` |
| Lint code | `npm run lint:fix` |
| Format code | `npm run format` |
| Run all tests | `npm run test:cov` |
| Generate migration | `npm run migration:generate -- src/database/migrations/Name` |
| Run migrations | `npm run migration:run` |
| Seed database | `npm run seed` |
| Start infrastructure | `npm run docker:up` |
| Stop infrastructure | `npm run docker:down` |

## Git Workflow

**Branch Naming**:
```
feature/coupon-issuance    # New feature
bugfix/wallet-encryption   # Bug fix
refactor/service-cleanup   # Refactoring
docs/auth-guide            # Documentation
```

**Commit Messages** (Conventional Commits):
```
feat: implement coupon issuance endpoint
fix: resolve seed encryption bug
docs: add auth setup guide
refactor: simplify wallet service
```

**Before Committing**:
- Lint passes: `npm run lint:fix`
- Tests pass: `npm run test`
- No hardcoded secrets/credentials
- `.env` changes reflected in `.env.example`

## Testing Strategy

### Unit Tests (isolate, mock, fast)
- Test service methods
- Mock repositories, external services
- Location: `src/**/services/*.spec.ts`
- Run: `npm run test`

### Integration Tests (real DB, real flows)
- Test with live Postgres/Redis
- Full request/response cycle
- Location: `test/**/*.integration.spec.ts`
- Run: `npm test -- test/`

**Coverage Threshold**: 20% for scaffold (increase as features land)

## Roadmap & TODOs

Check `README.md` section **"Roadmap / TODOs"** for:
- Core Auth & Users (OIDC code exchange)
- Wallet Management (seed encryption, KMS integration)
- Transaction Indexing (WDK indexer integration, real-time subscriptions)
- Coupon System (issuance listener, claim flow, expiry)
- On-Chain Integration (utility token claims)
- Infrastructure & DevOps (Swagger, observability, CI/CD)
- Security Hardening (rate limiting, CORS, secrets scanning)

## How Claude Should Approach Tasks

### When Adding a Feature
1. **Understand scope**: Read relevant TODOs and README sections
2. **Check entities**: Ensure all required fields exist in entities (refer to `docs/architecture.md` for data flows)
3. **Implement service first**: Inject repositories, write business logic
4. **Write controller**: Inject service, define endpoints
5. **Add tests**: Unit test the service, integration test the endpoint
6. **Update README**: Document new env vars, endpoints, assumptions
7. **Generate migration**: After entity changes, run `npm run migration:generate`

### When Fixing a Bug
1. **Reproduce**: Write a test that fails (unit or integration)
2. **Root cause**: Trace the call stack (service → controller; repository → service)
3. **Fix once, where all callers route through** (typically the service)
4. **Verify**: Test passes; no regressions in related features
5. **Commit**: Reference the bug/issue number if applicable

### When Refactoring
1. **Tests first**: Ensure existing tests pass
2. **Make the change**: Preserve behavior, improve clarity
3. **Tests pass**: No coverage drops
4. **Update docs**: If architectural changes

## Security Considerations

**Never**:
- Hardcode secrets (use env vars + KMS for production)
- Log sensitive data (passwords, tokens, seed phrases)
- Use `synchronize: true` in TypeORM
- Skip validation at trust boundaries (HTTP requests, external APIs)
- Commit `.env` file (only `.env.example`)

**Always**:
- Validate env vars at startup (Zod schema)
- Use structured logging with context (userId, requestId)
- Use `@nestjs/passport` for auth (no custom JWT validation)
- Prefer ORM parameterized queries over string concatenation

## Performance & Scalability

**Database**:
- Connection pooling via TypeORM (adjust `max` if load testing reveals bottlenecks)
- Indexes on: `externalAuthId`, `email`, `walletAddress`, `couponCode` (add more if queries slow)
- Migration strategy: run at deployment startup

**Caching** (Redis):
- TODO: Implement coupon cache, user session cache, JWKS cache
- Use `redis.get()` / `redis.set()` with TTL

**Async Tasks** (TODO):
- Coupon issuance listener (queue via BullMQ or similar)
- Indexer polling for new transactions
- Webhook retries for failed on-chain claims

## Deployment

**Pre-Deployment Checklist**:
- [ ] All tests pass (`npm run test:cov`)
- [ ] No secrets in code or `.env`
- [ ] Migrations generate cleanly (`npm run migration:generate`)
- [ ] Build succeeds (`npm run build`)
- [ ] Health endpoint responds (`curl /health`)
- [ ] `.env.example` matches all required vars

**At Deployment**:
```bash
npm run build
npm run migration:run  # Before starting the app
npm run start
```

**Monitoring**:
- Health endpoint: `GET /health`
- Structured logs: All requests, errors, warnings logged to stdout (via Pino)
- Database connectivity: Checked every health request

## Questions & Debugging

**Q: TypeScript strict errors?**
A: Strict mode is ON by default. Use `!` for TypeORM entity properties (marked as definitely assigned). Use `?` for optional properties.

**Q: How do I add a new env var?**
A: (1) Update `src/config/env.ts` (Zod schema), (2) Add to `.env.example` and `.env`, (3) Document in README.

**Q: Tests fail locally but pass in CI?**
A: Likely environment-dependent (missing docker, .env differences). Run `npm run docker:up` first.

**Q: Where do I put DTO definitions?**
A: Create `src/<module>/dtos/` folder, export classes (use `class-validator` for decorators).

**Q: How do I test with real database?**
A: Integration tests use `testcontainers` or live Postgres (see `test/users.integration.spec.ts`).

---

**Last Updated**: 2026-07-28  
**Version**: Scaffold Phase v0.1.0
