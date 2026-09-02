# Phase 10 — reconciliation report

Every classification below rests on evidence. Nothing was inferred from age,
and no provider confirmation was fabricated.

## The 402 pending payments — every one asked of NaloPay

All 402 were queried against NaloPay's status endpoint through the existing
adapter. Read-only: the classification pass settles nothing.

```
CONFIRMED_FAILED           78    GHS  9,412.00   NaloPay says the payment failed
NEVER_REACHED_PROVIDER     38    GHS  4,468.00   no provider reference — the prompt was never sent
STILL_PENDING             286    GHS 26,778.00   NaloPay still reports pending
CONFIRMED_SUCCESS           0    GHS      0.00
                          ───    ───────────
                          402    GHS 40,658.00
```

**Zero confirmed successes.** This is the finding that matters: not one of the
402 represents money that reached the business and was never credited to a
member. The GHS 40,658 was never a reconciliation liability — it is 402
abandoned or failed attempts.

### What was reconciled

The 78 NaloPay confirms as failed were re-asked individually through the
canonical `refresh` action — so each was confirmed twice, by the provider, not
by me — and marked failed. Audited, one row each.

```
transactions_pending_amount   40,658.00 → 31,246.00   (−9,412.00)
audit_log                          +78
contributions_paid_amount      UNCHANGED
payment_allocations            UNCHANGED
transactions_success_amount    UNCHANGED
```

No money was created, moved or destroyed. Only the honest status of 78 attempts
the provider says failed.

### What was left alone

**286 STILL_PENDING (GHS 26,778).** NaloPay reports these as pending, 10–42 days
on. They are almost certainly abandoned — but "almost certainly" is not
evidence, and NaloPay has not said failed. They stay pending and stay visible.
Marking them failed on age would be exactly the fabrication this phase forbids.

**38 NEVER_REACHED_PROVIDER (GHS 4,468).** No `provider_order_id`, so the prompt
never left this system and no money can have moved. 34 are registration fees, 4
are contributions, 3 are `TEST-` rows from provider self-tests. Safe to close,
but closing them is an operator's call — the console offers it with a reason.

## The 13 unpaid registrations — all provably unpaid

```
CONFIRMED_UNPAID (no payment ever attempted)   13    GHS 1,320.50
```

Not one has a registration_fee transaction of any kind. There is no provider
ambiguity: no payment was ever started.

The exposure is far smaller than the headline:

```
SSU-0033   GHS 602.00   active, 5 memberships, GHS 1,232 contributed
the other 12            0 active memberships, GHS 0 contributed
                        (6 suspended, 3 with no member record at all)
```

One active contributing member owes GHS 602. The remaining twelve are dormant,
suspended, or never became members. **REQUIRES BUSINESS DECISION** — collect,
waive, or suspend. Nothing was activated, deleted, or marked paid.

## The 7 marked paid without evidence — REQUIRES HUMAN RECONCILIATION

```
GHS 915  rejected application, no member, groups deleted
GHS 306  approved, no member,   groups deleted
GHS 204  approved, no member,   groups deleted
GHS 110  SSU-0012 active,       groups deleted, 4 unsuccessful attempts
GHS 102  SSU-0037 active,       groups deleted, 2 unsuccessful attempts
GHS  85  SSU-0040 active,       groups deleted
GHS  23  SSU-0071 suspended,    groups still exist
                                                        total GHS 1,745.00
```

All seven date from 19–21 July, before payment recording was audited. Six point
at groups since deleted, so the surrounding evidence is gone with them. None has
an audit entry.

Nothing here can be proven either way, so nothing was changed. No reconciliation
flag was written either: `get_reconciliation_queue()` already surfaces them as a
distinct population, and setting `fee_resolution` would make them read as
resolved when they are not.

The path that created them is closed — `mark_fee_paid` now writes the
transaction and audit row first, and invariant 12 fails if it recurs.

## Payout data — untouched

```
membership-level overrides differing from group default   84   intact
overrides clobbered to the group default                   0
historical PAID payouts                            75 / GHS 376,044.00
payouts hash, Phase 07 start → now                        UNCHANGED
cash-out dates set                                       192
payouts marked paid with a null or zero amount             0
```

## Historical attribution

Unchanged and unguessed. 36 contribution payments settled before the allocation
ledger existed (pre-14:00 UTC, 1 September) carry `amount_paid = 0` on their
days. That was not backfilled: reconstructing which cedi covered which day
cannot be done from the data, and the statement reports
`attribution_complete: false` for those periods rather than inventing precision.
