# Production cutover plan

Resolving the split between a migrated database and un-migrated edge functions.

**Current state:** every database migration (v25–v32) is applied and live.
Production edge functions still execute the pre-Phase-03 code. So the correct
settlement engine exists and is authoritative *when called* — but nothing in
production calls it yet.

---

## 1. Functions being deployed

**21 changed + 1 new = 22 deployments.** Two shared modules (`_shared/jwt.ts`,
`_shared/settle.ts`, `_shared/passcode.ts`) are bundled into every function
that imports them, so their consumers must all redeploy.

### Financial — highest risk, deploy and verify first
| function | change |
|---|---|
| `_shared/settle.ts` | now calls `settle_payment()`; algorithm removed |
| `payments-verify` | canonical engine; batch branch removed; `lastSpread` leak removed |
| `nalo-webhook` | **F-04 fix** — no longer trusts the callback body; verifies amount |
| `cron-settle-pending` | canonical engine; batch branch removed |
| `payments-manual` | directed settlement; writes allocations |
| `payments-bulk` | dev branch → canonical engine |
| `payments-initialize` | accepts `membership_id`; dev branch → canonical engine |
| `payments-preview` | **NEW** — server-side preview |

### Portal / admin
| function | change |
|---|---|
| `member-profile` | one-query projection; N+1 and 50-row truncation removed |
| `admin-dashboard` | database aggregation (**D-05**) + anomaly counts |

### Security (Phase 00/03)
`_shared/jwt.ts` (fail-closed secret), `_shared/passcode.ts` (**new** — CSPRNG +
no plaintext fallback), `admin-add-member`, `admin-onboard-member`,
`admin-send-invites`, `admin-members`, `kyc-review`, `member-change-passcode`.

### Disabled (return 410)
`admin-reconcile-payments`, `admin-repair-forced`, `admin-repair-overpayments`,
`admin-restore-reversals` — all moved money outside the canonical engine.

### Cleanup
`groups-public`, `admin-sms-log`, `member-join-group` — dead schema fallbacks removed.

---

## 2. Migrations already deployed

| | | verified |
|---|---|---|
| v25 | function grant lockdown | 0 functions reachable by `anon` |
| v26 | payment reference model, credit ledger, 9 indexes | constraint swapped, ledger present |
| v27 | F-02 reconciliation | 4 days credited, GHS 130 to ledger |
| v28 | transactional settlement | superseded by v32 |
| v29 | portal + admin aggregates | both present |
| v30 | `preview_settlement()` | present |
| v31 | `preview_payment_for_membership()` | present |
| v32 | directed settlement (5-arg) | `settle_payment(text,numeric,text,date,uuid[])` |

**No migration is pending.** Deployment is code-only.

---

## 3. Database dependencies

Every deployed function depends on functions that already exist:

```
payments-verify · nalo-webhook · cron-settle-pending
payments-manual · payments-bulk · payments-initialize   →  settle_payment()
payments-preview                                        →  preview_payment_for_membership()
member-profile                                          →  get_member_portal_state()
admin-dashboard                                         →  get_admin_totals()
```

All five verified present and executable by `service_role`, and revoked from
`anon`/`authenticated`.

---

## 4. Environment / provider configuration

No new variables. Existing requirements unchanged:
`JWT_SECRET` (now enforced ≥32 chars, non-default), `NALO_*`,
`PAYMENT_SERVICE_CHARGE_PCT`, `CRON_SECRET`, `ALLOWED_ORIGINS`, `MEMBER_URL`.

**`JWT_SECRET` is the one deployment risk.** `_shared/jwt.ts` now *refuses to
run* with a missing, short, or previously-published secret. If the production
value is weak, every function importing it fails at first use — loudly, which
is the intent, but it would be an outage. Verified before deploying (§7 below).

NaloPay configuration is unchanged; the adapter calls the same endpoints.

---

## 5. Expected production behaviour change

| | before | after |
|---|---|---|
| multi-day settlement | silently dropped days after the first | all days settle |
| allocation ledger | written by 1 of 5 paths | written by every path |
| webhook with unverifiable status | **settled anyway** | leaves pending for the sweeper |
| short payment via webhook | credited in full | credits only what arrived |
| member dashboard | one group at a time, 66 round trips | all groups, 1 round trip |
| "Paid so far" | last 50 rows | true aggregate |
| admin "Total collected" | **GHS 433,110.50** (capped at 1,000 rows) | **GHS 535,449.00** |
| repair tools | could move money outside the engine | 410 |

The admin total jumping ~GHS 102,338 is a **correction, not a movement** — no
financial data changes; the figure stops being truncated.

---

## 6. Rollback

Three independent layers; never conflate them.

**Code** — `git revert` the function changes and redeploy. Safe at any time.
The database functions are additive, so old code keeps working against them.

**Database** — v29–v32 are read-only or additive and can be dropped without
touching data. v26's index swap is reversible. **v27 is a data repair with an
audit trail — reverse it deliberately, not as part of a rollback.**

**Financial data** — never automatically reversed because a deployment failed.
Any correction goes through `settle_payment()` or an explicit, audited
migration.

**Trigger for rollback:** any function returning 500 on a financial path, or a
checksum difference that cannot be explained within 15 minutes.

---

## 7. Pre-deployment checks

1. Financial checksum → `docs/phase-05/checksum-before.txt`
2. Verify `JWT_SECRET` is set and ≥32 chars *before* deploying anything that
   imports `jwt.ts` — a bad value takes the platform down.
3. Confirm no migration is pending.

## 8. Post-deployment verification

1. `groups-public` (unauthenticated) — proves the runtime is healthy
2. `payments-preview` without a token → **401**, not 500 (proves `jwt.ts` boots)
3. Disabled repair tools → **410**
4. Confirm the deployed bundle differs from the previous version
5. Financial checksum → `docs/phase-05/checksum-after.txt`
6. Classify **every** difference: deployment effect · legitimate business
   activity · unexpected mutation. Phase 04 already showed live admin activity
   moving the checksum mid-work, so a difference is not automatically a fault —
   but it must be explained.
7. Watch `settlement_log` for the first real settlements through the new engine.

## 9. Order of deployment

Least-risk first, so a runtime problem surfaces before money is involved:

```
1. groups-public                 (public, no auth, no money)
2. _shared consumers — security  (admin-*, kyc-review, member-change-passcode)
3. member-profile, admin-dashboard  (reads only)
4. payments-preview              (new, read-only)
5. payments-initialize, payments-verify, payments-manual, payments-bulk
6. nalo-webhook                  (--no-verify-jwt, as the provider is unauthenticated)
7. cron-settle-pending           (last: it settles autonomously every 10 minutes)
```

`cron-settle-pending` is deliberately last. It runs unattended, so it should
only start using the new engine once every interactive path is verified.
