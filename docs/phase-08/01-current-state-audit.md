# Phase 08 — current-state audit

Read-only. Nothing in this document was changed while producing it.
Production: `qaelfwtbaehdwhnxkpid`, PostgreSQL 17.6, 52 edge functions, 40 migrations.

---

## 1. What is already migrated

| Area | State | Evidence |
|---|---|---|
| Allocation engine | one, canonical | `settle_payment()`; 16-case conformance suite against the pure allocator |
| Registration settlement | atomic, in SQL | `settle_registration_fee()`; 10-case conformance suite |
| Reversal | atomic, history-preserving | `reverse_contribution_payment()` (v38) |
| Credit | per membership | `membership_credit_ledger`; `members.credit_balance` no longer read |
| Payment → allocations | correct | `transactions.reference` UNIQUE; `payment_allocations` many-per-payment |
| Statements | reconcile | 190/190 memberships |
| Portal / totals | database-side | `get_member_portal_state()`, `get_admin_totals()` — one RPC each |
| Repo ↔ deployment | in agreement | 52 deployed, 52 in repo, 0 either way |
| DB functions ↔ migrations | in agreement | 37 deployed, 37 declared, 0 drift |
| `search_path` | pinned everywhere | 32/32 SECURITY DEFINER |
| anon RPC | none | 0 non-trigger functions executable by `anon` |
| Runtime schema guessing | removed | enforced by `src/architecture.test.ts` repo-wide |

## 2. What is still legacy — and dangerous

### 2.1 `record_partial_payment()` — a live settlement engine with no callers

Deployed, `SECURITY DEFINER`, and it mutates money:

```
UPDATE contributions SET amount_paid = …, status = 'paid', paid_at = NOW()
```

It takes **no row lock** (`SELECT * INTO` without `FOR UPDATE`), writes **no
allocation row**, has **no idempotency**, writes **no settlement log** and
**no audit record**. Two concurrent calls both read the same `amount_paid` and
both add to it.

`payments-manual` names it only in a comment explaining that it was replaced.
Grep for real call sites: **zero**, in code, in triggers, and in other database
functions. It is a loaded gun with nobody's finger on it.

**Classification: obsolete financial writer. Must go.**

### 2.2 Four more functions with zero callers

| Function | Mutates money? | Why it is a problem |
|---|---|---|
| `get_member_plan_balance` | no | second definition of "total paid" — counts `SUM(amount) WHERE status='paid'` and ignores `amount_paid`, so it disagrees with `get_member_statement` on every part-paid day |
| `get_membership_balance` | no | same, keyed by membership |
| `revoke_admin_sessions` | no | superseded by `token_version` |
| `revoke_member_sessions` | yes (`members`) | superseded by `token_version` and the `trg_revoke_on_suspend` trigger |

None is called from code, from a trigger, or from another function.

### 2.3 `admin-members` can destroy the entire financial history

Two paths, both reachable by the single `super_admin` over HTTP:

```
POST { confirm: 'DELETE ALL MEMBERS' }
   → DELETE FROM transactions, contributions, payouts, group_memberships, members
     (everything, unconditionally)

DELETE one member
   → DELETE that member's transactions, contributions, payouts
```

There is no export, no soft delete, no snapshot, and **point-in-time recovery is
disabled** — so the recovery floor is the last daily backup. Today that would
cost every payment taken since 07:48 UTC.

§29 permits dropping financial history only with "an explicit, reviewed
preservation strategy". There is none.

**Classification: financially dangerous. Must be gated.**

## 3. What is duplicated

| Duplicate | Canonical | Note |
|---|---|---|
| `get_member_plan_balance` / `get_membership_balance` | `get_member_statement`, `get_member_portal_state` | the two disagree about part-paid days |
| `record_partial_payment` | `settle_payment(p_target_contributions => …)` | directed settlement, done properly |

No duplicate *active* engine remains: every settlement path in the repository
routes to `settle_payment()` or `settle_registration_fee()`, and
`src/architecture.test.ts` fails the build if a new one appears.

## 4. Still security-sensitive

| Item | State |
|---|---|
| **`service_role` key published in git history** | **STILL LIVE — proven by request on 1 Sep. ROTATION REQUIRED (human).** |
| Default admin password | still valid; console now redirects to `/admin/password` until changed |
| PAT | working; **ROTATION REQUIRED** (human) |
| Project JWT secret | **NOT VERIFIED** |
| Application `JWT_SECRET` | rotated Phase 05, 96 chars |
| Login lockout | 5 failures / 15 min, both admin and member — verified in `check_login_allowed()` |
| Passcodes | bcrypt; generated with `crypto.getRandomValues` + rejection sampling |
| Capability tokens | 256-bit, SHA-256 at rest, 14-day expiry, single-application scope |
| Arbitrary SQL RPC | none — no `exec_sql` exists or will be created |

## 5. Still financially dangerous

1. `record_partial_payment()` — §2.1
2. `admin-members` destructive paths — §2.3
3. PITR disabled — 24-hour recovery granularity (business decision: paid add-on)

## 6. Old schemas

None. Every runtime schema fallback was removed in Phase 07 and the architecture
suite enforces it across `src/` **and** `supabase/functions/`.

## 7. Bypassing the canonical engine

Nothing in the repository. Verified by regex across all 52 functions for
`from('contributions').update({ status: 'paid' })` and equivalents — the only
match is `admin-onboard-member`, which **inserts** historical rows an operator
states and settles nothing.

At the database level, `record_partial_payment()` bypasses it (§2.1) but has no
caller.

## 8. Missing from the member portal

`get_member_portal_state()` already returns, per membership: group name, status,
contribution amount, remaining today, paid today, advance credit, arrears, next
obligation, cash-out date, expected payout, and progress.

Gap against §8: `totals` carries `due_today` (remaining) but **not** the gross
obligation for today and **not** the total paid today, so the member cannot see

```
Total due today  /  Total paid today  /  Total remaining today
```

as three separate figures.

## 9. Missing from registration

Nothing structural. Public payment, token capability, gating, short-payment
refusal and the admin queue all shipped in Phase 07.

Data-level, unresolved and deliberately preserved:

```
13 approved registrations with an unpaid fee     GHS  1,320.50
 7 marked paid with no payment and no audit row  GHS  1,745.00
```

## 10. Missing from administration

- Reconciliation console and registration queue exist but are **not yet
  deployed to Vercel** — 83 files uncommitted, and the frontend ships on push.
- Two endpoints now require a reason (`mark_fee_paid`, `admin-undo-payment`);
  their console screens are written but unshipped, so those buttons currently
  refuse until the frontend lands.

## 11. Repository hygiene

| Finding | Detail |
|---|---|
| `scripts/` does not exist | `src/domain/contribution/conformance.test.ts` documents `node scripts/capture-conformance.mjs` for regenerating its fixture. The directory is absent, so the documented procedure cannot be run. |
| `.env.local.example` incomplete | missing `PUBLIC_SITE_URL` / `WEB_URL`, added in Phase 07 for registration payment links |
| 83 uncommitted files | all of Phases 05–07 |
| `tests/` empty | tests live under `src/**`, which is correct; the empty directory is noise |

## 12. Not changed, and why

```
Allocation ordering       LEGACY_SLOT_FIRST      business decision
Payout overrides          membership-level wins  business decision
Provider                  NaloPay                business decision
402 pending payments      untouched              only provider evidence may settle them
13 unpaid registrations   untouched              business decision
 7 paid-without-evidence  untouched              reversing would guess at payment status
Historical amount_paid=0  untouched              pre-cutover rows; attribution cannot be reconstructed
```
