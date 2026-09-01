# Financial reconciliation — the F-02 damage

**Status: RECONCILED.** Repaired by migration `v27` on 1 September 2026, with
before/after financial verification and a full audit trail.

---

## What happened

One member, **SSU-0012 (Abigail Mensah)**, made three payments. All three
reached us — every one has `status = 'success'`, and for each the sum of its
allocation rows **exactly equals** the transaction amount. The allocator did
its arithmetic correctly and accounted for every pesewa.

| reference | amount | allocations | days actually written |
|---|---|---|---|
| `CONT-83a12989-…-1786633190831` | GHS 350.00 | 6 | 2 |
| `CONT-c471eebc-…-1787739651236` | GHS 56.00 | 2 | 1 |
| `CONT-d1a00c3b-…-1787738346459` | GHS 195.00 | 3 | 1 |

Only the first day of each payment was written. The rest raised `23505` on
`uniq_contribution_ref`, and `settle.ts` discarded the error — while still
decrementing its running total and writing the allocation row.

### The defect compounded

Because 2026-08-04 and 2026-08-05 stayed `pending`, the member was billed for
them **again** and paid **again** on 26 August:

| due date | cost | amount_paid | allocations | allocated | over |
|---|---|---|---|---|---|
| 2026-08-04 | 65.00 | 0.00 | **2 payments** | 130.00 | **+65.00** |
| 2026-08-05 | 65.00 | 0.00 | **2 payments** | 130.00 | **+65.00** |
| 2026-08-06 | 65.00 | 0.00 | 1 | 65.00 | 0 |
| 2026-08-07 | 65.00 | 25.00 | 1 | 25.00 | genuine partial |
| 2026-08-08 | 28.00 | 0.00 | 1 | 28.00 | 0 |

F-02 does not merely lose a settlement. It causes the member to pay twice.

---

## Why the repair was safe to automate

Three conditions had to hold before a day was credited, all verifiable from
data, none requiring judgement:

1. the contribution was not `paid`;
2. the allocations against it summed to **at least** its full cost including
   penalty;
3. **every** source transaction was `status = 'success'` — the money is proven
   to have arrived.

Only four contributions met all three. The GHS 25 partial on 2026-08-07 was
deliberately excluded: `amount_paid` already equals its allocation, so that row
was always correct. (The partial path writes `amount_paid` without touching
`paystack_ref`, so it never hit the unique index.)

## What v27 did

- **Credited 4 days**, GHS 223.00 of obligation.
- **Booked GHS 130.00 to `membership_credit_ledger`** as `entry_type =
  'reconciliation'`, scoped to the membership it was paid into, with a note
  naming the cause. The duplicate payment is real money and is neither lost nor
  silently absorbed.
- **Wrote 4 `audit_log` rows**, one per contribution, recording the reason,
  the amounts, and the source references.
- **Backfilled** `payment_allocations.membership_id` and `.due_date`, which
  `settle.ts` never wrote — so an allocation can now be joined back to a slot.
- **Deleted nothing.**

## Verification

| figure | before | after | Δ |
|---|---|---|---|
| contributions_paid_amount | 530,260.00 | 530,483.00 | **+223.00** |
| contributions_pending_amount | 558,484.00 | 558,261.00 | **−223.00** |
| contributions_amount_paid_total | 305,639.50 | 305,862.50 | +223.00 |
| audit_log rows | 519 | 523 | +4 |
| every other count and total | — | — | **unchanged** |

Money is **conserved**: the same GHS 223.00 moved from pending to paid.
Nothing was created or destroyed. Content hashes over `transactions`,
`payouts`, `memberships` and `allocations` are byte-identical before and after.

Post-repair, exactly **one** allocation remains against an unpaid day: the
genuine GHS 25 partial, which is correct.

## Residual

The GHS 130 credit sits in `membership_credit_ledger` and will be consumed by
`settle_payment()` on SSU-0012's next payment into that membership. No action
required, but the operator may wish to tell her.
