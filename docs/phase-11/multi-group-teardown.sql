-- Removes every row the Profile/Payments regression fixture created.
DELETE FROM payment_allocations      WHERE membership_id IN (
  SELECT gm.id FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id WHERE g.name LIKE 'P11-%');
DELETE FROM membership_credit_ledger WHERE membership_id IN (
  SELECT gm.id FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id WHERE g.name LIKE 'P11-%');
DELETE FROM transactions  WHERE member_id IN (SELECT id FROM members WHERE member_id = 'P11-X');
DELETE FROM contributions WHERE membership_id IN (
  SELECT gm.id FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id WHERE g.name LIKE 'P11-%');
DELETE FROM payouts           WHERE member_id IN (SELECT id FROM members WHERE member_id = 'P11-X');
DELETE FROM group_memberships WHERE group_id IN (SELECT id FROM susu_groups WHERE name LIKE 'P11-%');
DELETE FROM login_attempts    WHERE identifier = '+233555444001';
DELETE FROM members           WHERE member_id = 'P11-X';
DELETE FROM susu_groups       WHERE name LIKE 'P11-%';

SELECT 'cleaned' AS state,
  (SELECT count(*) FROM members WHERE member_id='P11-X')      AS members_left,
  (SELECT count(*) FROM susu_groups WHERE name LIKE 'P11-%')  AS groups_left;
