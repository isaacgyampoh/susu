# Reconciliation — how to work the queue

`/admin/reconciliation`. Three populations, none of which the system can resolve
on its own.

```
402 payments pending over 48 hours     GHS 40,658.00
 13 approved registrations, fee unpaid GHS  1,320.50
  7 marked paid, no payment record     GHS  1,745.00
```

## There is no "mark successful"

It is the obvious button and the one that must not exist. A console cannot know
whether money moved. A button asserting that it did would manufacture a
financial fact that then flows into every total, statement and payout in the
system.

**Refresh** is the safe equivalent: it re-asks NaloPay and settles *only* if
NaloPay confirms — through `settle_payment()`, the same engine a webhook uses,
so it cannot produce a different answer from one. An operator can therefore
clear a genuinely completed payment, and cannot clear one that never completed.

Refresh is offered only where NaloPay can actually be asked. A payment with no
`provider_order_id` never reached NaloPay; the row says **"Never reached
NaloPay"** and offers no refresh, because there is nothing to ask about.

## Stuck payments — the actions

| Action | What it does | Moves money? |
|---|---|---|
| **Refresh** | asks NaloPay; settles, fails, or leaves pending on its answer | only if the provider confirms |
| **Abandon** | records that the payment is not expected to arrive | no — stops it counting as money in flight |
| **Note** | writes to the audit log | no |
| **Reviewed / Escalate** | records that a person looked | no |

`abandoned` marks the transaction `failed`. It settles no contribution and
asserts nothing about the provider — it says only that we have stopped waiting.

## Registrations with an unpaid fee — the actions

| Action | What it does | Creates a payment? |
|---|---|---|
| **Fee received** | records money actually taken, in cash or by transfer | **yes** — a real `success` transaction for the full fee |
| **Pursuing** | records that it is being collected | no |
| **Waive** | records a decision not to collect | no — the fee stays unpaid |
| **Suspend** | sets the member `suspended` | no |
| **Escalate / Note** | audit trail only | no |

Waiving is not paying. `registration_fee_paid` is left alone by every action
except *Fee received*, so documenting a decision can never masquerade as money
arriving.

Every action needs a reason of at least ten characters, stored in `audit_log`
with the administrator's name and the timestamp.

## Marked paid with no record — the seven

Seven applications say the fee was received but have no successful payment
anywhere and no audit entry. All from 19–21 July 2026, before payment recording
was audited. Six of the seven point at groups since deleted.

**Nothing has been changed, and nothing should be changed automatically.**
Reversing a fee flag on a live member because a record is missing would be
guessing at payment status — whoever took the cash may simply remember it. The
console offers one action: *Record what happened*, which writes the missing
audit entry and touches no money.

Invariant 12 fails while any remain, deliberately. It is a to-do list, not a
bug.

## Running the invariants

```bash
cat docs/phase-07/financial-invariants.sql | <your psql>
```

Every row returned is a violation; a clean run returns nothing. Read-only, safe
to schedule. Thirteen checks; today, twelve hold and `registration_paid_without_payment`
returns the seven above.

## Checking the books

```bash
cat docs/phase-03/financial-checksum.sql   | <your psql>   # money, counts, hashes
cat docs/phase-07/acceptance-multi-group.sql | <your psql> # 19 assertions, rolls back
cat docs/phase-07/idor.sql                 | <your psql>   # 8 checks, read-only
cat docs/phase-07/performance.sql          | <your psql>   # scaling, rolls back
```

A checksum difference is not automatically your deployment. Classify it:
*migration*, *business transaction*, *expected operational change*, or
*unexpected mutation*. On 1 September the checksum moved by GHS 4,966 mid-phase;
it was thirteen real payments an admin recorded, not the migrations.
