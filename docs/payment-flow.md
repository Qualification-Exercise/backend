# Payment Flow: Complete Guide

This document traces the complete flow from payment ingestion through coupon issuance, claiming, and settlement. It explains the entities, state machines, service responsibilities, and reorg-safety guarantees.

## Overview

```
Payment Ingestion
       ↓
Payment Confirmation (depth-based)
       ↓
Coupon Issuance (accrual)
       ↓
Coupon Claim (user redeems)
       ↓
Settlement (on-chain payout)
       ├─ Confirmed (safe)
       └─ Orphaned (reorg detected → alert ops)
```

## Entities

### Payment
**Table:** `payments`  
**Location:** `src/payments/entities/payment.entity.ts`

Represents an incoming blockchain transfer. Immutable once confirmed.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `paymentRef` | string | Unique on-chain reference (hash + output index) |
| `userId` | UUID | Recipient user |
| `srcChainId` | number | Source chain (11155111 = Sepolia, etc) |
| `token` | string | Asset symbol (usdt, usdc, etc) |
| `amount` | decimal | Exact amount transferred |
| `status` | enum | `pending` → `confirmed` OR `orphaned` |
| `blockNumber` | number | Block where payment was seen |
| `txHash` | string | Transaction hash |
| `outputIndex` | number | Position in tx outputs |
| `fromAddress` | string | Sender address |
| `merchantAddress` | string | Recipient merchant address |
| `transferredAt` | timestamp | When payment occurred on-chain |
| `confirmedAt` | timestamp | When reorg-safe depth reached |
| `lastSeenAt` | timestamp | Last block checked (for orphan detection) |

**Status Machine:**
```
null (created)
  ↓
pending (unconfirmed, seen once)
  ↓
confirmed (deep enough, reorg-safe)

OR

pending → orphaned (disappeared from chain)
```

### Coupon
**Table:** `coupons`  
**Location:** `src/coupons/entities/coupon.entity.ts`

Represents a cashback coupon issued against a payment.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `paymentRef` | string | Foreign key to `payments.paymentRef` (1:1) |
| `code` | string | Human-readable claim code (e.g., `AAAA-BBBB-CCCC-DDDD`) |
| `userId` | UUID | Coupon owner (same as payment's userId) |
| `amount` | decimal (wei) | Coupon value in UTL units (18 decimals) |
| `asset` | string | Asset type (USDT, USDC, etc) |
| `status` | enum | State in claim lifecycle |
| `createdAt` | timestamp | When issued |
| `updatedAt` | timestamp | When last changed |

**Status Machine:**
```
ISSUED (created by accrual)
  ↓
PENDING (user awaits attestation)
  ↓
PENDING_ATTESTATION (in flight to attestation service)
  ↓
ATTESTED (proof obtained)
  ↓
CLAIM_SUBMITTED (user claimed, waiting on-chain confirmation)
  ↓
CLAIMED (settlement confirmed on-chain, money sent to user)

OR at any pre-CLAIMED state:
  ↓
ORPHANED (payment orphaned, void this coupon)

OR when CLAIMED + payment orphaned:
  → Alert ops (CRITICAL, clawback required)
```

### PriceSnapshot
**Table:** `price_snapshots`  
**Location:** `src/pricing/entities/price-snapshot.entity.ts`

Exchange rate snapshot for accrual calculation.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `paymentRef` | string | Foreign key to `payments.paymentRef` (1:1) |
| `asset` | string | Asset (USDT, USDC, etc) |
| `quote` | string | Quote currency (USD) |
| `price` | decimal | Exchange rate (asset per quote) |
| `source` | string | Price provider (bitfinex, coinbase, etc) |
| `providerTimestamp` | timestamp | When provider recorded this |
| `ingestedAt` | timestamp | When we stored it |

---

## Service Responsibilities

### PaymentPollerService
**File:** `src/payments/services/payment-poller.service.ts`  
**Interval:** Every `PAYMENT_POLL_INTERVAL_MS` (default 6000ms)

Monitors blockchain for payment depth and orphans.

**Flow per tick:**

1. **Fetch new payments from indexer**
   - Calls `IndexerService.batchTokenTransfers()`
   - Gets last known block from `IndexerCursorEntity`
   - Filters: transfers to merchant wallet, matched to known users
   - Inserts new `Payment` rows with status=`pending`

2. **Confirm payments** (depth-based)
   - Queries all pending payments
   - For each: checks current block depth via `ConfirmationPolicy`
   - If deep enough (reorg-safe): `status = confirmed`, set `confirmedAt`
   - Deep = chain length − payment block ≥ threshold (e.g., 12 blocks for Ethereum)

3. **Detect orphans** (reorg detection)
   - Queries all confirmed payments
   - Rechecks if still present in current chain
   - If disappeared: `status = orphaned`, set `lastSeenAt`
   - Logged as `security_event=payment.orphaned`

**Key:** Only confirmed payments feed coupons. Unconfirmed payments wait.

---

### PricingService
**File:** `src/pricing/services/pricing.service.ts`  
**Interval:** Every `PRICING_POLL_INTERVAL_MS` (default 30000ms)

Fetches and caches exchange rates.

**Flow:**

1. Queries all confirmed payments without price snapshots
2. For each asset (USDT, USDC, etc):
   - Fetches live rate from Bitfinex (or configured source)
   - Stores `PriceSnapshot` row linked to `paymentRef`
3. Handles errors: waits if unavailable, never guesses prices

**Key:** Accrual waits for both confirmation AND pricing before issuing coupon.

---

### AccrualService
**File:** `src/coupons/services/accrual.service.ts`  
**Interval:** Every `ACCRUAL_POLL_INTERVAL_MS` (default 30000ms)  
**Disabled if:** `ACCRUAL_POLL_INTERVAL_MS <= 0`

Converts confirmed payments into coupons.

**Flow per tick:**

1. **Void orphaned coupons** (reorg safety)
   - Query unclaimed coupons with orphaned payments
   - Transition to `ORPHANED` (safe void, never charged to user)
   - Logged as `security_event=coupon.orphaned`

2. **Alert on claimed orphaned coupons** (clawback)
   - Query claimed coupons with orphaned payments
   - Raise CRITICAL alert to Telegram/ops
   - Alert includes: couponId, paymentRef, amount, asset
   - Logged as `security_event=coupon.orphaned_after_claim`
   - Alert re-fires every tick (30s nag) until payment reconfirmed

3. **Issue new coupons** (accrual)
   - Query confirmed payments without coupons (and with price snapshots)
   - For each payment:
     - Calculate `couponAmount = paymentAmount × assetPrice × (cashbackBps / 10000) / utlUsdRate`
     - Generate random 16-char code (collision-resistant)
     - Insert `Coupon` row with status=`ISSUED`
   - Retries on code collision (1-in-2^80 event)

**Constraints:**
- Each payment links to max 1 coupon via unique `paymentRef`
- Cannot issue coupon for payment without pricing
- Cannot issue coupon for unconfirmed payment

---

### ClaimService
**File:** `src/coupons/services/claim.service.ts`

User redeems coupon via attestation + on-chain claim.

**Flow:**

1. User submits coupon code
2. Service finds matching coupon (status=`ISSUED`)
3. Initiates attestation (off-chain proof)
4. Updates coupon → status=`PENDING_ATTESTATION`
5. Waits for attestation service response
6. Updates coupon → status=`ATTESTED`
7. Calls relayer to submit on-chain claim
8. Updates coupon → status=`CLAIM_SUBMITTED`
9. RelayerService confirms execution
10. Updates coupon → status=`CLAIMED`

---

### SettlementWatcherService
**File:** `src/settlements/services/settlement-watcher.service.ts`  
**Interval:** Every `SETTLEMENT_POLL_INTERVAL_MS`

Monitors on-chain settlements and detects failures.

**Flow:**

1. Polls contract for settled claims
2. Confirms each claim was paid out
3. If claim failed (tx reverted): alerts ops
4. If claim orphaned after settlement: alerts ops (clawback)

---

## Timing & Concurrency

### Order Matters
```
PaymentPollerService (6s interval)
  ↓
PricingService (30s interval)
  ↓
AccrualService (30s interval)
```

Payment must confirm before pricing is fetched, pricing must be ready before accrual issues coupon.

### Guards Against Overlap
Each service uses `private running: boolean` flag:
```typescript
async tick() {
  if (this.running) {
    this.logger.warn('Previous tick still running; skip this one');
    return;
  }
  this.running = true;
  try {
    // actual work
  } finally {
    this.running = false;
  }
}
```

If a tick takes longer than the interval, the next tick is skipped entirely (not queued).

### Single Instance
Current deployment assumes **one backend instance**. `setInterval` on each service runs per-process:
- If you scale to 2 instances: each polls independently (duplicate work, but safe — `paymentRef` unique constraint prevents duplicate coupons)
- To coordinate across instances: migrate to BullMQ (future TODO)

---

## Reorg Safety Guarantees

### Definition
"Reorg-safe" = a confirmed payment will not disappear in future blocks due to chain reorganization.

### Confirmation Policy
**File:** `src/payments/confirmation-policy.ts`

Defines depth threshold per chain:
```typescript
// Sepolia: 12 blocks (fast test chain, lower reorg risk)
// Ethereum mainnet: 100+ blocks (high security)
// Polygon: 256 blocks (very high security)
```

**Algorithm:**
```
currentBlock = 19000
paymentBlock = 18990
depth = currentBlock - paymentBlock = 10
threshold = 12
confirmed? = depth >= threshold = false (wait)

// 1 minute later
currentBlock = 19005
depth = 19005 - 18990 = 15
confirmed? = 15 >= 12 = true (safe)
```

### Orphan Detection
After payment confirmed, each poll recheck if still on-chain:
```
Poll 1: block 19005 → payment found at block 18990, depth=15 ✓ confirmed
Poll 2: block 19010 → payment still at block 18990, depth=20 ✓ still safe
Poll 3: block 19020 → payment MISSING from block 18990 → orphaned!
```

Reorg occurred: 10+ blocks were rewritten, payment was removed. Mark as `orphaned`.

### Coupon Orphan Handling

**Unclaimed Coupon (status=ISSUED/PENDING/...)**
- Coupon voidable: transition to `ORPHANED`
- User never charged (cashback never sent)
- Safe operation

**Claimed Coupon (status=CLAIMED)**
- Coupon terminal: settlement already confirmed, money sent to user
- Cannot void or reverse on-chain
- Payment orphaned = money sent but from a reorg'd block
- **Action:** Alert ops immediately, on-chain clawback required
- Alert re-fires every 30s until payment reconfirmed

---

## Error Scenarios

### Scenario 1: Payment Stuck Unconfirmed
**Cause:** Indexer down, blockchain forked, network delay.  
**Symptom:** Payment never reaches `confirmed` status.  
**Resolution:** PaymentPollerService retries indefinitely. Once indexer recovers and chain stabilizes, payment confirms.

### Scenario 2: Price Unavailable
**Cause:** Pricing service down (Bitfinex unavailable).  
**Symptom:** PriceSnapshot never created, coupon never issued.  
**Resolution:** AccrualService skips that payment, waits for next tick. Once pricing recovers, coupon is issued.

### Scenario 3: Payment Reorg'd Before Claim
**Cause:** Blockchain reorg removes payment block.  
**Symptom:** Orphan detected, coupon transitioned to `ORPHANED`.  
**Resolution:** Safe. User never claimed. Coupon voided, cashback not sent.

### Scenario 4: Payment Reorg'd After Claim (Critical)
**Cause:** Blockchain reorg removes payment block after user already claimed.  
**Symptom:** Orphan detected, coupon in `CLAIMED` state.  
**Resolution:** Cannot reverse on-chain settlement. Alert ops (CRITICAL):
```
security_event=coupon.orphaned_after_claim
couponId=<id>
paymentRef=<ref>
amount=<amount>
asset=<asset>
→ On-chain clawback required
```

Ops must manually reclaim funds from user's address on-chain.

### Scenario 5: Indexer Rate Limited
**Cause:** Too many queries to WDK indexer API.  
**Symptom:** PaymentPollerService fails to fetch new payments.  
**Resolution:** Circuit breaker (future: BE-XX) fails fast, waits before retry. Prevents wasting budget on repeated failed calls.

---

## Concurrency & Safety

### Database Constraints
```sql
-- Unique payment per paymentRef (prevent duplicates)
CREATE UNIQUE INDEX idx_payments_paymentref ON payments(paymentRef);

-- Unique coupon per payment (1:1 relationship)
CREATE UNIQUE INDEX idx_coupons_paymentref ON coupons(paymentRef);

-- Unique price per payment (1:1 relationship)
CREATE UNIQUE INDEX idx_price_snapshots_paymentref ON price_snapshots(paymentRef);

-- Unique coupon code (prevent collision)
CREATE UNIQUE INDEX idx_coupons_code ON coupons(code);
```

### Race: Two Instances Issue Coupon for Same Payment
**Setup:** Payment confirmed, pricing ready, two backend instances tick simultaneously.  
**Without constraint:** Both insert coupon → duplicate rows (corrupt data).  
**With constraint:** First insert succeeds, second gets `UNIQUE_VIOLATION` error → catches, checks if coupon exists → returns existing coupon (idempotent).

---

## Configuration

### Environment Variables
```bash
# Payment polling
PAYMENT_POLL_INTERVAL_MS=6000           # How often to check blockchain

# Pricing
PRICING_POLL_INTERVAL_MS=30000          # How often to fetch rates
PRICING_SOURCE=bitfinex                 # Price provider

# Accrual
ACCRUAL_POLL_INTERVAL_MS=30000          # How often to issue coupons
ACCRUAL_BATCH_SIZE=50                   # Coupons per tick
UTL_USD_RATE=1.0                        # Utility token USD price
CASHBACK_BPS=500                        # Cashback rate: 5% = 500 bps

# Confirmation depth (chain-specific)
# Sepolia: 12, Ethereum: 100, Polygon: 256
CONFIRMATION_DEPTH_SEPOLIA=12
CONFIRMATION_DEPTH_ETHEREUM=100
CONFIRMATION_DEPTH_POLYGON=256
```

### Disabling Services
```bash
PAYMENT_POLL_INTERVAL_MS=0              # Disables PaymentPollerService
ACCRUAL_POLL_INTERVAL_MS=0              # Disables AccrualService
```

---

## Testing

### Unit Tests
**Location:** `src/**/*.spec.ts`

Test individual service methods with mocked dependencies:
```bash
npm run test
```

Example: `AccrualService` unit tests mock repositories and verify coupon issuance logic.

### Integration Tests
**Location:** `test/**/*.integration.spec.ts`

Test end-to-end with real Postgres/Redis:
```bash
npm run docker:up
npm test -- test/
```

Example: Create payment → run poller → verify confirmed → run accrual → verify coupon issued.

---

## Monitoring & Observability

### Logs
Each service logs events with structured format:
```
security_event=payment.confirmed paymentRef=0xabc amount=100 userId=user-1
security_event=coupon.issued couponId=cpn-1 code=AAAA-BBBB-CCCC-DDDD
security_event=coupon.orphaned couponId=cpn-1 paymentRef=0xabc from=ISSUED
security_event=coupon.orphaned_after_claim couponId=cpn-1 paymentRef=0xabc amount=100
```

### Alerts
Claimed orphaned coupons raise alerts to Telegram/webhooks:
```
CRITICAL: Clawback required: claimed coupon backing payment orphaned
Coupon c-1 (100.00 USDT) was claimed but backing payment pay-ref-1 became orphaned.
On-chain clawback required.
Context: {couponId: c-1, paymentRef: pay-ref-1, amount: 100, asset: USDT}
```

### Health Endpoint
```
GET /health
→ {
    status: "ok",
    database: "connected",
    redis: "connected",
    indexer: {
      breaker: "closed"  // or "open" or "half-open"
    },
    timestamp: "2026-08-04T10:30:45Z"
  }
```

---

## Future Enhancements (TODO)

1. **Distributed Accrual** (BullMQ)
   - Replace per-instance setInterval with shared Redis queue
   - Coordinate across multiple backend instances
   - Ensure coupons issued once even at scale

2. **Async Settlement Listener**
   - Poll settlement contract for results
   - Verify coupon claims reached on-chain
   - Alert on failures or orphans

3. **Caching**
   - Redis cache for PriceSnapshot (avoid re-fetching)
   - User session cache
   - JWKS cache for auth tokens

4. **Analytics**
   - Coupon issuance rate (coupons/sec)
   - Claim success rate
   - Reorg frequency & impact
   - Orphan clawback rate

---

## Summary

| Phase | Service | Interval | Guarantees |
|-------|---------|----------|-----------|
| **Ingestion** | PaymentPollerService | 6s | Detects new transfers, confirms when deep |
| **Pricing** | PricingService | 30s | Fetches rates, waits if unavailable |
| **Accrual** | AccrualService | 30s | Issues coupons, handles orphans |
| **Claim** | ClaimService | on-demand | Attestation → on-chain claim |
| **Settlement** | SettlementWatcherService | periodic | Confirms on-chain payout, detects failures |

Each phase is independent and replayable. No payment is lost; every coupon is reorg-safe until claimed. Claimed orphans alert ops immediately.

