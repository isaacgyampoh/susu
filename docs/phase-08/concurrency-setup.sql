-- Fixture for the 50-way concurrency test. Creates ONE payment worth GHS 450
-- against a 100/day membership with ten open days. Marked P08-CONC so the
-- teardown can find every row it made.
INSERT INTO susu_groups (name, contribution_amount, contribution_frequency, cycle_days,
                         max_members, current_members, registration_fee, status, start_date, cashout_amount)
VALUES ('P08-CONC', 100.00, 'daily', 30, 10, 0, 0, 'active', CURRENT_DATE - 1, 2900);

INSERT INTO members (full_name, phone, ghana_card_number, status, member_id)
VALUES ('P08 Concurrency', '+233555111222', 'GHA-P08-CONC', 'active', 'P08-CONC');

INSERT INTO group_memberships (member_id, group_id, payout_position, status, joined_at, slot_fraction)
SELECT m.id, g.id, 1, 'active', now(), 1
FROM members m, susu_groups g WHERE m.member_id='P08-CONC' AND g.name='P08-CONC';

INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status, cycle_number, amount_paid)
SELECT gm.member_id, gm.group_id, gm.id, 100.00, CURRENT_DATE + d, 'pending', 1, 0
FROM group_memberships gm JOIN susu_groups g ON g.id = gm.group_id
CROSS JOIN generate_series(0, 9) d
WHERE g.name = 'P08-CONC';

INSERT INTO transactions (member_id, type, amount, reference, status, related_id, paystack_data)
SELECT gm.member_id, 'contribution', 450.00, 'P08-CONC-RACE', 'pending',
       (SELECT c.id FROM contributions c WHERE c.membership_id = gm.id ORDER BY c.due_date LIMIT 1),
       jsonb_build_object('scope','slot')
FROM group_memberships gm JOIN susu_groups g ON g.id = gm.group_id WHERE g.name = 'P08-CONC';

SELECT 'ready' AS state,
       (SELECT count(*) FROM contributions c JOIN group_memberships gm ON gm.id=c.membership_id
         JOIN susu_groups g ON g.id=gm.group_id WHERE g.name='P08-CONC') AS open_days;
