# Membership flow

```
Member ──< Membership >── Group
             │
             ├── contribution obligations (one row per period)
             ├── payment allocations
             ├── membership credit ledger
             └── payout
```

A **Membership is a slot**, not a group. One person may hold several slots in
one group, each with its own payout position, schedule and money. There is no
`member.group_id` anywhere in the schema or the code — the types make the wrong
model unrepresentable.

## Production reality

| groups held | members |
|---|---|
| 1 | 20 |
| 2 | 18 |
| 3 | 9 |
| 4 | 6 |
| 5 | 2 |
| 9 | 1 |
| **18** | **1** |

Two thirds hold more than one. 20 members hold multiple slots in a single
group; one holds six. Multi-group is the normal case, not an edge case.

## The portal

`get_member_portal_state(member_id, as_of)` returns every active membership
with its own complete financial position, in **one query**. Verified live: the
member holding 30 memberships across 18 groups gets all 30 in a single call —
previously 66 round trips.

Each membership carries its own: due today, paid today, paid so far, still to
pay, overdue, paid in advance, days covered ahead, advance credit, next
obligation with remaining, payout date, payout amount, coverage state.

Coverage vocabulary, decided server-side:
`paid` · `paid-today` · `paid-in-advance` · `partially-covered` · `due-today` ·
`overdue` · `upcoming` · `no-schedule`

## Isolation

Enforced at three levels:

1. `membership_credit_ledger.membership_id` is a foreign key — credit cannot
   exist without a membership to belong to.
2. `settle_payment()` only ever spends a membership's own credit on its own
   obligations.
3. `p_scope='slot'` is honoured in SQL.

Tested in the domain suite (five-membership isolation), in the conformance
suite, and against live production via the IDOR tests.

## Payout

`group_memberships.payout_amount` is **authoritative** where set; the group
cashout is only a default. This is not a bug: 62 of 65 differing values come
from onboarding real historical amounts for pre-system members, and **24 have
already been paid at that figure**.

A membership with no payout date shows *"Not set — ask your collector"*. The
system never fabricates a financial date.

## Not-yet-started memberships

37 active memberships have no schedule because their group has never been
activated. That is correct behaviour — schedules are generated at activation —
and the portal shows them as `no-schedule` rather than as an error.
