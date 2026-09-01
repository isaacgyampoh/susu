# Phase 07 — Final report

**1 September 2026.** Production: `qaelfwtbaehdwhnxkpid`, PostgreSQL 17.6, 52 edge
functions, Vercel.

---

## Status

```
Clean Architecture                  COMPLETE
Production deployment               COMPLETE
Multiple memberships                COMPLETE
Advance payments                    COMPLETE
Membership credit                   COMPLETE
Payment allocation                  COMPLETE
Payment history                     COMPLETE
Member statements                   COMPLETE
Registration payment                COMPLETE
Public registration flow            COMPLETE
NaloPay verification                COMPLETE
Webhook idempotency                 COMPLETE
Atomic settlement                   COMPLETE
Authorization                       COMPLETE
IDOR protection                     COMPLETE
Admin reconciliation                COMPLETE
Admin reporting                     COMPLETE
Security                            INCOMPLETE  — see "The one thing that is not done"
Legacy financial engines            REMOVED
Schema guessing                     REMOVED
Real/sandbox payment verification   COMPLETE    — 17 real settlements, GHS 5,884

Tests:                  110/110
TypeScript:             PASS
Build:                  PASS
Production verification: PASS
Financial invariants:   12 of 13 hold; 1 is a pre-existing data finding (below)
Financial data changed: NONE
```

---

## The one thing that is not done

**The `service_role` key published in this repository's git history on
12 July 2026 is still live.** I proved it this phase: a request carrying that
key returned member rows from production. It is valid until 2036, and
`service_role` bypasses row-level security entirely — every member record,
Ghana Card number, passcode hash, contribution, payment and payout, readable
and writable by anyone who has looked at the repository.

I did not rotate it. Rotating a production credential is not mine to do
unilaterally: anything holding it manually breaks the moment it changes.
`ROTATION.md` has the steps; it takes about two minutes in the Supabase
dashboard, and edge functions pick the new key up automatically.

Nothing else in this report matters as much as this does.

Also outstanding, and recorded rather than guessed at:

```
PAT                  NOT VERIFIED   (the one supplied in this engagement still works)
service_role         NOT ROTATED    (proven live this phase)
project JWT secret   NOT VERIFIED
application JWT_SECRET  ROTATED     (Phase 05, 96 characters)
default admin password  STILL ACTIVE — but the console is now gated on it
```

The default administrator password `Admin@1234` still works. It could not be
changed for you — an admin password has to reach a person. What changed is that
the console no longer merely *warns*: `must_change_password` now redirects every
admin screen to `/admin/password` until it is changed. Nobody is locked out —
`change_admin_password()` clears the flag, refuses the shipped default outright,
and invalidates every other session.

---

## What this phase built

### The public registration payment flow

Applicants could not pay. NaloPay prompts a phone, prompting needed an
authenticated caller, and an applicant has no account — so a fee could only ever
be recorded by an admin after the fact. That is how thirteen approved members
ended up carrying an unpaid fee of GHS 1,320.50 between them.

```
join form → application created → payment link (SMS + on screen)
          → NaloPay prompt → provider confirms → fee PAID
          → admin review → approval → membership active
```

The applicant authenticates with a capability token, not an account: 32 bytes of
CSPRNG output, stored only as its SHA-256, expiring in 14 days, granting exactly
one thing — paying one named application's fee. A reader of the database cannot
reconstruct anyone's link.

`initiate` returning 200 means a prompt reached a phone. The page says
**"Awaiting confirmation"**, never "Paid", until NaloPay's own status endpoint
confirms the full amount.

### Registration settlement became atomic, and stopped accepting short payments

`settleRegistrationFee` used to be three separate PostgREST writes with no
transaction around them — the same defect Phase 04 removed from contributions. A
crash between the first and second left money recorded as received against an
application still marked unpaid.

Worse, it computed `least(confirmed, recorded)` and then marked the application
paid with whatever came out. **A provider reporting GHS 100 against a GHS 150
fee unlocked registration in full for two thirds of the money.**

Both are now `settle_registration_fee()` in PostgreSQL: one transaction, one row
lock, and a short payment settles *nothing* — it is logged and left for a human,
because there is no such thing as a partially registered member and inventing one
would be guessing at money.

### Reversal stopped corrupting the ledger

`admin-undo-payment` restored a contribution to unpaid and left
`payment_allocations` untouched — so the ledger still said a payment covered a
day the day said nothing had paid for. That is precisely the state financial
invariant 8 exists to detect. **An operator correcting a typo would have tripped
the alarm built to catch F-02.** It also left behind any credit those payments
had banked: money the system had just declared never arrived, still spendable.

Now `reverse_contribution_payment()`: one transaction, allocations stamped
rather than deleted, credit offset by a negative ledger entry rather than an
edit, and the whole before-state appended to `settlement_log`.

### Two live settlement engines nobody knew were deployed

`moolre-webhook` and `payments-webhook` were **ACTIVE, publicly callable, and
absent from the repository.** Both wrote `contributions.status = 'paid'`
directly, outside the canonical engine, with no allocation ledger.
`payments-webhook` settled on a `charge.success` found in the *request body* with
no call back to the provider — finding F-04, still live on a different URL.

Phase 05's function audit missed them because it audited the repository, and
they had no source in the repository to audit. Both are now emptied, in git, and
return 410; verified live.

### Runtime schema guessing is gone, and enforced

Five fallbacks remained: query, regex the error *message* for a column name,
delete that field, retry. Every column they guessed about had existed for
months, so they could no longer fire for the reason they were written — only on
an unrelated failure that happened to mention the same word, and then silently
save incomplete data. The architecture suite now checks the edge functions too.

---

## What I found and did not touch

Three new invariants went in. One fails, and it is a **pre-existing data
finding**, not a defect I introduced:

**Seven applications are marked `registration_fee_paid = true` with no
successful payment anywhere and no audit row — GHS 1,745.** All from
19–21 July 2026, before payment recording was audited. Six of the seven point at
groups that have since been deleted.

They are untouched. Reversing a fee flag on a live member because a record is
missing would be guessing at payment status — the operator may simply remember
taking the cash. They are surfaced in the reconciliation console with everything
needed to decide. The path that produced them is closed: `mark_fee_paid` now
writes the transaction and the audit row *first*, and the flag only follows.

**Point-in-time recovery is disabled.** Eight daily physical backups exist
(most recent today at 07:48 UTC, before any of this work), so the recovery
granularity is 24 hours: a mistake at 10:00 can only be rolled back to 07:48,
losing the morning's real payments. Enabling PITR is a paid add-on and therefore
a business decision.

---

## Business decisions — still yours

```
13 unpaid registrations            GHS  1,320.50
 7 marked paid without evidence    GHS  1,745.00   ← new this phase
402 payments pending over 48h      GHS 40,658.00
allocation ordering                 unchanged — LEGACY_SLOT_FIRST
```

None auto-resolved. None guessed at. All four are reachable from
`/admin/reconciliation` with the evidence attached and every action audited.
There is no "mark successful" button and there will not be one.

---

## The first real payments

`settlement_log` was empty when this phase began. It is not now: **seventeen
real payments settled through the new engine today**, GHS 5,884 across 64 days,
between 19:05 and 21:15 — recorded by an admin while I worked, not by me.

The cutover is visible in the data. Every settled contribution payment before
14:00 UTC (36 of them) has no allocation row; every one after (17) has a
complete set. 0% then, 100% now.

Every one allocated exactly what was paid, to the pesewa. Sarah Acheampomaah's
GHS 510 spread across five groups; Gloria Konadu's GHS 770 cleared ten days in
one. Checked afterwards for all eight failure shapes §16 lists — duplicate
allocation, wrong amount, wrong membership, missing allocation, wrong status,
wrong credit, wrong statement, duplicate webhook: **zero on every one.**

190 of 190 memberships across all active members still reconcile.
