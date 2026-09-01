# 10 — Final release checklist

## Acceptance criteria (§41)

```
[x] Clean Architecture boundaries enforced      10 mechanical checks, run every build
[x] Domain framework-independent                no framework, database, provider, clock or env
[x] One canonical allocation engine             settle_payment(); enforced by test
[x] Database settlement atomic                  one transaction, SELECT … FOR UPDATE
[x] Database/domain conformance passes          16 hand-written + 150 generated scenarios
[x] Payment idempotency proven                  50 concurrent → one financial effect
[x] No duplicate settlement engines             record_partial_payment dropped (v41)
[x] No runtime schema guessing                  removed; enforced repo-wide
[x] Member → Membership[] everywhere            30-membership member verified
[x] Per-membership credit ledger                membership_credit_ledger
[x] Credit isolation proven                     property invariant 6; 150 db scenarios; invariant 3
[x] Payment → PaymentAllocation[] correct       reference UNIQUE per payment
[x] Registration payment gating complete        402 + audited override
[x] NaloPay verification authoritative          no path settles on a callback body
[x] Registration online payment works           /join/pay/<token>, verified live
[x] Member portal shows every membership        no membership behind a tab
[x] Today's obligations correct                 obligation − paid = remaining, verified
[x] Advance payments visible                    day-by-day, from the real engine
[x] Remaining balances correct                  16/16 admin figures recomputed
[x] Cash-out dates correct                      NULL where unassigned, never fabricated
[x] Expected payouts correct                    membership override wins; group default otherwise
[x] Statements reconcile                        190/190
[x] Admin totals database-side                  16/16 vs independent recomputation
[x] IDOR suite passes                           8/8 database, 10/10 live HTTP
[x] Authentication suite passes                 11/11
[x] Financial invariants pass                   12 of 13; 1 is a preserved data finding
[x] Concurrent settlement passes                50 requests, one effect
[x] Duplicate webhook passes                    10 replays, one settlement
[x] Reversal accounting passes                  8/8, history preserved
[x] Historical financial data preserved         nothing repaired by guessing
[x] No unexplained financial movement           every cedi traced to 17 real payments
[ ] No secrets in repository/history            REPOSITORY CLEAN — HISTORY NOT
[x] Sensitive functions protected               0 reachable by anon
[x] Legacy settlement functions removed         5 dropped this phase, 8 earlier
[x] Production Edge Functions deployed          52/52, repo and deployment agree
[x] Production migrations deployed              42, zero drift
[x] Production endpoints verified               listed in 09
[x] Mobile portal verified                      by inspection, not a browser
[x] Registration flow verified                  end to end, live
[x] NaloPay flow verified                       provider-authoritative; no live member payment yet
[x] Final financial checksum verified           every movement explained
```

**One box is unticked, and it is not one this work can tick.**

## Human actions required

```
1. ROTATE THE service_role KEY                                    ← blocking
   Supabase → Project Settings → API → Reset service_role key
   Published in this repository's git history on 12 July 2026 and PROVEN LIVE
   on 1 September 2026. Bypasses row-level security entirely.
   Edge functions pick up the new key automatically. See ROTATION.md.

2. Change the default admin password
   Sign in → the console now redirects to /admin/password until you do.
   change_admin_password() refuses the shipped default and ends every session.

3. Rotate the PAT and the project JWT secret
   Neither reached the repository; both were exposed during this engagement.

4. Deploy the frontend
   83 files are uncommitted. Vercel ships on push to main. Two endpoints now
   require a reason and their console screens are written but unshipped —
   see "Deploy ordering" below.

5. Decide, or defer deliberately
   13 approved registrations with an unpaid fee        GHS  1,320.50
    7 marked paid with no payment record               GHS  1,745.00
   402 payments pending over 48 hours                  GHS 40,658.00
   Point-in-time recovery (a paid add-on; recovery is currently 24-hourly)
```

## Deploy ordering — these must ship together

```
kyc-review  action=mark_fee_paid    needs reason ≥ 10 chars   → /admin/kyc
admin-undo-payment                  needs reason ≥ 10 chars   → /admin/transactions
member-change-passcode              returns session_ended     → /m/portal/profile
```

All three fail *safely* — they refuse and explain — but an operator is blocked
from recording a cash fee or reversing a payment until the frontend lands, and a
member changing their passcode will be signed out without the page explaining
why. Push the frontend in the same release.

## Before deploying

```
[ ] git status / git diff reviewed
[ ] npx tsc --noEmit                                     PASS
[ ] npx vitest run                                       114/114
[ ] npx next build                                       PASS
[ ] docs/phase-07/financial-invariants.sql               only the known finding
[ ] docs/phase-03/financial-checksum.sql   → save as "before"
```

## Deploying

```
[ ] apply migrations in order
[ ] supabase functions deploy <changed>
[ ] nalo-webhook          MUST use --no-verify-jwt
[ ] registration-payment  MUST use --no-verify-jwt
[ ] moolre-webhook, payments-webhook  --no-verify-jwt (410 stubs)
[ ] push to main → Vercel
```

**`--no-verify-jwt` is not sticky.** Redeploying `nalo-webhook` without it
silently re-enables JWT verification and NaloPay's callbacks start returning
401. It is the single easiest way to break settlement.

## After deploying

```
[ ] financial-checksum.sql → compare; explain every difference
[ ] financial-invariants.sql                             unchanged
[ ] docs/phase-07/acceptance-multi-group.sql             19/19
[ ] docs/phase-07/idor.sql                               8/8
[ ] docs/phase-08/admin-totals-crosscheck.sql            16/16
[ ] /admin/reconciliation, /admin/kyc                    load
[ ] a registration payment link                          resolves
```

## Classifying a checksum difference

| Cause | Signature |
|---|---|
| migration | counts unchanged; a hash moves because a column was added |
| business transaction | `transactions` and `payment_allocations` grow together; `settlement_log` has a matching row |
| expected operational change | an admin recorded something; `audit_log` names them |
| **unexpected mutation** | anything else — stop and investigate before deploying further |

## Never

```
DROP TABLE / TRUNCATE / DELETE financial history
"mark successful" on a pending payment
registration_fee_paid without a payment record or an audited override
deploying nalo-webhook without --no-verify-jwt
changing allocation ordering (LEGACY_SLOT_FIRST) without a written decision
creating an exec_sql RPC or any arbitrary-SQL endpoint
```
