-- Two complete, independent members for the authorization suite.
-- Marked P08-IDOR so the teardown finds exactly its own rows.
INSERT INTO susu_groups (name, contribution_amount, contribution_frequency, cycle_days,
                         max_members, current_members, registration_fee, status, start_date, cashout_amount)
VALUES ('P08-IDOR-A', 100.00, 'daily', 30, 10, 0, 50, 'active', CURRENT_DATE - 1, 2900),
       ('P08-IDOR-B', 150.00, 'daily', 30, 10, 0, 50, 'active', CURRENT_DATE - 1, 4350);

INSERT INTO members (full_name, phone, ghana_card_number, status, member_id, passcode_hash)
VALUES ('P08 Member A', '+233555333001', 'GHA-P08-A', 'active', 'P08-A', hash_passcode('471023')),
       ('P08 Member B', '+233555333002', 'GHA-P08-B', 'active', 'P08-B', hash_passcode('938157'));

INSERT INTO group_memberships (member_id, group_id, payout_position, status, joined_at, slot_fraction, payout_date, payout_amount)
SELECT m.id, g.id, 1, 'active', now(), 1, CURRENT_DATE + 30, g.cashout_amount
FROM members m JOIN susu_groups g
  ON (m.member_id='P08-A' AND g.name='P08-IDOR-A') OR (m.member_id='P08-B' AND g.name='P08-IDOR-B');

INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status, cycle_number, amount_paid)
SELECT gm.member_id, gm.group_id, gm.id, g.contribution_amount, CURRENT_DATE + d, 'pending', 1, 0
FROM group_memberships gm JOIN susu_groups g ON g.id = gm.group_id
CROSS JOIN generate_series(0, 4) d
WHERE g.name IN ('P08-IDOR-A','P08-IDOR-B');

-- One settled payment each, so there is a payment and an allocation to try to reach.
INSERT INTO transactions (member_id, type, amount, reference, status, related_id, paystack_data)
SELECT gm.member_id, 'contribution', g.contribution_amount, 'P08-IDOR-'||right(g.name,1), 'pending',
       (SELECT c.id FROM contributions c WHERE c.membership_id=gm.id ORDER BY c.due_date LIMIT 1),
       jsonb_build_object('scope','slot')
FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id
WHERE g.name IN ('P08-IDOR-A','P08-IDOR-B');

SELECT count(*) FROM settle_payment('P08-IDOR-A', 100.00, 'slot', CURRENT_DATE, NULL);
SELECT count(*) FROM settle_payment('P08-IDOR-B', 150.00, 'slot', CURRENT_DATE, NULL);

-- A registration application for each, with a capability token.
INSERT INTO kyc_applications (full_name, phone, ghana_card_number, selected_group_id, selected_group_ids,
                              registration_fee_amount, status, payment_token_hash, payment_token_expires_at)
SELECT v.n, v.p, 'GHA-P08-KYC', g.id, ARRAY[g.id], 50.00, 'pending',
       encode(digest(v.tok,'sha256'),'hex'), now() + interval '7 days'
FROM susu_groups g, (VALUES
  ('P08 Applicant A','+233555333003','p08-token-A','P08-IDOR-A'),
  ('P08 Applicant B','+233555333004','p08-token-B','P08-IDOR-B')) AS v(n,p,tok,grp)
WHERE g.name = v.grp;

SELECT json_build_object(
  'member_a', (SELECT id FROM members WHERE member_id='P08-A'),
  'member_b', (SELECT id FROM members WHERE member_id='P08-B'),
  'membership_a', (SELECT gm.id FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id WHERE g.name='P08-IDOR-A'),
  'membership_b', (SELECT gm.id FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id WHERE g.name='P08-IDOR-B'),
  'contribution_a', (SELECT c.id FROM contributions c JOIN group_memberships gm ON gm.id=c.membership_id
                     JOIN susu_groups g ON g.id=gm.group_id WHERE g.name='P08-IDOR-A' AND c.status<>'paid' ORDER BY c.due_date LIMIT 1),
  'contribution_b', (SELECT c.id FROM contributions c JOIN group_memberships gm ON gm.id=c.membership_id
                     JOIN susu_groups g ON g.id=gm.group_id WHERE g.name='P08-IDOR-B' AND c.status<>'paid' ORDER BY c.due_date LIMIT 1),
  'kyc_a', (SELECT id FROM kyc_applications WHERE full_name='P08 Applicant A'),
  'kyc_b', (SELECT id FROM kyc_applications WHERE full_name='P08 Applicant B')
) AS fixture;
