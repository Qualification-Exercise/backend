# Architecture

How this codebase is put together. [`../README.md`](../README.md) is the
orientation and the operator's view; the _why_ behind the design — trust model,
threat cases, alternatives rejected — lives in
`../../WDK Qualification Test/plan/`. This file sits in between: processes,
modules, tables, state machines and the concurrency rules that keep them honest.

---

## One codebase, five processes

The repository builds one Nest application graph with five entry points. They
share entities, migrations and helpers, and differ in which modules they load —
which is exactly how the trust boundaries are drawn.

| Entry point               | Loads                                                                           | Holds                      | Loop                                 |
| ------------------------- | ------------------------------------------------------------------------------- | -------------------------- | ------------------------------------ |
| `src/main.ts`             | `AppModule` — auth, users, wallets, coupons, claims, payments, pricing, indexer | no chain key               | HTTP + poller/pricing/accrual timers |
| `src/issuer/main.ts`      | `IssuerModule`                                                                  | one `ISSUER_ROLE` key      | attest pending claims                |
| `src/relayer/main.ts`     | `RelayerModule`                                                                 | the only chain-writing key | submit `claim()`                     |
| `src/settlements/main.ts` | `SettlementsModule`                                                             | nothing                    | read `Claimed`, reconcile            |
| `src/monitor/main.ts`     | `MonitorModule`                                                                 | guardian (`PAUSER_ROLE`)   | reconcile, alert, `pause()`          |

Only `src/main.ts` calls `NestFactory.create`. The other four use
`createApplicationContext`: the processes holding keys have no inbound HTTP
surface at all.

Two module-graph rules are asserted by tests rather than left to review
(`issuer-independence.spec.ts`, `relayer-isolation.spec.ts`):

- neither the issuer nor the relayer may reach `IndexerModule` or
  `PaymentsModule` — a transitive import would start a second poller against the
  shared indexer budget and put the client one `inject()` away from the layer
  built to distrust it;
- neither may declare a controller, and the relayer may not write `attestations`.

`ConfirmationPolicy` is provided directly wherever it is needed instead of
importing `PaymentsModule` for it: it is pure configuration (depths per chain)
with no network of its own.

---

## Module map

```
src/
├── main.ts                    HTTP entry point
├── app.module.ts              API composition root
│
├── auth/                      Google id_token → our JWT; JwtStrategy + guard
├── users/                     user records, identity is the IdP `sub`
├── wallets/                   address linking (declaration), address normalisation
├── coupons/                   coupon read API + accrual loop (5 % of a payment)
├── pricing/                   one canonical USD snapshot per payment
├── payments/                  merchant registry, indexer polling, confirmation policy
├── indexer/                   the single HTTP client for the WDK Indexer API
├── claims/                    claim challenge, claim creation, claim state machine
├── attestations/             issuer signatures over an entitlement
├── settlements/               `Claimed` watcher process + settlement records
├── issuer/                    issuer process: verify, price-check, sign
├── relayer/                   relayer process: preflight, nonce queue, submit
├── monitor/                   monitor process: reconcile, alert, pause
├── signers/                   registry of issuer/relayer/guardian addresses
├── transactions/              history table (device- and poller-written)
├── idempotency/               replay protection for POST /claims
├── chains/                    the chain registry and `paymentRef` derivation
├── config/                    Zod env schema, GET /config
├── database/                  entity registry, migrations, seed
└── common/
    ├── alerts/                one alert type; every alert names a subject
    ├── chain/                 payment verifier (own-node), event cursors
    ├── crypto/                Argon2id + AES-256-GCM secret box
    ├── signing/               WDK signer, `enc:` / `env:` / `kms:` key refs
    └── metrics/               counters the monitor reads across processes
```

Per-module layout, naming and service/DTO patterns are in
[`../CLAUDE.md`](../CLAUDE.md).

---

## Data model

Seventeen tables, grouped by what they are for.

**Identity and wallets**

| Table              | Carries                               | Invariant that matters                                                                           |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `users`            | IdP subject → user                    | `UNIQUE (externalAuthId)`. Email is display-only: not unique, not an identity                    |
| `wallets`          | one address per chain per user        | `UNIQUE (chain, address)`, `UNIQUE (userId, chain)`, one primary per user (partial unique index) |
| `wallet_secrets`   | client-encrypted entropy/seed         | opaque ciphertext + free-form `metadata`, append-only list per user and kind                     |
| `claim_challenges` | single-use nonce for the claim screen | `UNIQUE (nonce)`, consumed once, five-minute TTL                                                 |

**The money path**

| Table              | Carries                                | Invariant that matters                                                                              |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `merchants`        | registered payee addresses             | `UNIQUE (srcChainId, address)`                                                                      |
| `indexer_cursors`  | poll position per chain/token/merchant | last block/tx/transfer index — ordering, not timestamps                                             |
| `payments`         | observed merchant transfers            | `UNIQUE (srcChainId, txHash, outputIndex)`, plus the derived `paymentRef`                           |
| `price_snapshots`  | one canonical USD price per payment    | `UNIQUE (paymentRef)` and an append-only trigger — no UPDATE, no DELETE                             |
| `coupons`          | 5 % cashback, one per payment          | `UNIQUE (paymentRef)`, `UNIQUE (code)`, state machine enforced by trigger                           |
| `claims`           | one claim per coupon                   | `UNIQUE (coupon_id)`, state machine trigger, `FAILED` iff a reason is set                           |
| `attestations`     | issuer signatures                      | `UNIQUE (claim_id, issuer_address)` — the DB mirror of the contract's strict-ascending signer check |
| `settlements`      | on-chain `Claimed` events              | `UNIQUE (payment_ref)`                                                                              |
| `idempotency_keys` | replay protection                      | `UNIQUE (user_id, idempotency_key)`                                                                 |

**Operational**

`signers` (addresses of issuer/relayer/guardian — never keys), `event_cursors`
(how far a chain-event reader has read), `service_counters` (indexer request /
error / 429 counts the monitor reads from another process), `transactions`
(history the app pages through).

Two rules the schema encodes rather than the code:

- **amounts are `NUMERIC(78, 0)` in the smallest unit.** 78 digits covers
  `uint256`; `bigint` overflows on 18-decimal tokens, and floats have no business
  near money.
- **`paymentRef = keccak256(abi.encode(srcChainId, txHash, outputIndex))`** is the
  same value on-chain and off: the contract's nullifier and our dedup key are
  literally the same bytes. Derivation lives in `src/chains` and is cross-checked
  against the contracts repo's fixtures.

---

## State machines

Both are enforced by database triggers, so a service that gets its state
handling wrong gets an error rather than a row a later payout reads as
authorisation.

```
coupon:   PENDING ──▶ ISSUED ──▶ PENDING_ATTESTATION ──▶ ATTESTED
                        ▲              │                    │
                        └──────────────┴────────────────────┴──▶ (released)
                                       ▼
                        CLAIM_SUBMITTED ──▶ CLAIMED
          any ──▶ EXPIRED | ORPHANED

claim:    PENDING_ATTESTATION ──▶ ATTESTED ──▶ CLAIM_SUBMITTED ──▶ CLAIMED
                  │                  │                │
                  ▼                  ▼                ▼
                FAILED         FAILED | EXPIRED     FAILED
```

`PENDING` coupons are a projection, not rows: the coupon list unions confirmed
coupons with the caller's payments that have not reached confirmation depth, so
the app can render "4 / 20 confirmations" instead of a spinner.

Who moves what: accrual creates `ISSUED`; the API moves `ISSUED →
PENDING_ATTESTATION` when a claim is created; the issuer moves to `ATTESTED` at
K signatures or fails the claim; the relayer moves to `CLAIM_SUBMITTED`; the
settlement watcher moves to `CLAIMED`. Every failure path releases the coupon
back to `ISSUED` — nothing is left in limbo, and nothing is retried
automatically.

---

## Data flows

### Payment → coupon

```
poller      merchants (active) → indexer batch query, cursor-bounded
            filter to inbound transfers, ordered by (block, txIndex, transferIndex)
            insert payments (paymentRef, status=pending|ignored)
            attribute the payer via wallets, matched by chain KIND
pricing     for each confirmed payment: one immutable price_snapshots row
accrual     confirmed + priced + no coupon yet → coupon (ISSUED, 5 %, code)
```

The poller trusts the indexer for _what it returns_ and nothing else: the
recipient must be a registered merchant, ordering comes from the cursor, and a
transfer from an address nobody linked is recorded `ignored` rather than retried
forever. Confirmation depth is decided by `ConfirmationPolicy` against our own
RPC, never by the indexer's opinion.

### Claim → mint

```
app     GET /claims/challenge?coupon=CODE   → nonce + exact message
        personal_sign(message)
        POST /claims { code, challengeId, signature, Idempotency-Key }

API     advisory lock on the user
        cooldown check → resolve coupon → resolve recipient (primary EVM)
        consume challenge, recover signer, require == recipient
        mark the wallet verified (taking it from a squatter if needed)
        UPDATE coupons SET status=PENDING_ATTESTATION WHERE status=ISSUED  ← the check
        INSERT claims (amount and paymentRef copied verbatim)

issuer  re-derive paymentRef; read the receipt from ITS OWN node; check block,
        reorg, depth, log index, token contract, merchant, payer, amount;
        validate the snapshot against its own price provider (±1 %, time window);
        recompute the 5 % and compare; re-check recipient and rate limit;
        sign EIP-712 Entitlement → attestations

relayer verify the payment against ITS OWN node; preflight everything the
        contract would check (paused, nullifier, caps, deadline, signer roles,
        strict ascending order); estimate gas; sign; submit with a sequential
        nonce from a serialised queue; wait for the receipt

watcher read Claimed logs → settlements + claim CLAIMED
        unknown paymentRef → CRITICAL alert (a mint outside the pipeline)
        submitted-but-never-settled past deadline → release the coupon
```

### Failure paths

An issuer that disagrees writes the reason, raises an alert and fails the claim
(`ATTESTATION_REJECTED`); the relayer that cannot submit does the same
(`SUBMISSION_FAILED`) _before_ spending gas. Neither retries: a refusal is a
statement about the payment, and asking again until it says yes is precisely the
wrong response.

---

## Concurrency and correctness

The interesting parts of this backend are the places where two things happen at
once. Each is handled by the database rather than by careful ordering in code:

| Race                                         | Handled by                                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Two claims for one coupon                    | `UPDATE coupons … WHERE status = 'ISSUED' RETURNING id` — the state change _is_ the check — plus `UNIQUE (coupon_id)` on claims               |
| Retried `POST /claims`                       | `INSERT … ON CONFLICT DO NOTHING` on `idempotency_keys` inside the same transaction as the work; the loser reads the winner's stored response |
| Two claims by one user inside the cooldown   | `pg_advisory_xact_lock(hashtext(userId))` for the rest of the transaction                                                                     |
| One issuer signing twice                     | `UNIQUE (claim_id, issuer_address)`, mirroring the contract's ordering rule                                                                   |
| Two relayer transactions with the same nonce | `NonceManagerService`: one in-flight submission, nonce from a local counter, resync from the chain on failure                                 |
| Overlapping poll windows                     | `UNIQUE (srcChainId, txHash, outputIndex)`; a duplicate is a no-op update of `lastSeenAt`                                                     |
| Re-reading a block range after a restart     | `UNIQUE (payment_ref)` on settlements                                                                                                         |
| Illegal state transitions                    | `coupons_state_machine` / `claims_state_machine` triggers                                                                                     |

---

## Error handling and alerts

HTTP errors are shaped by `GlobalExceptionFilter` into
`{ error: { code, message, details? } }` with codes from
`src/common/enums/error-codes.enum.ts`. Ownership questions answer `404`, never
`403`: a `403` on a coupon code would confirm that the code exists.

Background failures go through `AlertService`, whose `IAlert` type makes
`subject` mandatory — an alert that says "reconciliation failed" sends someone
hunting; one that names the claim or the `paymentRef` sends them to the row.
Alerts are logged as `security_event=…` lines and optionally POSTed to
`ALERT_WEBHOOK_URL`; a pager that is down never takes the process with it.
When that URL is a Telegram `sendMessage` endpoint and `ALERT_TELEGRAM_CHAT_ID`
is set, the payload is rewritten into the Bot API's `{chat_id, text}` shape —
the Bot API does not accept arbitrary JSON, so posting the raw alert to it
would fail silently on every alert.

---

## Security boundaries

- **Keys.** `enc:argon2id$…` blobs in each process's env, opened with
  `SIGNER_KEY_PASSWORD`; `kms:` is the production shape and is unimplemented
  rather than faked. Signing goes through `@tetherto/wdk-wallet-evm`.
- **Nodes.** Every verifying process has its own RPC map per `srcChainId` and
  refuses to start if it shares an endpoint with another process.
- **Database.** `docs/db-roles.sql` grants what the trust model assumes: an
  issuer that cannot insert coupons, a relayer that cannot insert attestations, a
  read-only monitor. In code these are also asserted structurally by the
  isolation tests.
- **Ownership.** Linking an address is a declaration; the claim-time signature is
  the proof, and it takes the address from anyone who declared it first without
  being able to sign.

---

## Testing strategy

Unit tests mock repositories and drive services directly; the tests that carry
the most weight are the cross-repo drift fixtures, the golden accrual vectors and
the module-graph isolation guards — see the testing section of
[`../README.md`](../README.md). Migrations are verified against a real Postgres:
`migration:generate` must report no changes on a clean database.

---

## Known limitations

- Migrations run at process start (`migrationsRun: true`): fine for one instance,
  a race for two.
- Fixed epoch windows in the contract mean up to 2× `epochCap` can mint across a
  boundary; bounded deliberately, documented in the contracts spec §5.5.
- Non-EVM payments (Bitcoin, Tron, Spark) are ingested but cannot be verified —
  no issuer has a node of that kind, so they are refused rather than guessed at.
- No queue: services hand work to each other through DB rows and polling. That is
  a latency and throughput ceiling, not a correctness one, and a broker is the
  natural first upgrade if volume demands it.
