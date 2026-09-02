-- Removes every row the authorization fixture created, and nothing else.
-- Audit rows are deliberately NOT removed: an audit record is history.
-- Parenthesised deliberately: without them `AND` binds tighter than `OR` and
-- the second clause stops constraining the first. The effect happened to be
-- the same here, but a teardown that only works by accident is not a teardown.
DELETE FROM settlement_log WHERE
      reference LIKE 'P08-IDOR-%'
   OR reference IN (SELECT t.reference FROM transactions t
                     JOIN kyc_applications k ON k.id = t.kyc_application_id
                    WHERE k.full_name LIKE 'P08 Applicant %');
DELETE FROM payment_allocations       WHERE reference LIKE 'P08-IDOR-%';
DELETE FROM membership_credit_ledger  WHERE source_reference LIKE 'P08-IDOR-%';
-- The registration prompt raised during the token test: never approved, so it
-- can never settle. Marked failed rather than left to join the pending queue.
DELETE FROM transactions WHERE kyc_application_id IN
  (SELECT id FROM kyc_applications WHERE full_name LIKE 'P08 Applicant %');
DELETE FROM transactions              WHERE reference LIKE 'P08-IDOR-%';
DELETE FROM kyc_applications          WHERE full_name LIKE 'P08 Applicant %';
DELETE FROM contributions             WHERE membership_id IN (
  SELECT gm.id FROM group_memberships gm JOIN susu_groups g ON g.id = gm.group_id
   WHERE g.name LIKE 'P08-IDOR-%');
DELETE FROM group_memberships         WHERE group_id IN (SELECT id FROM susu_groups WHERE name LIKE 'P08-IDOR-%');
DELETE FROM payouts                   WHERE member_id IN (SELECT id FROM members WHERE member_id LIKE 'P08-%');
DELETE FROM login_attempts            WHERE identifier IN ('+233555333001','+233555333002');
DELETE FROM members                   WHERE member_id IN ('P08-A','P08-B');
DELETE FROM susu_groups               WHERE name LIKE 'P08-IDOR-%';

SELECT 'cleaned' AS state,
  (SELECT count(*) FROM members WHERE member_id LIKE 'P08-%')            AS members_left,
  (SELECT count(*) FROM susu_groups WHERE name LIKE 'P08-%')             AS groups_left,
  (SELECT count(*) FROM kyc_applications WHERE full_name LIKE 'P08 %')   AS apps_left,
  (SELECT count(*) FROM transactions WHERE reference LIKE 'P08-IDOR-%')  AS txs_left;
