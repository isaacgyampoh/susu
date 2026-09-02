# Payment flow

Where every business rule lives, and what happens to a member's money.

```
MEMBER TAPS PAY
      │
      ▼
components/susu/pay-sheet.tsx            presentation only, no arithmetic
      │  amount, membership, "this group only"
      ▼
payments-preview            ─────────►   preview_payment_for_membership()
      │  authorizes membership vs session      │
      │                                        ├─ constructs the payment
      │                                        ├─ runs the REAL settle_payment()
      │  ◄─── what it will cover ──────────────┤  in a savepoint
      │                                        └─ ROLLS BACK
      ▼
payments-initialize                      resolves membership → oldest unsettled day
      │  records transaction as PENDING
      ▼
infrastructure: NaloPay                  prompt to the member's phone
      │
      ├──────────────┬──────────────────┐
      ▼              ▼                  ▼
payments-verify   nalo-webhook    cron-settle-pending
  (app polls)    (unsigned!)       (every 10 min, 48h)
      │              │                  │
      │              └─ asks NaloPay ───┤   NO provider confirmation → NO settlement
      │                                 │
      └─────────────┬───────────────────┘
                    ▼
            settle_payment()             THE FINANCIAL AUTHORITY
                    │
                    ├─ FOR UPDATE on the payment    ← serialises concurrent callers
                    ├─ status check inside the lock ← idempotency
                    ├─ FOR UPDATE on obligations
                    ├─ applies membership credit first
                    ├─ allocates by policy (or a directed list)
                    ├─ writes payment_allocations   ← the audit ledger
                    ├─ updates contributions
                    ├─ banks surplus as membership credit
                    ├─ marks the transaction success
                    └─ writes settlement_log
                    │
              COMMIT or ROLLBACK — never half
```

## Guarantees, and what provides them

| guarantee | mechanism |
|---|---|
| atomicity | one plpgsql function, one transaction |
| no double allocation | `SELECT … FOR UPDATE` on payment and obligations |
| webhook idempotency | status check inside the lock + `UNIQUE(reference, contribution_id)` |
| preview cannot diverge | it *is* the settlement, executed and rolled back |
| no client authority | server resolves membership, obligations and allocation |
| short payment safe | engine applies `LEAST(provider_amount, recorded_amount)` |
| forged callback safe | settlement requires the provider's own status endpoint |

## Allocation policy

**`LEGACY_SLOT_FIRST`** — preserved from production, unchanged.

1. the membership the payment was made against, oldest due date first,
   **including future days**
2. then the member's other memberships, oldest due date first

This is *not* arrears-first. A future day in the paid slot settles before
another slot's overdue day. `settle.ts` used to claim the opposite in its
header comment while implementing this; production is the authority, and the
comment was wrong.

Switching to `ARREARS_FIRST` moves real balances and is a business decision.
Both policies are defined and tested in `src/domain/contribution/policy.ts`;
neither is marked canonical in code.

`p_scope = 'slot'` honours the member's "pay this group only" choice and is
enforced in SQL, not in the client.

## Directed settlement

Manual admin collection asserts *which specific days* were paid in cash. The
engine accepts `p_target_contributions` so the caller decides the set, while
keeping the same locking, ledger, atomicity and audit. Without this, an admin
ticking days 5, 7 and 9 would find days 1, 2 and 3 settled.

## Where to change a rule

| rule | file |
|---|---|
| allocation ordering | `src/domain/contribution/policy.ts` |
| allocation arithmetic | `src/domain/contribution/allocation.ts` (pure) + `settle_payment()` |
| money representation | `src/domain/shared/money.ts` |
| obligation status / coverage | `src/domain/contribution/types.ts` |
| provider specifics | `src/infrastructure/payments/nalopay/` + `_shared/nalo.ts` |
| authorization | the use case, and each Edge Function's session check |

The pure allocator and `settle_payment()` are bound by
`src/domain/contribution/conformance.test.ts` — 16 tests over 13 scenarios. If
they diverge, the build fails.
