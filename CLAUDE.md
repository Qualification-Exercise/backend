# CLAUDE.md — Working with Claude Code on WDK Backend

This document guides Claude Code on how to work effectively with this project.

## Project Overview

**WDK Backend Scaffold** — Production-quality NestJS backend for Tether's WDK Qualification Exercise.

- **Purpose**: Cashback/coupon system with multi-chain asset support (BTC, Spark, Arbitrum, Ethereum, Polygon, Tron), OIDC authentication, and blockchain indexer integration
- **Tech Stack**: NestJS + TypeScript (strict) + TypeORM + PostgreSQL + Redis
- **Status**: Scaffold phase (core entities, module structure, testing setup in place; business logic stubbed with TODOs)
- **Codebase Size**: ~50 files, ~3000 LOC (rapid to evolve as features land)

## Conventions & Naming

### File Naming (kebab-case)
- `module-name.module.ts`
- `feature-name.service.ts`
- `feature-name.controller.ts`
- `feature-name.repo.ts`
- `feature-name.entity.ts`
- `action-entity.dto.ts` (e.g., `create-user.dto.ts`, `update-coupon.dto.ts`)
- `feature-name.interface.ts`
- `feature-status.enum.ts`
- `feature-name.exception.ts`
- `feature-name.spec.ts` (test files)

### Class & Type Naming (PascalCase with Prefixes)
- **Classes**: `PascalCase` (e.g., `UserService`, `CouponRepo`, `UsersController`)
- **Interfaces**: `IPascalCase` (e.g., `ICreateUserParams`, `ICouponResponse`) — **MUST start with I**
- **Enums**: `EPascalCase` (e.g., `ECouponStatus`, `EErrorCodes`) — **MUST start with E**
- **Types**: `PascalCase` (e.g., `UserResponse`, `CouponData`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRY_ATTEMPTS`, `DEFAULT_TIMEOUT`)
- **Variables/Functions**: `camelCase` (e.g., `getUserById`, `findActiveUsers`)

### Entity & Database Naming
- **Entity properties**: `camelCase` (TypeScript standard) — `userId`, `createdAt`, `discountAmount`
- **Database columns**: `snake_case` (explicitly mapped via `@Column({ name: 'snake_case' })`)
- **Table names**: `snake_case` (plural) in `@Entity({ name: 'table_name' })` — `users`, `coupons`, `subscriptions`
- **Index names**: `IDX_table_column` — `IDX_users_email`, `IDX_coupons_user_id`
- **Enum types**: `snake_case` (plural) — `coupon_statuses`, `transaction_types`
- **Join columns**: Must match actual database column name — `@JoinColumn({ name: 'user_id' })`

### Module Structure (per feature)
```
feature-name/
├── feature-name.module.ts               # NestJS module
├── controllers/
│   └── feature-name.controller.ts
├── services/
│   ├── feature-name.service.ts
│   ├── mappers/
│   │   └── feature-name-service.mapper.ts
│   └── factories/                       # (if using factory pattern)
│       └── factory-name/
├── repos/
│   └── feature-name.repo.ts
├── entities/
│   └── feature-name.entity.ts
├── dtos/
│   ├── create-feature-name.dto.ts
│   └── update-feature-name.dto.ts
├── enums/
│   └── feature-status.enum.ts
├── interfaces/
│   └── feature-name.interface.ts
├── exceptions/
│   └── feature-name.exception.ts
├── guards/
│   └── guard-name.guard.ts
├── mappers/
│   └── feature-name-service.mapper.ts
└── constants/
    └── constant-name.constants.ts
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
1. Create entity in `entities/` with indexes and timestamps
2. Create repository in `repos/` (extend `TypeOrmBaseRepo`)
3. Create service in `services/` (inject repository, compose business logic)
4. Create mapper in `services/mappers/` (handle data transformation)
5. Create controller in `controllers/` (inject service only, handle HTTP layer)
6. Create DTOs in `dtos/` with class-validator decorators
7. Wire up in `module.ts` (import TypeOrmModule, register providers, exports)
8. Add the module to `app.module.ts` imports

**Module providers order**:
```typescript
providers: [
  SubscriptionRepo,          // Repos first
  SubscriptionService,       // Services
  SubscriptionServiceMapper, // Mappers
  // Factory providers...
]
```

**Do NOT**:
- Put business logic in controllers
- Hardcode configuration values (use env vars via `ConfigService`)
- Use `console.log` (use structured logging via `Logger`)
- Use `synchronize: true` in TypeORM (migrations only)
- Put validation in services (use DTOs with class-validator)

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

**Branch Naming** (with optional Jira key):
```
feat/coupon-issuance           # New feature (generic)
feat/PHIL-123-coupon-issuance  # New feature (with ticket key)
bugfix/wallet-encryption       # Bug fix
refactor/service-cleanup       # Refactoring
docs/auth-guide                # Documentation
```

If a ticket key exists (e.g., PHIL-123, QUAL-456), include it in branch name: `feat/PHIL-123-description`

**Commit Messages** (Conventional Commits):
```
feat: implement coupon issuance endpoint
feat(PHIL-123): implement coupon issuance endpoint
fix: resolve seed encryption bug
docs: add auth setup guide
refactor: simplify wallet service
```

Include ticket key in commit scope when applicable: `feat(PHIL-123):`

**DO NOT** add Claude as co-author in commits. Only user commits count.

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

## Service Layer

Services contain all business logic. Structure methods by grouping public method → its private helpers → next public → helpers.

**Service pattern**:
```typescript
@Injectable()
export class CouponService {
  constructor(
    private readonly couponRepo: CouponRepo,
    private readonly couponMapper: CouponServiceMapper,
  ) {}

  async issueCoupon(params: IssueCouponDto): Promise<CouponEntity> {
    this.validateParams(params);
    const mapped = this.couponMapper.mapIssueCoupon(params);
    return this.couponRepo.create(mapped);
  }

  private validateParams(data: IssueCouponDto): void {
    // Validation logic
  }

  async expireCoupon(couponId: string): Promise<CouponEntity> {
    const coupon = await this.findById(couponId);
    return this.couponRepo.update({ id: couponId }, { status: ECouponStatus.EXPIRED });
  }

  private async findById(id: string): Promise<CouponEntity> {
    const coupon = await this.couponRepo.findById(id);
    if (!coupon) throw new CouponNotFoundException();
    return coupon;
  }
}
```

**Service rules**:
- Inject only repositories, mappers, external services
- Group by method: public → private helpers → next public
- Throw domain-specific exceptions (never generic Error)
- Log important operations and errors
- Return entities, not DTOs (let mappers handle conversion)
- Validate all inputs at trust boundaries

## Repository Pattern

Repositories handle all database access. Extend `TypeOrmBaseRepo`.

**Repository pattern**:
```typescript
@Injectable()
export class CouponRepo extends TypeOrmBaseRepo<CouponEntity> {
  protected entity: EntityTarget<CouponEntity> = CouponEntity;

  async findByCode(code: string): Promise<CouponEntity | null> {
    return this.readManager.findOne(CouponEntity, {
      where: { code },
      relations: ['user'],
    });
  }

  async findActiveByUserId(userId: string): Promise<CouponEntity[]> {
    return this.readQB('c')
      .where('c.userId = :userId', { userId })
      .andWhere('c.status = :status', { status: ECouponStatus.ACTIVE })
      .orderBy('c.createdAt', 'DESC')
      .getMany();
  }
}
```

**Repository rules**:
- `readManager`: for find operations (return null if not found, never throw)
- `writeManager`: for create/update/delete operations
- `readQB(alias)`: for complex queries with joins, filters, subqueries
- `writeQB(alias)`: for complex write queries
- Always explicitly load relations with `leftJoinAndSelect`
- Use `readManager` for read-only replicas (performance)

**Base repo methods**:
- `create(data: Partial<Entity>): Promise<Entity>`
- `findById(id: string): Promise<Entity | null>`
- `update(where: any, data: Partial<Entity>): Promise<Entity>`
- `delete(where: any): Promise<DeleteResult>`
- `readQB(alias: string): SelectQueryBuilder<Entity>`
- `writeQB(alias: string): SelectQueryBuilder<Entity>`

## DTOs & Validation

DTOs handle HTTP request/response validation. Use class-validator decorators.

**DTO pattern**:
```typescript
export class CreateCouponDto {
  @ApiProperty({ description: 'User ID', example: 'uuid' })
  @IsUUID()
  user_id: string;

  @ApiProperty({ description: 'Coupon code', example: 'SAVE50' })
  @IsString()
  @MinLength(3)
  code: string;

  @ApiPropertyOptional({ description: 'Discount amount', example: 50 })
  @IsNumber()
  @IsOptional()
  discount_amount?: number;
}
```

**DTO naming**: `{Action}{Entity}Dto` (e.g., `CreateCouponDto`, `UpdateCouponStatusDto`, `IssueCouponDto`)

**DTO rules**:
- Use `snake_case` for property names (matches API contracts)
- Add `@ApiProperty` / `@ApiPropertyOptional` for Swagger docs
- Use class-validator decorators (`@IsString`, `@IsEmail`, etc.)
- Separate DTOs for each action (Create vs Update vs Check)
- Property access should be explicit in controller (map DTO → entity)

## Entities & Database

Entities represent database tables. Entity properties use **camelCase** (TypeScript convention), but database columns map to **snake_case** via the `name` property in `@Column()`.

**Entity pattern**:
```typescript
@Entity({ name: 'coupons' })
@Index('IDX_coupons_user_id', ['userId'])
@Index('IDX_coupons_code', ['code'])
export class CouponEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // camelCase property → snake_case column
  @Column({ name: 'user_id', type: 'uuid', nullable: false })
  userId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ECouponStatus,
    enumName: 'coupon_statuses',
    default: ECouponStatus.ACTIVE,
  })
  status: ECouponStatus;

  @Column({ name: 'discount_amount', type: 'decimal', precision: 10, scale: 2 })
  discountAmount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  // Relations section
  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  toResponseDto(): CouponResponseDto {
    return { id: this.id, status: this.status };
  }
}
```

**Entity rules**:
- **Properties**: camelCase (TypeScript standard)
- **Database columns**: Always explicitly map to snake_case via `name` property in `@Column()`
- **Table name**: snake_case (plural) in `@Entity({ name: 'coupons' })`
- Use `@Index()` for frequently queried columns
- Use enums for status fields (not strings)
- Add `@CreateDateColumn` and `@UpdateDateColumn` for audit trails
- Include conversion method `toResponseDto()`
- Mark relations section clearly with comment
- Use `@JoinColumn()` to specify foreign key column name (must match database column)

## Data Mappers

Mappers transform data between entities, DTOs, and external APIs. One mapper per service.

**Mapper pattern**:
```typescript
@Injectable()
export class CouponServiceMapper {
  mapCreateDto(dto: CreateCouponDto): Partial<CouponEntity> {
    return {
      userId: dto.user_id,
      code: dto.code,
      discountAmount: dto.discount_amount ?? 0,
      status: ECouponStatus.ACTIVE,
    };
  }

  toResponse(entity: CouponEntity): CouponResponseDto {
    return {
      id: entity.id,
      code: entity.code,
      status: entity.status,
      created_at: entity.createdAt.toISOString(),
    };
  }
}
```

**Mapper rules**:
- Named `{ServiceName}ServiceMapper` or `{ServiceName}Mapper`
- Pure functions, no side effects
- Each method handles one transformation
- No business logic (transformation only)
- Injected by service, not vice versa

## Enums & Interfaces

### Enums (E prefix, required)
```typescript
export enum ECouponStatus {
  ACTIVE = 'ACTIVE',
  USED = 'USED',
  EXPIRED = 'EXPIRED',
  CANCELED = 'CANCELED',
}

export enum EErrorCodes {
  COUPON_NOT_FOUND = 'COUPON_NOT_FOUND',
  COUPON_EXPIRED = 'COUPON_EXPIRED',
  INVALID_COUPON_CODE = 'INVALID_COUPON_CODE',
}
```
**RULE: All enums must start with E prefix**

### Interfaces (I prefix, required)
```typescript
export interface ICreateCouponParams {
  userId: string;
  code: string;
  discountAmount: number;
}
```
**RULE: All interfaces must start with I prefix (use only for data structures, not services)**

## Exception Handling

Centralize all error codes. Create domain-specific exceptions per module.

**Exception pattern**:
```typescript
export class CouponException extends HttpException {
  constructor(
    public readonly errorCode: EErrorCodes,
    status: HttpStatus,
  ) {
    super(errorCode, status);
  }
}

export class CouponNotFoundException extends CouponException {
  constructor() {
    super(EErrorCodes.COUPON_NOT_FOUND, HttpStatus.NOT_FOUND);
  }
}

export class CouponExpiredException extends CouponException {
  constructor() {
    super(EErrorCodes.COUPON_EXPIRED, HttpStatus.BAD_REQUEST);
  }
}
```

**Exception rules**:
- All error codes in `src/shared/error/error-codes.enum.ts`
- Create module-specific base exception
- Create specific exceptions for each error type
- Never throw generic `Error` or `NotFoundException`
- Throw with: `throw new CouponNotFoundException()`

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
2. **Check entities**: Ensure all required fields exist (refer to `docs/architecture.md`)
3. **Create entity** in `entities/` with proper indexes, timestamps, and snake_case columns
4. **Create repository** in `repos/` extending `TypeOrmBaseRepo`
5. **Create service** in `services/` with business logic, inject repo
6. **Create mapper** in `services/mappers/` for DTO/entity transformations
7. **Create controller** in `controllers/` (inject service only)
8. **Create DTOs** in `dtos/` with class-validator decorators
9. **Create exceptions** if needed in `exceptions/`
10. **Wire up module**: Import TypeOrmModule, register providers, add to app.module.ts
11. **Add tests**: Unit test service, integration test endpoint
12. **Generate migration**: After entity changes, run `npm run migration:generate`
13. **Update README**: Document new env vars, endpoints, assumptions

### When Fixing a Bug
1. **Reproduce**: Write a test that fails (unit or integration)
2. **Root cause**: Trace call stack (controller → service → repo → DB)
3. **Fix once, where all callers route through** (typically the service layer)
4. **Verify**: Test passes; no regressions in related features
5. **Commit**: Reference the bug/issue number if applicable

### When Refactoring
1. **Tests first**: Ensure existing tests pass
2. **Make the change**: Preserve behavior, improve clarity
3. **Tests pass**: No coverage drops
4. **Update docs**: If architectural changes

### Code Organization Checklist
- [ ] All classes/types use correct prefixes (E for enum, I for interface)
- [ ] Files use kebab-case names, classes use PascalCase
- [ ] Database columns/tables use snake_case
- [ ] Services have dedicated mappers
- [ ] DTOs use class-validator decorators and @ApiProperty
- [ ] Exceptions are domain-specific, never generic Error
- [ ] Imports ordered: external → aliases → relative
- [ ] No business logic in controllers
- [ ] No hardcoded values (use ConfigService)

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

## Code Style & Best Practices

### Import Organization
Always order imports in this sequence:
```typescript
// 1. External dependencies
import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

// 2. Aliases (@/ paths)
import { CouponEntity } from '@/coupons/entities/coupon.entity';
import { EErrorCodes } from '@/shared/error/error-codes.enum';

// 3. Relative imports
import { CouponRepo } from './repos/coupon.repo';
import { CouponServiceMapper } from './mappers/coupon-service.mapper';
```

### Comments & Documentation
**Principle**: Code should be self-documenting.

**Good comment** (explains WHY, not WHAT):
```typescript
// Complex calculation: applies tier discounts + prorates mid-cycle changes
async calculateSubscriptionPrice(subscription: Subscription): Promise<number> {
  // Implementation details
}
```

**Bad comment** (just describes the code):
```typescript
// Gets the coupon by ID
async getCouponById(id: string): Promise<CouponEntity> {
  // Already obvious from function name
}
```

**When to comment**:
- Complex business logic not obvious from names
- Workarounds for third-party bugs
- Performance optimizations with trade-offs
- Non-obvious side effects or edge cases

### General Best Practices
- **Single Responsibility**: Each class has one reason to change
- **Dependency Injection**: Always inject via constructor, avoid `new` keyword for services
- **Type Safety**: Never use `any`. Enable all strict TypeScript checks
- **Logging**: Use NestJS Logger, never log PII/PHI
- **Error Handling**: Use domain-specific exceptions from shared error codes
- **Validation**: Only at trust boundaries (HTTP, external APIs)
- **Code Reuse**: Check `src/shared/` before writing new utilities
- **Consistency**: Follow established patterns across modules

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
