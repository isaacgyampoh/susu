BEGIN;
CREATE TEMP TABLE cap(ord serial, scenario text, fee numeric, confirmed numeric,
                      replay boolean, o_settled boolean, o_already boolean,
                      o_short boolean, o_applied numeric, fee_paid_after boolean);

DO $do$
DECLARE
  s   record;
  gid uuid;
  kid uuid;
  r   record;
  ref text;
BEGIN
  SELECT id INTO gid FROM susu_groups WHERE status='open' LIMIT 1;
  FOR s IN
    SELECT * FROM (VALUES
      ('exact payment',                   150.00, 150.00,  false),
      ('grossed up by service charge',    150.00, 152.25,  false),
      ('one pesewa short',                150.00, 149.99,  false),
      ('a third short',                   150.00, 100.00,  false),
      ('massively short',                 150.00,   1.00,  false),
      ('generous overpayment',            150.00, 500.00,  false),
      ('replayed after settling',         150.00, 152.25,  true),
      ('small fee, exact',                  1.00,   1.00,  false),
      ('large fee, exact',                995.00, 995.00,  false),
      ('large fee, short by one cedi',    995.00, 994.00,  false)
    ) AS v(scenario, fee, confirmed, replay)
  LOOP
    ref := 'CAP-' || replace(gen_random_uuid()::text, '-', '');

    INSERT INTO kyc_applications (full_name, phone, ghana_card_number, selected_group_id,
                                  selected_group_ids, registration_fee_amount, status)
    VALUES ('Capture', '+2335550'||lpad((random()*99999)::int::text,5,'0'), 'GHA-CAP',
            gid, ARRAY[gid], s.fee, 'pending')
    RETURNING id INTO kid;

    INSERT INTO transactions (type, amount, reference, status, kyc_application_id, description)
    VALUES ('registration_fee', s.fee, ref, 'pending', kid, 'capture');

    IF s.replay THEN
      PERFORM settle_registration_fee(ref, s.confirmed);
    END IF;

    SELECT * INTO r FROM settle_registration_fee(ref, s.confirmed);

    INSERT INTO cap(scenario, fee, confirmed, replay, o_settled, o_already, o_short, o_applied, fee_paid_after)
    SELECT s.scenario, s.fee, s.confirmed, s.replay,
           r.o_settled, r.o_already, r.o_short, r.o_applied,
           (SELECT COALESCE(registration_fee_paid,false) FROM kyc_applications WHERE id = kid);
  END LOOP;
END
$do$;

SELECT json_agg(json_build_object(
  'scenario', scenario, 'fee', fee::text, 'confirmed', confirmed::text,
  'replay', replay, 'settled', o_settled, 'already', o_already, 'short', o_short,
  'applied', o_applied::text, 'fee_paid_after', fee_paid_after) ORDER BY ord) AS fixture
FROM cap;
ROLLBACK;
