-- ============================================================================
-- §3 — WHAT CAN BE DETERMINED ABOUT THE 402 WITHOUT ASKING NALOPAY
-- ============================================================================
-- Read-only. Classifies only on evidence already in the database. Anything
-- needing the provider's word stays UNKNOWN_REQUIRES_REVIEW: this file never
-- guesses a payment outcome, and age is never treated as evidence.
-- ============================================================================
WITH pend AS (
  SELECT t.*,
         t.paystack_data->>'provider_order_id' AS provider_ref,
         EXTRACT(day FROM now() - t.created_at)::int AS age_days
  FROM transactions t
  WHERE t.status = 'pending' AND t.created_at < now() - interval '48 hours'
),
classified AS (
  SELECT p.*,
    CASE
      -- The obligation this payment targeted is already settled by a DIFFERENT
      -- payment. The day is paid; this row is a superseded attempt.
      WHEN p.related_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM contributions c
         WHERE c.id = p.related_id AND c.status = 'paid'
           AND EXISTS (SELECT 1 FROM payment_allocations pa
                        WHERE pa.contribution_id = c.id AND pa.reference <> p.reference))
        THEN 'DUPLICATE'
      -- No provider reference means the prompt never reached NaloPay, so no
      -- money can have moved against it and there is nothing to ask about.
      WHEN p.provider_ref IS NULL THEN 'NEVER_REACHED_PROVIDER'
      ELSE 'UNKNOWN_REQUIRES_REVIEW'
    END AS classification
  FROM pend p
)
SELECT classification,
       type::text AS payment_type,
       count(*)   AS n,
       sum(amount)::numeric(12,2) AS value,
       min(age_days) AS youngest_days,
       max(age_days) AS oldest_days
FROM classified
GROUP BY 1, 2
ORDER BY 1, 4 DESC;
