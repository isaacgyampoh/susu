-- Member X with three memberships, for the Profile and Payments regression.
-- Marked P11 so teardown finds exactly its own rows.
INSERT INTO susu_groups (name, contribution_amount, contribution_frequency, cycle_days,
                         max_members, current_members, registration_fee, status, start_date, cashout_amount)
SELECT 'P11-'||x.tag, x.amt, 'daily', 30, 20, 0, 0, 'active', CURRENT_DATE - 5, x.amt * 29
FROM (VALUES ('A',100.00),('B',150.00),('C',50.00)) AS x(tag, amt);

INSERT INTO members (full_name, phone, ghana_card_number, status, member_id, passcode_hash,
                     email, occupation, residential_address)
VALUES ('P11 Member X', '+233555444001', 'GHA-P11-X', 'active', 'P11-X',
        hash_passcode('284617'), 'x@example.invalid', 'Trader', 'Accra');

INSERT INTO group_memberships (member_id, group_id, payout_position, status, joined_at, slot_fraction, payout_date, payout_amount)
SELECT m.id, g.id, row_number() OVER (ORDER BY g.name), 'active', now(), 1,
       CURRENT_DATE + 30, g.cashout_amount
FROM members m, susu_groups g
WHERE m.member_id = 'P11-X' AND g.name LIKE 'P11-%';

-- A has the OLDEST due dates, C the newest. Ordered by due_date DESC and capped
-- at 20 rows, the old Payments page would have shown only C.
INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status, cycle_number, amount_paid)
SELECT gm.member_id, gm.group_id, gm.id, g.contribution_amount,
       CURRENT_DATE + d + (CASE right(g.name,1) WHEN 'A' THEN 0 WHEN 'B' THEN 30 ELSE 60 END),
       'pending', 1, 0
FROM group_memberships gm JOIN susu_groups g ON g.id = gm.group_id
CROSS JOIN generate_series(0, 24) d
WHERE g.name LIKE 'P11-%';

SELECT json_build_object(
  'member', (SELECT id FROM members WHERE member_id='P11-X'),
  'ms_a',   (SELECT gm.id FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id WHERE g.name='P11-A'),
  'ms_b',   (SELECT gm.id FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id WHERE g.name='P11-B'),
  'ms_c',   (SELECT gm.id FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id WHERE g.name='P11-C')
) AS fixture;
