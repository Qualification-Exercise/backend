# Payment Reorg Safety: Implementation Plan

## Overview
Implement reorg-safety for payments by alerting when claimed coupons have orphaned backing payments (clawback needed).

## Current State
- `PaymentPollerService` detects orphaned payments (payment disappears or moves to different block)
- `AccrualService.voidOrphaned()` already handles unclaimed orphaned coupons (transitions to ORPHANED)
- Claimed orphaned coupons currently just logged as errors — need to alert instead

## Simplified Implementation: 3 Steps

### Step 1: Inject AlertService into AccrualService
**File:** `src/coupons/services/accrual.service.ts`

Add AlertService constructor injection:
```typescript
constructor(
  // ... existing params ...
  private readonly alertService: AlertService,
)
```

**File:** `src/coupons/coupons.module.ts`

Ensure AlertService is available in module:
```typescript
providers: [
  AccrualService,
  ConfirmationPolicy,
  CouponsService,
  AlertService,  // Add if not present
]
```

### Step 2: Replace Logger.error with Alert for Claimed Orphaned Coupons
**File:** `src/coupons/services/accrual.service.ts`, lines 138–143

Replace:
```typescript
for (const coupon of paidOut) {
  this.logger.error(
    `security_event=coupon.orphaned_after_claim couponId=${coupon.id} ` +
      `paymentRef=${coupon.paymentRef} amount=${coupon.amount}`,
  );
}
```

With:
```typescript
for (const coupon of paidOut) {
  this.logger.error(
    `security_event=coupon.orphaned_after_claim couponId=${coupon.id} ` +
      `paymentRef=${coupon.paymentRef} amount=${coupon.amount}`,
  );
  await this.alertService.raise({
    code: 'payment.orphaned_after_claim',
    severity: EAlertSeverity.CRITICAL,
    subject: `Clawback required: claimed coupon backing payment orphaned`,
    message: `Coupon ${coupon.id} (${coupon.amount} ${coupon.asset}) was claimed but backing payment ${coupon.paymentRef} became orphaned. On-chain clawback required.`,
    context: { couponId: coupon.id, paymentRef: coupon.paymentRef, amount: coupon.amount, asset: coupon.asset },
  });
}
```

### Step 3: Add Test for Alert
**File:** `src/coupons/services/accrual.service.spec.ts`

Add test case:
```typescript
it('raises CRITICAL alert when claimed coupon backing payment orphaned', async () => {
  // Seed: a CLAIMED coupon with orphaned payment
  const coupon = await coupons.insert({
    id: 'cpn-1',
    paymentRef: 'pay-1',
    code: 'CODE123',
    userId: 'user-1',
    amount: '1000000000',
    asset: 'USDT',
    status: 'CLAIMED',
  });
  
  const payment = await payments.insert({
    paymentRef: 'pay-1',
    status: 'orphaned',
    // ... other fields ...
  });

  // Mock AlertService
  const mockAlert = jest.fn();
  const service = await buildAccrualService({
    alertService: { raise: mockAlert },
  });

  // Run voidOrphaned
  await service.voidOrphaned();

  // Assert alert was called
  expect(mockAlert).toHaveBeenCalledWith(
    expect.objectContaining({
      code: 'payment.orphaned_after_claim',
      severity: EAlertSeverity.CRITICAL,
      context: expect.objectContaining({ couponId: 'cpn-1' }),
    })
  );
});
```

## How It Works

### Unclaimed Coupon Path (Safe)
1. Payment detected orphaned → `status='orphaned'`
2. `AccrualService.tick()` calls `voidOrphaned()`
3. Query finds coupons with status IN `['ISSUED', 'PENDING', ..., 'CLAIM_SUBMITTED']` where payment orphaned
4. Transition coupon → `'ORPHANED'` (safely voided)
5. Cashback never reaches user

### Claimed Coupon Path (Alert)
1. Payment detected orphaned → `status='orphaned'`
2. `AccrualService.tick()` calls `voidOrphaned()`
3. Query finds coupons with status = `'CLAIMED'` where payment orphaned
4. **Alert raised to Telegram**: `CRITICAL` severity, clawback required
5. On-chain settlement already happened (money sent) → ops manual intervention needed

## Payment ↔ Coupon Linking
- **Link field:** `Coupon.paymentRef` (unique) ↔ `Payment.paymentRef` (unique)
- Already established at coupon creation (line 183 in accrual.service.ts)
- No schema changes needed

## Coupon Status Machine
```
ISSUED → PENDING → PENDING_ATTESTATION → ATTESTED → CLAIM_SUBMITTED → CLAIMED
  ↓        ↓            ↓                   ↓            ↓              ↓
ORPHANED (if payment orphaned)          (no change - terminal state)   Alert ops
```

## Risk: Alert Re-firing
Current: `paidOut` query runs every `ACCRUAL_POLL_INTERVAL_MS` (default 30s).

If a claimed coupon's payment stays orphaned, alert fires every 30s until resolved.

**Options:**
- **Keep as-is:** Persistent nag forces ops attention (recommended for critical clawback)
- **Add one-shot flag:** Track "already alerted" in DB, only fire once per orphan
- **Add timeout:** Alert only if orphan age > N minutes

Current implementation: re-fires (intentional nag).

## Verification Checklist
- [ ] AlertService injectable in AccrualService
- [ ] Alert raised with CRITICAL severity and correct code
- [ ] Test mocks AlertService and verifies call
- [ ] 12 existing PaymentPollerService tests still pass
- [ ] Log message for error path still emitted (before alert)
- [ ] No new external dependencies (AlertService already exists)

## Files Changed
1. `src/coupons/services/accrual.service.ts` — Add AlertService, replace logger.error with alert
2. `src/coupons/coupons.module.ts` — Ensure AlertService in providers
3. `src/coupons/services/accrual.service.spec.ts` — Add alert test

## Related
- Payment orphan detection: `src/payments/services/payment-poller.service.ts::reconcile()`
- Confirmation depth: `src/payments/confirmation-policy.ts`
- Coupon state machine: `src/coupons/entities/coupon.entity.ts` (DB trigger enforces transitions)

## Next: Docs (Optional)
Create `docs/payment-indexer.md` explaining WDK indexer schema, confirmation depth, orphan detection flow, and reorg safety guarantees.
