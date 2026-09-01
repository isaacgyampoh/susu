# 09 — Production verification

Executed against `qaelfwtbaehdwhnxkpid` on 1 September 2026. Every figure below
was measured, not estimated.

## The twenty steps

```
 1  unit tests                    114 passed
 2  integration (conformance)     16 + 150 + 11 scenarios, all agree
 3  architecture tests            10 passed
 4  database tests                invariants 12/13, acceptance 19/19
 5  IDOR tests                    8/8 database, 10/10 live HTTP
 6  build                         PASS
 7  typecheck                     PASS
 8  migrations deployed           v41, v42 — applied, no financial change
 9  edge functions deployed       admin-members, member-change-passcode,
                                  payments-manual, admin-dashboard
10  production endpoints          verified (below)
11  authentication                11/11
12  member portal                 190/190 statements reconcile; totals verified
13  registration                  token isolation, fee integrity, idempotency
14  payment preview               same engine as settlement (savepoint + rollback)
15  NaloPay callback              unsigned payload treated as a rumour; verified
16  settlement                    50-way concurrency → one financial effect
17  duplicate webhook             10 replays → one settlement, one audit row
18  admin totals                  16/16 vs independent recomputation
19  statements                    190/190
20  financial checksum            every movement explained
```

## Endpoints, live

```
unauthenticated admin endpoint          401
forged admin bearer token               401   (rejected at the gateway)
unauthenticated member endpoint         401
member A → B's statement                404
member A → B's membership payment       404
member A → B's contribution payment     404
member A → B's payment verification     404
member A → B's bulk payment             404
member A → admin endpoints              401
capability token A → application A only 200, correct applicant
capability token, expired               410
capability token, unknown/malformed     404, identical responses
registration already paid → initiate    409
neutralised provider webhooks           410
nalo-webhook, garbage / unknown / false-success  200, nothing recorded
```

Financial effect of every denial above: **zero transactions, zero allocations,
zero settlements.**

## Financial movement, Phase 07 start → Phase 08 end

```
transactions_success_amount     538,449.00 → 544,333.00    +5,884.00
contributions_paid_amount       530,678.00 → 536,562.00    +5,884.00
contributions_amount_paid_total 305,862.50 → 311,746.50    +5,884.00
allocations_amount_total         11,353.00 →  17,237.00    +5,884.00
contributions_pending_amount    558,066.00 → 552,182.00    −5,884.00
counts.transactions                  1,925 →      1,942         +17
counts.payment_allocations             181 →        245         +64
counts.audit_log                       523 →        526          +3
```

**Every number moves by the same GHS 5,884**, in the directions that identity
requires: money received rises, obligations pending falls by exactly as much,
and the allocation ledger accounts for all of it.

### Why it moved

Seventeen real payments settled through the new engine on 1 September, between
19:05 and 21:15 — recorded by an administrator while this work was underway, not
by me. 64 days covered across multiple groups.

```
classification:  BUSINESS TRANSACTION
evidence:        17 settlement_log rows, 64 allocation rows, GHS 5,884 —
                 each payment allocating exactly what was paid, to the pesewa
```

The three audit rows are this phase's own test artefacts: one reversal record
and two refusal records (`member.delete_refused`, `members.wipe_refused`). They
are history and are deliberately not deleted — removing an audit entry to tidy a
checksum would be worse than the discrepancy it hides.

**No unexplained financial movement.**

### The cutover, visible in the data

```
settled contribution payments before 2026-09-01 14:00 UTC   36   allocations:  0  (0%)
settled contribution payments after                         17   allocations: 17  (100%)
```

That is the Phase 06 cutover, drawn by the data rather than asserted. It is also
why financial invariant 9 carries that cutoff: requiring an allocation for a
payment settled before the ledger existed would flag 36 historical rows as
defects.

## Test fixtures left nothing behind

Both live fixtures created real rows and were torn down:

```
concurrency fixture     checksum identical afterwards except audit_log +1
authorization fixture   checksum identical afterwards except audit_log +2
generated conformance   150 scenarios, each rolled back — no checksum movement at all
```

## Schema

```
migrations in version control       42
deployed database functions         32  (non-trigger)
declared in migrations              32
deployed without a migration         0
declared but absent                  5  — all explicitly DROPped by v41
unexplained drift                    0

deployed edge functions             52
in the repository                   52
either-way drift                     0
```

## Backup and recovery

```
physical backups held    8 (daily)
most recent              2026-09-01 07:48 UTC — before any Phase 07/08 change
region                   eu-west-1
PITR                     DISABLED
```

Recovery granularity is 24 hours. A mistake at noon can only be rolled back to
07:48, losing the morning's payments. Enabling PITR is a paid add-on and
therefore a business decision — but it is the reason the destructive admin paths
were gated this phase rather than merely documented.
