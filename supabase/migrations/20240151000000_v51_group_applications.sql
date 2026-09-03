-- ============================================================================
-- v51 — APPLYING TO JOIN A GROUP
-- ============================================================================
-- Adds one table and one column. Writes no financial row, creates no
-- membership, and changes nothing about groups that do not opt in.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
--
-- Every join was immediate. That is right for an open savings group and wrong
-- for one where the collector vets who comes in — and until now the portal
-- offered no way to express the difference, so a "Apply to Join" button would
-- have been a button that lied about what happened when you pressed it.
--
-- ── THE DEFAULT IS UNCHANGED BEHAVIOUR ──────────────────────────────────────
--
-- `requires_approval` defaults to false, so all 19 existing groups keep joining
-- immediately exactly as before. A group only behaves differently once somebody
-- deliberately turns it on.
--
-- ── AN APPLICATION IS NOT A MEMBERSHIP ──────────────────────────────────────
--
-- Nothing here touches group_memberships, contributions or transactions. An
-- application records that somebody asked; approving it goes through the same
-- membership-creation path a direct join uses, so there is one way a person
-- ends up in a group and one place that can be wrong about it.
-- ============================================================================

ALTER TABLE susu_groups
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN susu_groups.requires_approval IS
  'When true, a member applies and an administrator decides. When false (the '
  'default, and how every group behaved before this column existed) joining is '
  'immediate.';

CREATE TABLE IF NOT EXISTS group_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES susu_groups(id)   ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES members(id)       ON DELETE CASCADE,
  -- Which portion they asked for. Kept so an approval creates the membership
  -- the member actually applied for, not whatever is configured months later.
  portion_id   uuid REFERENCES group_portions(id),
  slot_fraction numeric NOT NULL DEFAULT 1 CHECK (slot_fraction > 0 AND slot_fraction <= 1),
  slots        integer NOT NULL DEFAULT 1 CHECK (slots > 0 AND slots <= 10),

  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  note         text,                      -- what the member said, if anything

  applied_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   uuid REFERENCES admin_users(id),
  decision_reason text,

  -- The membership an approval produced, so an application can be traced to
  -- its outcome rather than just being marked approved.
  membership_id uuid REFERENCES group_memberships(id)
);

-- One live application per member per group. A member may re-apply after a
-- rejection, so this constrains only the pending ones.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_application
  ON group_applications (group_id, member_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_applications_queue
  ON group_applications (status, applied_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_applications_member ON group_applications (member_id);

REVOKE ALL ON group_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON group_applications TO service_role;


-- ── The queue an administrator works through ────────────────────────────────
CREATE OR REPLACE FUNCTION get_application_queue(p_group_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'applied_at', a.applied_at,
    'slots', a.slots,
    'slot_fraction', a.slot_fraction,
    'note', a.note,
    'member', jsonb_build_object(
      'id', m.id, 'name', m.full_name, 'code', m.member_id,
      'phone', m.phone, 'status', m.status),
    'group', jsonb_build_object(
      'id', g.id, 'name', g.name,
      'free_slots', GREATEST(0, COALESCE(g.max_members,0) - COALESCE(g.current_members,0))),
    'portion', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', p.id, 'label', p.label,
      'contribution_amount', p.contribution_amount,
      'payout_amount', p.payout_amount,
      'registration_fee', p.registration_fee) END,
    -- What this member already holds here, so a decision is made knowing it.
    'existing_slots', (SELECT count(*) FROM group_memberships gm
                        WHERE gm.member_id = a.member_id AND gm.group_id = a.group_id
                          AND gm.status = 'active')
  ) ORDER BY a.applied_at), '[]'::jsonb)
  FROM group_applications a
  JOIN members m     ON m.id = a.member_id
  JOIN susu_groups g ON g.id = a.group_id
  LEFT JOIN group_portions p ON p.id = a.portion_id
  WHERE a.status = 'pending'
    AND (p_group_id IS NULL OR a.group_id = p_group_id);
$$;

REVOKE ALL ON FUNCTION get_application_queue(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_application_queue(uuid) TO service_role;
