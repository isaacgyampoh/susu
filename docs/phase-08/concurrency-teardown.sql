-- Removes every row the concurrency fixture created, and nothing else.
DELETE FROM settlement_log      WHERE reference = 'P08-CONC-RACE';
DELETE FROM payment_allocations WHERE reference = 'P08-CONC-RACE';
DELETE FROM membership_credit_ledger WHERE source_reference = 'P08-CONC-RACE';
DELETE FROM transactions        WHERE reference = 'P08-CONC-RACE';
DELETE FROM contributions       WHERE membership_id IN (
  SELECT gm.id FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id WHERE g.name='P08-CONC');
DELETE FROM group_memberships   WHERE group_id IN (SELECT id FROM susu_groups WHERE name='P08-CONC');
DELETE FROM members             WHERE member_id = 'P08-CONC';
DELETE FROM susu_groups         WHERE name = 'P08-CONC';
SELECT 'cleaned' AS state,
       (SELECT count(*) FROM susu_groups WHERE name='P08-CONC') AS groups_left,
       (SELECT count(*) FROM transactions WHERE reference='P08-CONC-RACE') AS txs_left;
