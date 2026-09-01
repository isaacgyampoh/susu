# 05 — Member portal

## The model, all the way down

```
Member  →  Membership[]  →  Group
```

Never `Member → Group`. Production's largest member holds **30 active
memberships** across 2,421 obligations, and every one is financially
independent.

## Bounded round trips

One RPC per screen, whatever a member holds. `get_member_portal_state()` and
`get_member_statement()` aggregate in the database; the browser sums nothing.

| memberships | obligation rows | portal | statement | statement per membership |
|---|---|---|---|---|
| 1 | 60 | 7.7 ms | 9.5 ms | 9.50 |
| 5 | 300 | 5.1 ms | 10.7 ms | 2.14 |
| 18 | 1,080 | 8.3 ms | 23.8 ms | 1.32 |
| 30 | 1,800 | 10.1 ms | 37.4 ms | 1.25 |
| 50 | 3,000 | 15.5 ms | 64.7 ms | 1.29 |

Per-membership cost is flat. The real 30-membership member measures 18.6 ms
(portal) and 41 ms (12-month statement), consistent with the synthetic run.

An earlier version of this test reported 808 ms at 50 memberships. That was the
test, not the query: the synthetic rows had no statistics, so the planner chose
nested loops it would never choose in production. `ANALYZE` was added.

## Today, in three figures

`due_today` has always meant what *remains*. A member holding several groups
cannot work out what they owed and what they have paid from what is left, so all
three are now published:

```
obligation_today  −  paid_today  =  remaining_today
      1,686.00         210.00         1,476.00
```

Verified against the real 30-membership member. `due_today` survives as a
deprecated alias so existing callers keep working.

## Per membership

`get_member_portal_state()` returns, for each:

```
group_name          status              contribution_amount   frequency
due_today           paid_today          overdue (arrears)     advance_credit
days_covered_ahead  paid_in_advance     next_obligation       payment_deadline
payout_date         payout_amount       payout_received       payout_position
obligations         obligations_settled total_expected        total_outstanding
total_paid          slot_fraction       coverage
```

Each membership is rendered as its own card with its own state. No membership is
hidden behind a tab.

## Advance payment is explained, not summarised

A GHS 450 payment on a GHS 100/day plan does not display as "Paid: GHS 450".
The pay sheet renders the engine's own preview, day by day:

```
Today      GHS 100 covered
Tomorrow   GHS 100 covered
Day 3      GHS 100 covered
Day 4      GHS 100 covered
Day 5      GHS  50 covered      GHS 50 still to go
```

That preview comes from `preview_settlement()`, which runs the **real**
settlement inside a savepoint and rolls it back — so the preview and the
settlement are the same code, not two implementations that might drift.

## Credit says what it is and whose it is

```
GHS 50 credit on this group.
It goes towards this group's contributions only.
```

Credit lives in `membership_credit_ledger`, keyed by membership. A surplus paid
into Group A can never settle Group B — proven by property invariant 6 across
3,000 scenarios, by 150 generated database scenarios, and by financial
invariant 3.

## Cash-out is never fabricated

```
Cash-out date      the membership's payout_date, or "Not yet assigned"
Payout amount      the membership override where one exists, else the group's
                   configured cash-out, or "Not yet set"
```

The §44 acceptance suite asserts that an unscheduled membership reports `NULL`
for the date rather than inventing one, and that the amount is the group's
configured figure rather than `daily × days`.

## Statements

```
opening  +  fell due  −  settled  −  covered in advance  =  closing
```

Stated on the page, not summarised. **190/190 memberships across all active
members reconcile.** Where payment attribution cannot be proven — anything
before the allocation ledger began — the statement reports
`attribution_complete: false` rather than inventing history.

## Payment history

Complete, database-derived, no `LIMIT 50` on a financial summary. Totals and
counts are unpaginated even where the row listing is paged.

## Responsive

Wide tables scroll inside their own `overflow-x-auto` container, so the page
body never scrolls sideways. The new pages use `max-w-*` bounds that shrink
freely rather than fixed widths.
