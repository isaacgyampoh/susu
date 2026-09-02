# 04 — Financial integrity

## The canonical flow

```
provider confirmation          NaloPay's own status endpoint, asked by us
        ↓
payment record                 transactions.reference UNIQUE — one payment
        ↓
settle_payment()               ONE transaction, SELECT … FOR UPDATE, idempotent
        ↓
payment_allocations[]          one row per day covered
        ↓
contribution update            status, amount_paid, paid_at
        ↓
membership_credit_ledger       surplus banked, per membership
        ↓
settlement_log                 what happened, appended
```

Registration fees take the parallel path — `settle_registration_fee()` — because
a registration fee settles no obligation. Both share provider verification,
idempotency, audit and transactional integrity.

## Payment → PaymentAllocation[] is the model

```
Payment P (GHS 450, reference unique at the PAYMENT level)
  ├─ Allocation → Day 1 → GHS 100
  ├─ Allocation → Day 2 → GHS 100
  ├─ Allocation → Day 3 → GHS 100
  ├─ Allocation → Day 4 → GHS 100
  └─ Allocation → Day 5 → GHS  50
```

`transactions.reference` is UNIQUE. `payment_allocations` carries
`UNIQUE(reference, contribution_id)` so one payment touches a day at most once.
The pre-v26 unique index on `contributions.paystack_ref` — which silently
rejected every day after the first in a multi-day settlement, finding F-02 — is
gone.

## Atomicity, proven at 50 concurrent requests

A GHS 450 payment against a 100/day membership with ten open days, hit by
**fifty simultaneous** `settle_payment()` calls:

```
all 50 returned the same 5 allocations

allocation rows written          5      ← not 250
total allocated                  450.00 ← not 22,500
days fully paid                  4
days part-paid                   1  (GHS 50 of 100)
settlement_completed log rows    1
settlement_started log rows      1
credit ledger entries            0
transaction status = success     1
```

Nine of nine. The lock is taken before the status is read, so a replay cannot
race the original: forty-nine callers found a completed settlement and returned
what it had done.

## Reversal is a financial event, not a status change

```
original payment → original allocations
                 → reversal: allocations STAMPED, credit OFFSET, before-state APPENDED
```

Nothing is destroyed. A reversed allocation keeps its row and gains
`reversed_at` and `reversal_reason`. Reversed credit is a **negative ledger
entry**, never an edit — the ledger stays append-only. The whole before-state
goes to `settlement_log`.

Verified on the concurrency fixture, 8/8:

```
day restored to unpaid                        allocation rows still on disk    5
allocation stamped reversed        1          payment marked failed            1
settlement_reversed logged         1          reversal audited                 1
reversed rows carry a reason       1          live allocation on an unpaid day 0
```

Before Phase 07, reversal changed `contributions.status` and left the allocation
ledger untouched — producing exactly the state financial invariant 8 exists to
detect. An operator correcting a typo would have tripped the alarm built to
catch F-02.

## Credit is per membership

`membership_credit_ledger`, keyed by membership. The global
`members.credit_balance` — where a surplus paid into one group settled another's
obligation — is no longer read anywhere. Invariant 3 fails if a ledger entry
ever crosses members; invariant 4 if a membership holds negative credit.

Proven across 3,000 generated scenarios (property invariant 6) and 150 generated
database scenarios (credit banked agrees to the pesewa).

## Invariants

Thirteen checks, `docs/phase-07/financial-invariants.sql`. Every row returned is
a violation; a clean run returns nothing. Read-only, safe to schedule.

Today: **12 hold.** One returns the seven historical registrations marked paid
with no payment record and no audit row (GHS 1,745) — a pre-existing data
finding, deliberately preserved, surfaced in the reconciliation console.

## Admin totals — recomputed from first principles

Every headline figure independently recomputed and compared
(`docs/phase-08/admin-totals-crosscheck.sql`): **16/16 match.**

Two corrections came out of writing that check:

**`outstanding` ignored `amount_paid`.** It summed `amount` over unpaid days, so
a day with GHS 75 of a GHS 100 obligation already collected reported the full
GHS 100 as still owed. GHS 25 today — but it grows with every instalment, and
instalments are a core feature. Same defect class as D-05.

**`due_today` was the gross obligation**, including days already settled. A
defensible figure, but on a dashboard it reads as "what we expect to collect
today", which it stops being the moment part of it is collected.
`remaining_today` is now published beside it, and the console shows that one.

A third apparent difference was the **cross-check being wrong**, not the
function: `get_admin_totals` deliberately excludes `type='payout'`, because
money paid out is not money collected. That exclusion is correct and stays.

## Checksum discipline

Captured before and after every migration this phase.

```
v41 (drop five functions)          no financial change
v42 (admin totals)                 no financial change
concurrency fixture (created and torn down)   audit_log +1
authorization fixture (created and torn down) audit_log +2
```

The audit rows are the reversal record and the two refusal records. They are
history and are deliberately not deleted — removing an audit entry to tidy a
checksum would be worse than the discrepancy it hides.

Every other movement this engagement traced to real business activity:
seventeen live settlements on 1 September, GHS 5,884 across 64 days, each
allocating exactly what was paid.
