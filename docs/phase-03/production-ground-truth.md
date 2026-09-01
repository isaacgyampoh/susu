# Production ground truth

Captured directly from the live database via the Supabase Management API on
1 September 2026. Nothing here is inferred from migration filenames.

**Project** `qaelfwtbaehdwhnxkpid` · PostgreSQL **17.6** · eu-west-1 · ACTIVE_HEALTHY

Raw evidence: `docs/phase-01/results/` (schema, forensics, deployed function bodies)
and `docs/phase-03/snapshots/` (financial checksums).

---

## CONFIRMED FROM PRODUCTION

### Scale
| | |
|---|---|
| members | 82 (62 active) |
| susu_groups | 18 (11 active) |
| group_memberships | 266 (195 active, 71 defaulted) |
| contributions | 15,707 |
| transactions | 1,924 |
| payment_allocations | 181 |
| payouts | 153 |

### Migration state
**Every migration v1–v24 is applied.** The `apply-pending-migrations.sql`
script beginning at V9 was a red herring; V1–V8 went in by another route.
Verified column-by-column against schema markers, not by filename.

v25 was **not** applied at the start of Phase 03. It has now been applied.

### Deployed `activate_group` — D-01 resolved
One overload only: `activate_group(uuid,date,boolean,boolean,boolean)`.
The "function is not unique" runtime-ambiguity risk raised in Phase 01 is
**withdrawn — it was not real**.

The deployed body is the **v15 version**, which contains:

```sql
v_cashout := COALESCE(v_group.cashout_amount,
              v_group.contribution_amount * v_group.max_members * v_group.cycle_days);
```

v8's `RAISE EXCEPTION 'Set the member cashout amount before activating…'` is
**absent**. The system can still invent a payout figure.

It has not yet done so: `trg_require_cashout` is present and firing, and
**0 groups have a null cashout**. That trigger has been the only thing
preventing an invented payout since v11.

### Settlement implementations found live
Five, disagreeing with each other. See `legacy-map.md`.

### Payment reference constraint — F-02 confirmed
`uniq_contribution_ref` existed as `CREATE UNIQUE INDEX … ON contributions
(paystack_ref) WHERE paystack_ref IS NOT NULL`.

Proof it was rejecting writes: **166 contributions carried a reference, 166
distinct references, maximum days covered by any one reference = 1.** A
one-to-one ratio is impossible in a susu where members pay several days at a
time.

### Credit balances
`members.credit_balance = 0.00` for **every** member. No historical monetary
balance required an ambiguous migration.

### Authorization
17 tables, RLS enabled on all, **1 policy total** (`public_read_groups` on
`susu_groups`). All other access is deny-all with service_role bypass.

Before v25: **22 functions executable by `anon`**, including
`verify_member_passcode`, `verify_admin_password`, `record_partial_payment`,
`activate_group`, `forfeit_membership`, `get_member_statement`.

### Timezone
Database timezone is **UTC**; Ghana is UTC+0. `flag_late_contributions`'s use
of `CURRENT_TIME > payment_deadline` is therefore correct. The latent
timezone bug flagged in the audit is **withdrawn**.

### Scheduled jobs
Six pg_cron jobs, all active. `susu-settle-pending` runs every 10 minutes and
has executed **1,008 times in 7 days, all succeeded**.

---

## INFERRED FROM SOURCE (not verified against production behaviour)

- That `settle.ts` discards the result of its contribution `UPDATE`. Read from
  the source; the *consequence* is confirmed from data, but the code path
  itself was not instrumented.
- That the 402 stuck transactions are abandoned prompts. The sweeper has run
  1,008 times without settling them, which is strong evidence — but the
  provider's own record has not been consulted. See
  `payment-reconciliation-analysis.md`.
- The allocation ordering `settle.ts` implements. Read from its queue
  construction; the new `settle_payment()` reproduces it and the conformance
  suite pins the behaviour, but no A/B comparison against the old path was run
  on live traffic.
