# 08 — Test results

```
npx vitest run          114 passed (9 files)
npx tsc --noEmit        PASS
npx next build          PASS
```

| Suite | Tests | What it holds |
|---|---|---|
| `architecture.test.ts` | 10 | dependency rule, one settlement engine, no schema guessing, IDOR lint, no `member_id` from a body |
| `shared/money.test.ts` | 18 | integer pesewas, half-up rounding, decimal parsing |
| `contribution/allocation.test.ts` | 26 | worked allocation cases |
| `contribution/conformance.test.ts` | 16 | pure allocator vs the deployed engine, hand-written scenarios |
| `contribution/generated-conformance.test.ts` | 4 | **150 generated scenarios**, captured from the real engine |
| `contribution/allocation.properties.test.ts` | 3 | **3,000 generated scenarios**, 7 invariants |
| `registration/settlement.test.ts` | 15 | short payment, overpayment, replay, state model |
| `registration/conformance.test.ts` | 11 | pure rule vs `settle_registration_fee()` |
| `infrastructure/security/registration-token.test.ts` | 11 | token unpredictability, hashing, malformed input, expiry |

## What the conformance suites caught

**The registration suite, on its first run.** The pure rule was written to
forgive a one-pesewa shortfall; the database forgives none. The capture
disagreed on `GHS 149.99 against a GHS 150.00 fee` and the pure rule was wrong.
Fixed before anything shipped.

**The generated suite, on its first run.** Twelve scenarios showed date-offset
differences with *identical amounts*. That was the test's own anchor inference —
a membership starting with settled days has its first allocated day partway into
the schedule. The capture now records `CURRENT_DATE` rather than letting the
test guess it. 150/150 after.

## Property invariants (3,000 scenarios × 3 policies)

```
1  every allocation line moves a positive amount
2  nothing drawn from the payment beyond the payment
3  allocated + unallocated = payment                     ← the central identity
4  lines + banked = payment-part + credit-used           ← recomputed independently
5  no obligation absorbs more than it owed
6  credit never crosses a membership, never goes negative
7  a membership-scoped payment never reaches another membership
   + re-running is byte-identical
   + applying twice never settles more than was owed
```

## Generated conformance (150 scenarios)

Each built in the **real production database**, settled by the **real
`settle_payment()`**, rolled back.

```
every allocation line agrees, to the pesewa           150/150
total allocated agrees                                150/150
credit banked agrees                                  150/150
neither implementation over-allocates the payment     150/150
a slot-scoped payment never touches a 2nd membership  150/150
```

## Concurrency — 50 simultaneous requests, one payment

```
allocation rows written    5      (not 250)
total allocated            450.00 (not 22,500)
settlement_completed log   1
transaction status         success ×1
                                          9/9 checks
```

## Live production tests

| Suite | Result |
|---|---|
| §44 multi-group acceptance | 19/19 |
| IDOR — database boundary | 8/8 |
| IDOR — live HTTP, real member sessions | 10/10 denied |
| Authentication | 11/11 |
| Admin totals vs independent recomputation | 16/16 |
| Reversal accounting | 8/8 |
| Statements | 190/190 memberships reconcile |
| Financial invariants | 12 of 13 hold (1 pre-existing data finding) |
| Failure modes | 11/11, zero financial effect |

## Not covered by automated tests

- **A real customer-initiated NaloPay payment.** Seventeen real settlements have
  run through the engine, but all were admin-recorded collections. The provider
  verification half is exercised by the conformance suites and live failure
  tests, not by a member approving a prompt.
- **Browser rendering.** Responsive behaviour was checked by inspection —
  `max-w-*` bounds, `overflow-x-auto` containers — not by a headless browser.
