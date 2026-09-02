# Release checklist

## Before deploying

```
[ ] npx tsc --noEmit                                     PASS
[ ] npx vitest run                                       110/110
[ ] npx next build                                       PASS
[ ] financial-invariants.sql                             only known findings
[ ] financial-checksum.sql  →  save as "before"
```

## Deploy ordering — these must ship together

Two endpoints gained a mandatory reason this phase, and the console screens that
call them were changed in the same commit. Deploying the edge functions without
the frontend leaves those two buttons returning a 400 until the frontend
follows:

```
kyc-review  action=mark_fee_paid   now needs reason >= 10 chars  → /admin/kyc
admin-undo-payment                 now needs reason >= 10 chars  → /admin/transactions
```

Both fail *safely* — they refuse and explain — but an operator is blocked from
recording a cash fee or reversing a payment until the frontend is live. Push the
frontend in the same release.

## Deploying

```
[ ] supabase db push  (or apply migrations in order)
[ ] supabase functions deploy <changed>
[ ] nalo-webhook          MUST use --no-verify-jwt
[ ] registration-payment  MUST use --no-verify-jwt
[ ] moolre-webhook, payments-webhook  --no-verify-jwt (410 stubs)
[ ] vercel deploy (or push to main)
```

**The `--no-verify-jwt` flag is not sticky.** `supabase functions deploy
nalo-webhook` without it silently re-enables JWT verification and NaloPay's
callbacks start returning 401. Redeploying the webhook without the flag is the
single easiest way to break settlement.

## After deploying

```
[ ] financial-checksum.sql  →  compare with "before"; explain every difference
[ ] financial-invariants.sql                             unchanged
[ ] acceptance-multi-group.sql                           19/19
[ ] idor.sql                                             8/8
[ ] GET /admin/reconciliation                            loads
[ ] GET /admin/kyc                                       four buckets load
[ ] a registration payment link                          resolves
```

## Classifying a checksum difference

| Cause | Looks like |
|---|---|
| migration | counts unchanged, a hash moves because a column was added |
| business transaction | `transactions` and `payment_allocations` both grow; `settlement_log` has matching rows |
| expected operational change | an admin recorded a payment; `audit_log` says who |
| **unexpected mutation** | anything else — stop and investigate before deploying further |

## Never

```
DROP TABLE / TRUNCATE / DELETE financial history
"mark successful" on a pending payment
setting registration_fee_paid without a payment record or an audited override
deploying nalo-webhook without --no-verify-jwt
changing allocation ordering (LEGACY_SLOT_FIRST) without a written decision
```

## Outstanding, needs a person

```
[ ] ROTATE THE service_role KEY — published in git history, proven live 1 Sep 2026
[ ] Change the default admin password (the console is gated until you do)
[ ] Rotate the PAT and the project JWT secret
[ ] Consider enabling PITR — recovery granularity is currently 24 hours
[ ] Decide: 13 unpaid registrations, 7 paid-without-record, 402 pending payments
```
