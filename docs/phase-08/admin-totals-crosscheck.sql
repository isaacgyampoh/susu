-- ============================================================================
-- §25 — is get_admin_totals() actually right?
-- ============================================================================
-- Every headline figure recomputed from first principles, independently of the
-- function, and compared. Read-only.
-- ============================================================================
WITH t AS (SELECT get_admin_totals(CURRENT_DATE) AS x)
SELECT * FROM (
  -- Money COLLECTED excludes payouts: a payout is money going out. The
  -- function is right to filter them and the first version of this check was
  -- wrong to include them.
  SELECT 'collected all time'  AS figure,
         (SELECT (x->'collected'->>'all_time')::numeric FROM t) AS reported,
         (SELECT COALESCE(sum(amount),0) FROM transactions
           WHERE status='success' AND type IN ('contribution','registration_fee')) AS recomputed
  UNION ALL SELECT 'collected today',
         (SELECT (x->'collected'->>'today')::numeric FROM t),
         (SELECT COALESCE(sum(amount),0) FROM transactions
           WHERE status='success' AND created_at::date = CURRENT_DATE)
  UNION ALL SELECT 'payments counted',
         (SELECT (x->'collected'->>'payments')::numeric FROM t),
         (SELECT count(*) FROM transactions WHERE status='success'
           AND type IN ('contribution','registration_fee'))
  UNION ALL SELECT 'contributions paid',
         (SELECT (x->'contributions'->>'paid')::numeric FROM t),
         (SELECT COALESCE(sum(amount),0) FROM contributions WHERE status='paid')
  UNION ALL SELECT 'contributions expected',
         (SELECT (x->'contributions'->>'expected')::numeric FROM t),
         (SELECT COALESCE(sum(amount),0) FROM contributions)
  UNION ALL SELECT 'contributions overdue',
         (SELECT (x->'contributions'->>'overdue')::numeric FROM t),
         (SELECT COALESCE(sum(amount),0) FROM contributions WHERE status='overdue')
  UNION ALL SELECT 'outstanding',
         (SELECT (x->'contributions'->>'outstanding')::numeric FROM t),
         (SELECT COALESCE(sum(amount - COALESCE(amount_paid,0)),0) FROM contributions WHERE status <> 'paid')
  UNION ALL SELECT 'due today (gross)',
         (SELECT (x->'contributions'->>'due_today')::numeric FROM t),
         (SELECT COALESCE(sum(amount),0) FROM contributions WHERE due_date = CURRENT_DATE)
  UNION ALL SELECT 'remaining today',
         (SELECT (x->'contributions'->>'remaining_today')::numeric FROM t),
         (SELECT COALESCE(sum(amount - COALESCE(amount_paid,0)),0) FROM contributions
           WHERE due_date = CURRENT_DATE AND status <> 'paid')
  UNION ALL SELECT 'payouts paid',
         (SELECT (x->'payouts'->>'paid')::numeric FROM t),
         (SELECT COALESCE(sum(total_amount),0) FROM payouts WHERE status='paid')
  UNION ALL SELECT 'payouts upcoming',
         (SELECT (x->'payouts'->>'upcoming')::numeric FROM t),
         (SELECT COALESCE(sum(total_amount),0) FROM payouts WHERE status='upcoming')
  UNION ALL SELECT 'active members',
         (SELECT (x->'members'->>'active')::numeric FROM t),
         (SELECT count(*) FROM members WHERE status='active')
  UNION ALL SELECT 'active memberships',
         (SELECT (x->'memberships'->>'active')::numeric FROM t),
         (SELECT count(*) FROM group_memberships WHERE status='active')
  UNION ALL SELECT 'pending over 48h (count)',
         (SELECT (x->'anomalies'->>'pending_over_48h')::numeric FROM t),
         (SELECT count(*) FROM transactions WHERE status='pending' AND created_at < now() - interval '48 hours')
  UNION ALL SELECT 'pending over 48h (value)',
         (SELECT (x->'anomalies'->>'pending_over_48h_value')::numeric FROM t),
         (SELECT COALESCE(sum(amount),0) FROM transactions WHERE status='pending' AND created_at < now() - interval '48 hours')
  UNION ALL SELECT 'approved registrations unpaid',
         (SELECT (x->'anomalies'->>'approved_registrations_unpaid')::numeric FROM t),
         (SELECT count(*) FROM kyc_applications WHERE status='approved' AND NOT COALESCE(registration_fee_paid,false))
) q ORDER BY figure;
