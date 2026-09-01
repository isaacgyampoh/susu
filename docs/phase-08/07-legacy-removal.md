# 07 — Legacy removal

## Removed this phase (v41)

| Function | Purpose | Replacement | Safe to delete? | Reason |
|---|---|---|---|---|
| `record_partial_payment(uuid,numeric,text,text)` | settle an instalment against one obligation | `settle_payment(p_target_contributions => …)` | **yes** | zero callers — not in code, triggers, other functions, views or column defaults. `payments-manual` named it only in a comment explaining it had been replaced. |
| `get_member_plan_balance(uuid,uuid)` | "total paid" per member per group | `get_member_statement`, `get_member_portal_state` | **yes** | zero callers, and it *disagreed*: `SUM(amount) WHERE status='paid'` ignores `amount_paid`, so it reported zero for every part-paid day |
| `get_membership_balance(uuid)` | the same, keyed by membership | as above | **yes** | zero callers, same disagreement |
| `revoke_admin_sessions(uuid)` | invalidate an admin's sessions | `token_version` | **yes** | zero callers; superseded |
| `revoke_member_sessions(uuid)` | invalidate a member's sessions | `token_version` + `trg_revoke_on_suspend` | **yes** | zero callers; superseded |

### Why `record_partial_payment` mattered most

It was a **settlement engine**, deployed and `SECURITY DEFINER`:

```sql
UPDATE contributions
   SET amount_paid = LEAST(amount, COALESCE(amount_paid,0) + p_amount),
       status = CASE WHEN … THEN 'paid' ELSE status END,
       paid_at = …
```

with **no row lock** (`SELECT * INTO`, never `FOR UPDATE` — two concurrent calls
read the same `amount_paid` and both add to it), **no allocation row**, **no
idempotency**, **no settlement log** and **no audit record**.

Dead financial code is one `rpc()` call away from live financial code. A
deployed function that mutates money and answers to nobody is a liability
whether or not anything calls it today.

## Removed in Phase 07, confirmed still gone

| Item | Was | Now |
|---|---|---|
| `moolre-webhook` | ACTIVE, `verify_jwt=false`, wrote `contributions.status='paid'` directly, **absent from the repository** | 410 stub, in git |
| `payments-webhook` | the same, and it settled on a `charge.success` in the **request body** with no provider call — finding F-04 on a different URL | 410 stub, in git |
| `admin-reconcile-payments` | a second settlement engine behind an unconditional `return` | emptied to a 410 |
| `admin-repair-forced` | blanket batch `UPDATE`, direct `status='paid'` | emptied to a 410 |
| `admin-repair-overpayments` | wrote contribution and credit state outside the engine | emptied to a 410 |
| `get_member_statement(uuid)` | a second statement implementation ignoring `amount_paid` | dropped (v38) |
| `get_reconciliation_queue()` | ambiguous overload | dropped (v40) |
| 5 runtime schema fallbacks | query → regex the error message → drop a column → retry | removed; enforced repo-wide by a test |

## Retained, restricted, and why

| Item | Why it stays | How it is restricted |
|---|---|---|
| `admin-members` mass wipe | resets a fresh instance | refuses while any settled payment or paid day exists; refusal audited |
| `admin-members` single delete | removes duplicates and mistyped entries | refuses when the member has settled payments, paid days **or** paid payouts; refusal audited |
| `forfeit_membership` | a real business operation | admin-only, audited |
| `activate_group` | the one canonical activation | admin-only; requires a cash-out amount before a group may open (`trg_require_cashout`) |
| the five 410 stubs | a bookmark or stale build gets a clear answer, not a 404 that looks like a broken deploy | they do nothing at all |

## Verification

```
deployed edge functions            52
in the repository                  52
deployed but absent from the repo   0
in the repo but not deployed        0

deployed database functions        32  (non-trigger)
declared in migrations             32
deployed without a migration        0
declared but absent                 5  — all five explicitly DROPped by v41
unexplained drift                   0
```

Direct financial writes outside the engine, across all 52 functions: **one**,
`admin-onboard-member`, which *inserts* historical rows an operator states and
settles nothing. It is the single documented exception in the architecture test.
