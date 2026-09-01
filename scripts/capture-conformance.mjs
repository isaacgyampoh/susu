#!/usr/bin/env node
/**
 * Capture what the DEPLOYED database engine does, so the pure allocator can be
 * held to it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The allocation rule exists twice — as `allocatePayment()` in the domain and
 * as `settle_payment()` in PostgreSQL. That duplication is deliberate: the pure
 * one drives the pre-payment preview and is testable without a database, the
 * SQL one is authoritative because only the database can lock the rows it is
 * about to change. It is only SAFE because the two are checked against each
 * other.
 *
 * This script builds each generated scenario in the REAL production database
 * inside a transaction, runs the REAL `settle_payment()`, records the result,
 * and ROLLS BACK. Nothing survives: no member, no group, no payment, no
 * allocation, no log row. The financial checksum is identical either side.
 *
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/capture-conformance.mjs
 *
 * Writes src/domain/contribution/__fixtures__/db-generated-conformance.json,
 * which src/domain/contribution/generated-conformance.test.ts replays through
 * the pure allocator and compares, line by line, to the pesewa.
 *
 * The scenarios are produced by a SEEDED generator, so the same seeds give the
 * same scenarios on every run and a disagreement is reproducible from its seed
 * alone.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const REF   = process.env.SUPABASE_PROJECT_REF
const CASES = Number(process.env.CASES ?? 120)

if (!TOKEN || !REF) {
  console.error('Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF. Neither is read from the repository.')
  process.exit(1)
}

/** mulberry32 — the same shape the property tests use, so seeds are replayable. */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One scenario, in a shape BOTH implementations can build: a member with
 * 1–3 memberships, each carrying a run of daily obligations at its own amount,
 * some already part-paid, and one payment with a scope.
 */
function generate(seed) {
  const rand = rng(seed)
  const int  = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
  const pick = xs => xs[Math.floor(rand() * xs.length)]

  const memberships = Array.from({ length: int(1, 3) }, (_, i) => {
    const days = int(2, 8)
    return {
      tag: `g${i}`,
      // Pesewa-level and fractional-slot amounts, not just round cedis.
      dailyMinor: pick([100, 550, 1375, 2800, 5000, 6500, 10200, 15000, 20000]),
      days,
      // Leading days already settled. Capped BELOW `days` so the membership
      // always keeps at least one open obligation: a payment whose origin
      // membership is fully settled has nowhere to bank its surplus, and
      // settle_payment() correctly refuses it rather than losing the money.
      // That refusal is right, but it is not a scenario this fixture is for.
      prepaidDays: Math.min(int(0, 3), days - 1),
      partialMinor: rand() < 0.35 ? int(1, 900) : 0,
    }
  })

  return {
    seed,
    memberships,
    paymentMinor: pick([1, 50, 500, 5000, 10000, 25000, 45000, 90000, 250000]),
    scope: rand() < 0.5 ? 'slot' : 'member',
  }
}

const q = s => `'${String(s).replace(/'/g, "''")}'`
const ghs = minor => (minor / 100).toFixed(2)

/** The SQL that builds one scenario, settles it, and reports what happened. */
function scenarioSql(s) {
  const tag = `CONF-${s.seed}`
  const groups = s.memberships.map((m, i) => `
    (${q(`${tag}-${m.tag}`)}, ${ghs(m.dailyMinor)}, ${i + 1})`).join(',')

  return `
BEGIN;
INSERT INTO susu_groups (name, contribution_amount, contribution_frequency, cycle_days,
                         max_members, current_members, registration_fee, status, start_date, cashout_amount)
SELECT v.n, v.amt, 'daily', 30, 20, 0, 0, 'active', CURRENT_DATE - 1, v.amt * 29
FROM (VALUES ${groups}) AS v(n, amt, pos);

INSERT INTO members (full_name, phone, ghana_card_number, status, member_id)
VALUES (${q(tag)}, ${q('+2335' + String(700000000 + s.seed))}, ${q('GHA-' + tag)}, 'active', ${q(tag)});

INSERT INTO group_memberships (member_id, group_id, payout_position, status, joined_at, slot_fraction)
SELECT m.id, g.id, row_number() OVER (ORDER BY g.name), 'active', now(), 1
FROM members m, susu_groups g
WHERE m.member_id = ${q(tag)} AND g.name LIKE ${q(tag + '-%')};

${s.memberships.map(m => `
INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status, cycle_number, amount_paid)
SELECT gm.member_id, gm.group_id, gm.id, ${ghs(m.dailyMinor)}, CURRENT_DATE + d,
       (CASE WHEN d < ${m.prepaidDays} THEN 'paid' ELSE 'pending' END)::contribution_status, 1,
       CASE WHEN d < ${m.prepaidDays} THEN ${ghs(m.dailyMinor)}
            WHEN d = ${m.prepaidDays} THEN ${ghs(Math.min(m.partialMinor, m.dailyMinor - 1))}
            ELSE 0 END
FROM group_memberships gm JOIN susu_groups g ON g.id = gm.group_id
CROSS JOIN generate_series(0, ${m.days - 1}) d
WHERE g.name = ${q(`${tag}-${m.tag}`)};`).join('')}

INSERT INTO transactions (member_id, type, amount, reference, status, related_id, paystack_data)
SELECT gm.member_id, 'contribution', ${ghs(s.paymentMinor)}, ${q(tag)}, 'pending',
       (SELECT c.id FROM contributions c WHERE c.membership_id = gm.id AND c.status <> 'paid'
         ORDER BY c.due_date LIMIT 1),
       jsonb_build_object('scope', ${q(s.scope)})
FROM group_memberships gm JOIN susu_groups g ON g.id = gm.group_id
WHERE g.name = ${q(`${tag}-${s.memberships[0].tag}`)}
LIMIT 1;

SELECT count(*) FROM settle_payment(${q(tag)}, ${ghs(s.paymentMinor)}, ${q(s.scope)}, CURRENT_DATE, NULL);

SELECT json_build_object(
  'seed', ${s.seed},
  -- The date the schedule was built from. Recorded rather than inferred: the
  -- first ALLOCATED day is not the first day of the schedule whenever a
  -- membership starts with settled days, so a test that guesses the anchor
  -- from the allocations reports date-offset disagreements that are its own.
  'today', CURRENT_DATE::text,
  'allocations', COALESCE((
    SELECT json_agg(json_build_object(
      'group', g.name, 'due_date', pa.due_date::text,
      'amount', pa.amount::text, 'kind', pa.kind) ORDER BY pa.due_date, g.name)
    FROM payment_allocations pa JOIN susu_groups g ON g.id = pa.group_id
    WHERE pa.reference = ${q(tag)}), '[]'::json),
  'total_allocated', COALESCE((SELECT sum(pa.amount)::text FROM payment_allocations pa
                                WHERE pa.reference = ${q(tag)}), '0'),
  'credit_banked', COALESCE((SELECT sum(l.amount)::text FROM membership_credit_ledger l
                              WHERE l.source_reference = ${q(tag)}), '0'),
  'memberships_touched', (SELECT count(DISTINCT pa.membership_id) FROM payment_allocations pa
                           WHERE pa.reference = ${q(tag)})
) AS result;
ROLLBACK;`
}

async function run(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.json()
  if (!Array.isArray(body)) throw new Error(body?.message ?? JSON.stringify(body).slice(0, 300))
  return body
}

const out = []
for (let seed = 1; seed <= CASES; seed++) {
  const s = generate(seed)
  let rows
  try {
    rows = await run(scenarioSql(s))
  } catch (e) {
    console.error(`seed ${seed}: ${e.message}`)
    continue
  }
  const result = rows[0]?.result
  if (!result) { console.error(`seed ${seed}: no result`); continue }
  out.push({ scenario: s, result })
  if (seed % 20 === 0) process.stderr.write(`  ${seed}/${CASES}\n`)
}

const here = dirname(fileURLToPath(import.meta.url))
const dest = join(here, '..', 'src', 'domain', 'contribution', '__fixtures__', 'db-generated-conformance.json')
mkdirSync(dirname(dest), { recursive: true })
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n')
console.error(`captured ${out.length} scenarios → ${dest}`)
