# Legacy map

Classification of existing code against the new architecture. Nothing is
deleted until its replacement is verified.

**Legend** — KEEP · MIGRATE (move behind the new boundary) · REPLACE (a new
implementation exists) · DEPRECATE (still called, scheduled for removal) ·
REMOVED (done in Phase 03)

---

## Settlement — five implementations, one replacement

| implementation | allocations | `amount_paid` | credit | atomic | lock | status |
|---|---|---|---|---|---|---|
| `_shared/settle.ts settlePayment()` | yes | yes | member-scoped | **no** | **no** | **DEPRECATE** |
| `payments-verify` batch branch | **no** | no | no | no | partial | **DEPRECATE** |
| `payments-bulk` dev branch | **no** | no | no | no | no | **DEPRECATE** |
| `payments-manual` bulk update | **no** | no | no | no | yes | **DEPRECATE** |
| `record_partial_payment()` | **no** | yes | no | yes | yes | **DEPRECATE** |
| **`settle_payment()` (v28)** | **yes** | **yes** | **per-membership** | **yes** | **yes** | **REPLACE — live** |

All five remain callable. Migrating their callers is the next phase; the
replacement is deployed, conformance-tested against the pure domain allocator,
and proven idempotent under 10× replay.

## Schema-guessing fallbacks — REMOVED

All nine confirmed dead (every migration v1–v24 is applied) and deleted:

| file | fallback | note |
|---|---|---|
| `admin-add-member` | `slot_fraction` retry | removed |
| `admin-onboard-member` | `slot_fraction` retry | removed |
| `kyc-review` | `slot_fraction` retry | removed — **and the swallowed insert error that silently lost a membership is now handled with a retry-on-collision** |
| `member-join-group` | `slot_fraction` retry | removed |
| `groups-public` | `show_on_website` retry | removed |
| `payments-manual` | `payment_method`/`payment_note` retry | removed |
| `member-profile` | `get_member_plan_balance` fallback | removed — it silently swapped a per-slot balance for a per-member-and-group one |
| `admin-members` | v18 error hint | KEEP (a message, not a fallback) |
| `admin-sms-log` | "table does not exist" → empty log | removed — it turned a query failure into "no messages", which would tell an operator a member was never texted |

## Aggregation

| code | problem | replacement | status |
|---|---|---|---|
| `admin-dashboard:47-53` | unbounded `SELECT` + JS `reduce()` | `get_admin_totals()` | **REPLACE — live, caller not yet migrated** |
| `member-profile:135-136` | totals from a 50/30-row window | `get_member_portal_state()` | **REPLACE — live, caller not yet migrated** |
| `member-profile:39-64` | N+1 (6 + 2N queries) | `get_member_portal_state()` | **REPLACE — live, caller not yet migrated** |

## Constraints

| object | status |
|---|---|
| `uniq_contribution_ref` | **REMOVED** (v26) — a reference identifies a payment, never a day |
| `uniq_allocation_per_payment_day` | **NEW** (v26) — uniqueness at the correct grain |
| `members.credit_balance` | **DEPRECATE** — superseded by `membership_credit_ledger`; zero everywhere, inert |

## Presentation

| code | problem | status |
|---|---|---|
| `app/m/portal/dashboard/page.tsx` | sums money in a React `reduce`, derives rotation position | **MIGRATE** — portal phase |
| 57 native `alert`/`confirm`/`prompt` | financial flows in browser dialogs | **MIGRATE** — portal phase |
| dead colour classes (`accent-green`, `animate-slide-up`, …) | render as nothing | **MIGRATE** — portal phase |

## Provider naming

`contributions.paystack_ref`, `transactions.paystack_data`,
`payouts.paystack_transfer_ref` — **KEEP for now.** The provider is NaloPay;
these names are archaeology. They are read by several live settlement paths and
reports, and `paystack_ref` was the column at the centre of F-02. A rename gets
its own migration with its own rollback, after the callers are migrated.
