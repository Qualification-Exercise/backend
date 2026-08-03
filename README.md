# WDK Cashback — backend

Cashback for retail payments: a customer pays a merchant in USD₮, the backend
notices, and 5 % of the payment comes back as a coupon the customer redeems for
a utility token (UTL).

Two chains, on purpose:

- **payments** are detected on mainnet (Ethereum, Arbitrum One) through the
  hosted WDK Indexer API;
- **rewards** settle on **Ethereum Sepolia**, where `CouponClaim` mints UTL.

Nearly every mistake on this path comes from confusing the two, so the split is
spelled out everywhere it matters.

---

## How a payment becomes a token

```
  device ──pays USD₮──▶ merchant address (mainnet)
                             │
   WDK Indexer API ◀─────────┘
        │  polled, never trusted
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ API process                                              │
  │  payment poller → pricing → accrual → coupon (5 %)       │
  │  REST for the app: wallets, coupons, claims              │
  └──────────────────────────────────────────────────────────┘
        │ claim, signed by the user's wallet
        ▼
  ┌──────────────┐   K signatures   ┌──────────────┐  claim()  ┌─────────────┐
  │ issuer × N   │ ───────────────▶ │ relayer      │ ────────▶ │ CouponClaim │
  │ own RPC+key  │                  │ own RPC+key  │  pays gas │  (Sepolia)  │
  └──────────────┘                  └──────────────┘           └─────────────┘
        ▲                                                            │
        │                                  Claimed event             ▼
  ┌──────────────┐                  ┌────────────────────┐     ┌──────────┐
  │ monitor      │◀── reconciles ───│ settlement watcher │     │ UTL mint │
  │ guardian key │    can pause()   └────────────────────┘     └──────────┘
  └──────────────┘
```

The shape of that diagram is the security model. Payment detection depends on a
third party, so **no single process can turn an indexer answer into a mint**: the
issuers re-verify every payment against their own nodes, the relayer re-verifies
again before spending gas, and the monitor reconciles minted supply against the
payments that justify it — each with its own RPC endpoint and its own key.

| Process            | Holds                          | May write                       | Never                       |
| ------------------ | ------------------------------ | ------------------------------- | --------------------------- |
| API                | no chain key                   | users, wallets, coupons, claims | attest, submit              |
| Issuer (×N)        | one `ISSUER_ROLE` key          | `attestations`, claim rejection | spend gas, call the indexer |
| Relayer            | the only chain-**writing** key | claim status                    | create attestations         |
| Settlement watcher | no key                         | settlements, claim status       | anything on-chain           |
| Monitor            | guardian (`PAUSER_ROLE`)       | nothing                         | repair, attest, submit      |

---

## Quick start

```bash
npm ci
cp .env.example .env                 # DB, indexer key, contract addresses, RPC maps
npm run docker:up                    # Postgres + Redis + Adminer
npm run migration:run                # 13 migrations
NODE_ENV=development npm run seed    # test user + the demo signer addresses
npm run dev
```

- API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/api`
- Health: `http://localhost:3000/health` — deliberately **outside** the `/api`
  prefix, because that is where load balancers and container health checks look

---

## Processes

Each background role is its own process with its own env file, because
"independent" is the property that makes K-of-N mean anything.

```bash
npm run dev                                     # API + poller + pricing + accrual
ISSUER_ENV_FILE=.env.issuer-a npm run issuer    # attestation loop
RELAYER_ENV_FILE=.env.relayer npm run relayer
SETTLEMENT_ENV_FILE=.env.settlement npm run settlement
MONITOR_ENV_FILE=.env.monitor npm run monitor
```

One-shot equivalents for walkthroughs and debugging — one pass, then exit:

```bash
npm run poll:once     # ingest → price → accrue
npm run issue:once    # verify + sign the pending claims
npm run relay:once    # preflight + claim() + wait for the receipt
```

Utilities:

```bash
npm run key:password                       # generate SIGNER_KEY_PASSWORD
echo 0x<privkey> | npm run key:encrypt     # wrap a signing key for an env file
npm run verify:signer                      # sign the contracts fixture with the real WDK account
npm run dev:token                          # a JWT the guard accepts (local only)
npm run dev:token sign <nonce> <coupon>    # the claim-screen signature
npm run monitor:pause-drill -- --check     # can the guardian actually pause?
```

`.env.issuer.example`, `.env.relayer.example`, `.env.settlement.example` and
`.env.monitor.example` document what each process needs.

---

## API surface

Everything below is implemented, under the `/api` prefix. The full contract —
including the endpoints still to be built — is in
`../WDK Qualification Test/plan/API Endpoints — ReferenceHt.md`.

| Method | Path                        | Purpose                                                     |
| ------ | --------------------------- | ----------------------------------------------------------- |
| GET    | `/health`                   | liveness + database connectivity (no prefix)                |
| GET    | `/config`                   | cashback rate, UTL rate, confirmation depths                |
| POST   | `/auth/google`              | Google `idToken` → our JWT pair                             |
| POST   | `/auth/refresh`             | refresh → new pair                                          |
| POST   | `/auth/dev/test-token`      | development only, after `npm run seed`                      |
| GET    | `/users/me`                 | current user                                                |
| POST   | `/wallets`                  | link every address derived from the mnemonic, in one call   |
| GET    | `/wallets`                  | the user's linked addresses                                 |
| GET    | `/coupons`                  | coupon list; `PENDING` rows carry a live confirmation count |
| GET    | `/coupons/:id`              | one coupon                                                  |
| GET    | `/coupons/by-code/:code`    | resolve a manually typed code                               |
| GET    | `/claims/challenge?coupon=` | nonce + the exact message to sign                           |
| POST   | `/claims`                   | claim one coupon (`Idempotency-Key` required)               |
| GET    | `/claims/:id`               | poll status and attestation progress                        |
| GET    | `/pricing/live`             | live asset price                                            |
| GET    | `/indexer/token-transfers`  | indexer passthrough (debugging)                             |

### Where the signature happens

The user signs **once**, on the claim screen:

1. `POST /wallets`, right after the seed phrase exists — a _declaration_ of
   addresses, no signature. Everything lands `verified: false`.
2. `GET /claims/challenge?coupon=CODE` → a single-use nonce and the exact
   `message` to sign (`personal_sign`), with the coupon code inside it so one
   signature cannot be replayed against another coupon.
3. `POST /claims { code | couponId, challengeId, signature }` → the signature must
   recover to the user's primary EVM address. That marks the address `verified`
   and, if somebody else had merely declared it, **takes it from them**: a
   declaration never outranks a proof.

Linking without a signature is a deliberate trade. A linked address earns
coupons, but only a signature releases money, so three prompts during onboarding
would buy nothing the claim-time proof does not already guarantee. Someone who
links an address they cannot sign for collects coupons they can never claim.

---

## Configuration

`src/config/env.ts` is the single schema (Zod, fail-fast at startup); every
variable is documented there and mirrored in `.env.example`.

| Group             | Keys                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Runtime           | `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `LOG_LEVEL`                                                                               |
| Database / Redis  | `DB_*`, `REDIS_*`                                                                                                             |
| Auth              | `JWT_SECRET`, `JWT_EXPIRATION`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `JWKS_URI`, `GOOGLE_*_CLIENT_ID`                              |
| Indexer           | `INDEXER_BASE_URL`, `INDEXER_API_KEY`, `PAYMENT_POLL_*`                                                                       |
| Money             | `CASHBACK_BPS` (500 = 5 %), `UTL_USD_RATE`, `PRICING_*`, `ACCRUAL_*`                                                          |
| Chains            | `CONFIRMATION_DEPTHS`, `RPC_URLS`, `TOKEN_ADDRESSES`, `REWARD_CHAIN_ID`                                                       |
| Contracts         | `COUPON_CLAIM_CONTRACT_ADDRESS`, `UTILITY_TOKEN_CONTRACT_ADDRESS`                                                             |
| Claims            | `ATTESTATION_THRESHOLD`, `CLAIM_COOLDOWN_HOURS`, `CLAIM_DEADLINE_SECONDS`, `CLAIM_SWEEP_INTERVAL_MS`                          |
| Issuer            | `ISSUER_ID`, `ISSUER_RPC_URLS`, `ISSUER_SIGNING_KEY`, `ISSUER_PRICE_PROVIDER`, `PRICE_TOLERANCE_BPS`, `PRICE_WINDOW_SECONDS`  |
| Relayer           | `RELAYER_RPC_URLS`, `RELAYER_SIGNING_KEY`, `RELAYER_CONFIRMATIONS`, `RELAYER_MAX_FEE_GWEI`, `RELAYER_DEADLINE_MARGIN_SECONDS` |
| Watcher / monitor | `SETTLEMENT_*`, `MONITOR_*`, `ALERT_WEBHOOK_URL`, `ALERT_TELEGRAM_CHAT_ID`                                                    |
| Keys              | `SIGNER_KEY_PASSWORD`                                                                                                         |

Two rules the code enforces at startup rather than in review:

- **`*_RPC_URLS` is a map keyed by `srcChainId`.** Payments are on mainnet and
  rewards on Sepolia, so a verifier needs a node for the chain the _payment_ is
  on. A chain with no endpoint is refused (`NO_NODE`) rather than asked of the
  wrong node.
- **No two processes may share an RPC endpoint.** Two verifiers behind one
  provider are one verifier wearing two hats, so the process refuses to start.

### Keys

Signing keys are never in the database and never in plaintext:

```
ISSUER_SIGNING_KEY=enc:argon2id$m=65536,t=3,p=1$<salt>$<iv||ciphertext||tag>
```

`enc:` is opened with `SIGNER_KEY_PASSWORD` (32 random bytes) using Argon2id at
the same parameters as the mobile seed backup. `env:0x…` is refused outside
development; `kms:<arn>` is the production shape and is deliberately **not
implemented** rather than faked — a stub that signed locally would make an
insecure deployment look secure. Signing goes through
`@tetherto/wdk-wallet-evm`, so backend and wallet share one implementation.

The `signers` table holds **addresses only** (issuer, relayer, guardian), and
each process refuses to start unless its own address is an active row there.

---

## Database

- 13 explicit migrations in `src/database/migrations/`, listed in `index.ts` and
  never globbed: `nest build` bundles to a single file with no migration files on
  disk to match.
- Every entity is listed in `src/database/entities.ts` for the same reason, and a
  test fails if a new `*.entity.ts` is missing from the list. Relations are a
  graph — a process that registers `Wallet` without `User` dies at boot.
- `migration:generate` must report **no changes** on a clean database; that is
  the drift check between entities and SQL.
- `docs/db-roles.sql` grants the least-privilege roles the trust model assumes:
  an issuer that cannot insert coupons, a relayer that cannot insert
  attestations, a read-only monitor.

```bash
npm run migration:generate -- src/database/migrations/Name
npm run migration:run
npm run migration:revert
npm run seed
```

Migrations run at startup (`migrationsRun: true`) — a single-instance assumption:
two replicas booting together race on the migrations table.

---

## Testing

```bash
npm test
npm run test:cov
```

303 tests, ~67 % statement coverage. The threshold in `jest.config.js` is still
the scaffold-era 20 % and should be raised as the remaining endpoints land.

Three kinds of test matter more than the count:

- **Cross-repo drift.** `payment-ref.spec.ts` and `entitlement.spec.ts` read the
  committed fixtures from the contracts repo directly (`PAYMENT_REFS_FIXTURE`,
  `ENTITLEMENT_FIXTURE`) and assert that TypeScript and Solidity produce the same
  `paymentRef` and the same EIP-712 digest. Editing a fixture to make a test pass
  defeats the point of having one.
- **Golden amounts.** Accrual and the issuer must both reproduce
  `test/fixtures/accrual/golden-amounts.json` byte for byte — a different amount
  is a different digest, and no signature would reach the threshold.
- **Isolation guards.** Tests walk the issuer's and relayer's module graphs and
  fail if the indexer client, a controller, or an attestation write turns up
  where it must not.

WDK's ESM-only signer cannot be imported by Jest's CommonJS runtime, so the real
signing path is exercised by `npm run verify:signer` under plain node instead.

---

## CI/CD

`.github/workflows/ci.yml`:

- **check** — lint, formatting, tests against a Postgres service, with the
  contracts repo checked out for the drift fixtures;
- **build** — `nest build` plus a Docker image build (not pushed).

Deployment is **Dokploy** (self-hosted) watching `main`. CI does not deploy — it
gates: branch protection on `main` requires `check` and `build`, so a red
pipeline cannot reach the branch Dokploy pulls from.

---

## Not built yet

From the endpoint contract in the plan docs:

- **Secrets / seed backup**: `PUT|GET /secrets/entropy`, `PUT|GET /secrets/seed`,
  `DELETE /secrets`. The `wallet_secrets` table exists and matches the WDK
  ciphertext format; the routes, the Argon2id-wrapped key upload and the KDF
  floor in `GET /config` do not.
- **Transactions and balances**: `GET|POST /transactions`,
  `GET /transactions/:id`, `GET /balances`. The table matches the documented
  shape; the service is empty.
- **Claims**: `GET /claims` (list) and `GET /claims/preview` (claimable set and
  cooldown state).
- **`POST /auth/session` / `GET /me`** as named in the reference — the same
  ground is covered today by `/auth/google` and `/users/me`.
- Rate limiting on sensitive routes, helmet, request correlation ids.
- Coverage to the 90 % the exercise asks for, and integration tests for the raw
  SQL paths (coupon list, idempotency) that unit tests cannot reach.
- Non-EVM verification: Bitcoin, Tron and Spark payments are ingested, but no
  issuer can verify them without a node of that kind, so they are refused rather
  than guessed at.

---

## Conventions

Naming, module layout, service/repository/DTO patterns and commit style live in
[`CLAUDE.md`](./CLAUDE.md). Deeper architecture notes are in
[`docs/architecture.md`](./docs/architecture.md), and the system-level design in
`../WDK Qualification Test/plan/`.
