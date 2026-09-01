-- ============================================================================
-- V26 — CORRECT THE PAYMENT REFERENCE MODEL  (Phase 03)
-- ============================================================================
-- A payment reference identifies a PAYMENT. It has never identified a
-- contribution. v4 put a UNIQUE index on contributions.paystack_ref believing
-- it would "stop double-paying a contribution", but that is not what it does:
--
--   One payment legitimately covers MANY days. Every settlement path writes
--   the same reference onto every day it covered. The unique index lets the
--   first row through and raises 23505 on all the rest — and settle.ts never
--   inspects the update result, so the failure is discarded while the running
--   total is decremented and the allocation row is still written.
--
-- VERIFIED IN PRODUCTION before writing this migration:
--   * the index exists and is live
--   * 166 contributions carry a reference; 166 distinct references;
--     maximum days covered by any one reference = 1
--   * a one-to-one ratio is impossible in a susu where members pay several
--     days at a time — it is the signature of the constraint rejecting writes
--   * 4 contributions are fully allocated but still unpaid (GHS 223)
--   * 2 of those were then allocated a SECOND time by a later payment, so the
--     member paid GHS 130 twice for the same two days
--
-- The double payment is the part that matters. F-02 does not merely lose a
-- settlement: because the day stays `pending`, the member is billed again and
-- pays again. The defect compounds.
--
-- WHAT REPLACES IT
--   Uniqueness belongs where identity actually is:
--     transactions.reference            already UNIQUE — the payment's identity
--     payment_allocations(reference, contribution_id)   NEW — a payment may
--                                       touch a given day at most once
--   contributions.paystack_ref becomes a plain lookup index.
--
-- Double-settlement of a PAYMENT was never protected by the dropped index in
-- any case; it is protected by claimTransaction()'s conditional update on
-- transactions.status, which is correct and stays.
--
-- This migration is ADDITIVE AND CORRECTIVE ONLY. It creates a table, swaps an
-- index, adds constraints and indexes. It changes no financial value. The data
-- repair is deliberately a SEPARATE migration (v27) so it can be reviewed and
-- reverted independently.
-- ============================================================================

BEGIN;

-- ── 1. Per-membership credit ledger ──────────────────────────────────────
-- members.credit_balance is member-scoped, so a surplus paid into Group A can
-- settle Group B's next obligation. The specification forbids that: groups
-- must not pool money.
--
-- Verified: credit_balance is 0.00 for EVERY member in production, so there is
-- nothing to migrate and no ambiguous historical balance to resolve. This is a
-- clean additive change.
--
-- A ledger, not a mutable balance. The balance is SUM(amount) over the
-- entries, so every movement carries its own reason and source, and no write
-- can silently overwrite a previous one — which is what made the read-modify-
-- write race on credit_balance possible.
CREATE TABLE IF NOT EXISTS membership_credit_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id     UUID NOT NULL REFERENCES group_memberships(id) ON DELETE CASCADE,
  member_id         UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- Positive adds credit, negative consumes it. Balance is the running sum.
  amount            DECIMAL(10,2) NOT NULL,
  entry_type        TEXT NOT NULL CHECK (entry_type IN (
                      'surplus',        -- overpayment banked against this slot
                      'applied',        -- consumed by an obligation (negative)
                      'reconciliation', -- corrective entry from an investigation
                      'adjustment'      -- deliberate operator adjustment
                    )),
  -- What produced this entry. Kept as text because the payment identity today
  -- is transactions.reference, not a UUID foreign key.
  source_reference  TEXT,
  source_payment_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  contribution_id   UUID REFERENCES contributions(id) ON DELETE SET NULL,
  note              TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_membership
  ON membership_credit_ledger(membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_member
  ON membership_credit_ledger(member_id, created_at DESC);

ALTER TABLE membership_credit_ledger ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE membership_credit_ledger IS
  'Append-only advance-credit ledger, scoped to a MEMBERSHIP (slot), not a '
  'member. Balance = SUM(amount). Replaces members.credit_balance, which '
  'pooled credit across groups that must stay financially separate.';

-- ── 2. Replace the incorrect uniqueness ──────────────────────────────────
-- Dropped, not disabled: a reference covering many days is CORRECT and must
-- stop being rejected. The lookup value of the column is preserved by a plain
-- index.
DROP INDEX IF EXISTS uniq_contribution_ref;

CREATE INDEX IF NOT EXISTS idx_contributions_paystack_ref
  ON contributions(paystack_ref) WHERE paystack_ref IS NOT NULL;

COMMENT ON COLUMN contributions.paystack_ref IS
  'LEGACY NAME — the provider is NaloPay; this predates that decision and is '
  'not renamed here because several settlement paths and reports read it. '
  'Holds the reference of the payment that settled this day. NOT unique: one '
  'payment legitimately covers many days.';

-- ── 3. Put uniqueness where identity actually is ─────────────────────────
-- Verified before writing: 0 duplicate (reference, contribution_id) pairs
-- exist, so this constraint applies cleanly to current data.
--
-- This is the real idempotency guard for allocation: replaying a settlement
-- cannot create a second allocation for the same day of the same payment.
ALTER TABLE payment_allocations
  ADD CONSTRAINT uniq_allocation_per_payment_day
  UNIQUE (reference, contribution_id);

-- The allocation ledger could not be read back from a contribution at all.
CREATE INDEX IF NOT EXISTS idx_alloc_contribution
  ON payment_allocations(contribution_id);

-- Allocations were written without their membership or group, so an
-- allocation could not be joined back to the slot it landed in. Additive:
-- existing rows keep NULL until backfilled in v27.
ALTER TABLE payment_allocations
  ADD COLUMN IF NOT EXISTS membership_id UUID REFERENCES group_memberships(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date      DATE;

CREATE INDEX IF NOT EXISTS idx_alloc_membership
  ON payment_allocations(membership_id, created_at DESC);

-- ── 4. Indexes the hot paths have always needed ──────────────────────────
-- contributions is the largest table (15,707 rows and growing at
-- members x cycle length). Every settlement, portal load, payout eligibility
-- check and schedule generation filters on membership_id — which had NO index
-- of any kind. Verified missing in production before writing this.
CREATE INDEX IF NOT EXISTS idx_contributions_membership_due
  ON contributions(membership_id, due_date);
CREATE INDEX IF NOT EXISTS idx_contributions_membership_status
  ON contributions(membership_id, status) WHERE status <> 'paid';
CREATE INDEX IF NOT EXISTS idx_contributions_member_status_due
  ON contributions(member_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_contributions_batch
  ON contributions(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contributions_due_status
  ON contributions(due_date, status);

-- The webhook and the 10-minute sweeper both look a payment up by the
-- provider's order id inside a JSONB column, with no index. That is a full
-- scan of transactions on every callback.
CREATE INDEX IF NOT EXISTS idx_transactions_provider_order
  ON transactions USING GIN (paystack_data jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_transactions_status_created
  ON transactions(status, created_at DESC);

-- The member portal's entry query.
CREATE INDEX IF NOT EXISTS idx_memberships_member_status
  ON group_memberships(member_id, status);

COMMIT;
