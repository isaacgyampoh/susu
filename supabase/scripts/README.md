# supabase/scripts

Operational SQL that is **not** a migration. Nothing here runs automatically.

## `schedule-cron-jobs.sql`

Registers the six pg_cron jobs, once, in the SQL editor. Re-runnable — it
unschedules before scheduling. All six are active in production:

```
susu-settle-pending      */10 * * * *   the payment sweeper
susu-daily-reminders     0 7  * * *
susu-afternoon-reminders 30 14 * * *
susu-payout-reminders    0 9  * * *
susu-daily-digest        0 20 * * *
susu-flag-late           0 21 * * *
```

`<CRON_SECRET>` must be replaced with the edge-function secret before running.

## Removed: `apply-pending-migrations.sql`

Deleted in Phase 10. It bundled migrations v9–v24 into one 780-line script, and
all fifteen of those already exist as proper files in `supabase/migrations/`, so
it was redundant.

It was also dangerous. Its name invites running it, and it contained:

```sql
CREATE OR REPLACE FUNCTION record_partial_payment(...)
CREATE OR REPLACE FUNCTION get_membership_balance(...)
```

Both were **dropped from production in v41**: `record_partial_payment` was a
settlement engine with no row lock, no allocation ledger, no idempotency and no
audit trail, and `get_membership_balance` computed a "total paid" that ignored
`amount_paid` and so disagreed with every other figure in the system.

Running the script would have resurrected both, and would additionally have
overwritten `activate_group`, `forfeit_membership` and
`generate_membership_schedule` with their v9–v22 versions, undoing later fixes.

Migrations belong in `supabase/migrations/`, applied in order. A convenience
script that re-creates deleted financial code is not a convenience.
