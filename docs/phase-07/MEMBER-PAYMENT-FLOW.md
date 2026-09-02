# Member payment — the flow

```
MEMBER  /m/portal/dashboard
   │        all memberships, grouped by what needs paying
   ▼
SELECT A MEMBERSHIP                 not a contribution — the server resolves the day
   │
   ▼  payments-preview → preview_settlement()
SEE WHAT THE MONEY WILL COVER       the REAL engine, run in a savepoint and rolled back
   │
   ▼  payments-initialize
NALOPAY PROMPT                      transaction written first; scope travels on it
   │
   ▼  payments-verify → NaloPay collection-status
PROVIDER CONFIRMS
   │
   ▼  settle_payment()              ONE transaction, SELECT … FOR UPDATE, idempotent
ALLOCATION                          one row per day covered
   │
   ▼
PORTAL / STATEMENT REFRESH
```

## The payment is attached to a membership, never inferred

The browser sends `membership_id`. The server checks it belongs to the caller,
then resolves the oldest unsettled day itself. A member holding five groups
never has their money guessed at from `member_id` alone.

`this_group_only` travels **on the transaction**, not in the request that
settles it — settlement happens later, in a callback or the sweeper, long after
that request is gone.

## Advance payment, shown rather than summarised

GHS 450 into a GHS 100/day group does not display as "Paid: GHS 450". The pay
sheet renders the engine's own preview:

```
Today      GHS 100 covered
Tomorrow   GHS 100 covered
Day 3      GHS 100 covered
Day 4      GHS 100 covered
Day 5      GHS  50 covered      GHS 50 still to go
```

## Credit is membership-scoped, and says so

```
GHS 50 credit on this group.
It goes towards this group's contributions only.
```

Credit lives in `membership_credit_ledger`, keyed by membership. The old global
`members.credit_balance` — where a surplus paid into one group settled
another's obligation — is gone. Invariant 3 fails if a ledger entry ever crosses
members.

## Verified on real money

Thirteen live settlements, 1 September 2026, GHS 4,966 across 55 days:

- every payment allocated **exactly** what was paid, to the pesewa
- GHS 510 spread across five groups; GHS 770 clearing ten days in one
- zero duplicate allocations, zero wrong memberships, zero orphaned days
- 190/190 memberships still reconcile

## Regression, run against production and rolled back

`docs/phase-07/acceptance-multi-group.sql` — 19 assertions. A member in five
groups pays GHS 450 into Group A:

```
A:  100 / 100 / 100 / 100 / 50 covered
B, C, D, E:  paid total 0.00, days paid 0, allocations received 0
```

Then GHS 50 completes day five; then GHS 20 into Group C leaves A untouched.
Statement reconciles for all five. Cash-out date reports `NULL` — "not yet
assigned" — rather than a fabricated one.
