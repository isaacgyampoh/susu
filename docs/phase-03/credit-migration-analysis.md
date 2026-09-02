# Credit migration analysis

**Status: COMPLETE — and it required no migration at all.**

---

## The investigation

Before touching `members.credit_balance`, every reference to it was traced.

### Source-code references

| location | use |
|---|---|
| `_shared/settle.ts:59-65` | reads the balance, folds it into the payment |
| `_shared/settle.ts:127-134` | writes the remainder back — the read-modify-write race |
| `member-profile/index.ts:18,146` | selects it, returns it as `credit` |
| `app/m/portal/dashboard/page.tsx` | displays it |
| migration v24 | creates the column, default `0` |

### Database references

**None.** No function, trigger, view or constraint reads or writes
`credit_balance`. Confirmed against `pg_proc`, `pg_trigger` and the full
schema inventory. The column is touched only by application code.

## The production position

```
members_with_credit    0
total_credit_held      0.00
max_credit             0.00
negative_credit        0
```

**Every member holds zero credit.** The read-modify-write race described in
F-06 has therefore never actually corrupted anything — there has never been a
balance for two concurrent settlements to spend twice.

## Classification

| category | count | value |
|---|---|---|
| SAFE TO MIGRATE | 0 | GHS 0.00 |
| AMBIGUOUS | 0 | GHS 0.00 |
| REQUIRES MANUAL REVIEW | 0 | GHS 0.00 |
| ALREADY CONSUMED | 0 | GHS 0.00 |

There is no historical money to map, and therefore **no opportunity to
misattribute any**. This is the cleanest possible starting position.

## The target model, implemented

`membership_credit_ledger`, created additively by v26:

```
id · membership_id · member_id · amount · entry_type
source_reference · source_payment_id · contribution_id
note · created_by · created_at
```

Three properties that matter:

1. **Scoped to a membership, never a member.** A surplus paid into Group A can
   only ever settle Group A's obligations. The specification forbids groups
   pooling money; the old column made pooling the default behaviour.
2. **A ledger, not a mutable balance.** Balance is `SUM(amount)`. Every
   movement carries its reason and its source, and no write can overwrite a
   previous one — which is what made the read-modify-write race possible.
3. **Signed entries.** `surplus` adds, `applied` subtracts, `reconciliation`
   corrects, `adjustment` is a deliberate operator action.

Enforced by `FOREIGN KEY (membership_id) REFERENCES group_memberships(id)`, so
a credit entry cannot exist without a membership to belong to.

### Current contents

Two entries, GHS 130.00 total — the duplicate payment recovered by v27 for
SSU-0012. See `financial-reconciliation.md`.

## `members.credit_balance` — deprecation

**Not dropped.** It is still read by `settle.ts` and `member-profile`, both of
which are still live. Dropping it now would break production.

Removal plan:
1. ✅ New ledger created and in use by `settle_payment()`.
2. ⬜ Migrate `member-profile` to read the ledger (portal phase).
3. ⬜ Retire `settle.ts` once all callers use `settle_payment()`.
4. ⬜ Verify the column is unreferenced.
5. ⬜ `ALTER TABLE members DROP COLUMN credit_balance`.

Steps 2–5 are deliberately out of Phase 03 scope. The column is zero
everywhere, so it is inert until then.
