import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS, smsTemplates }   from '../_shared/africas-talking.ts'

/*
 * Onboard a member who was ALREADY running susu before this system existed.
 *
 * Unlike admin-add-member (which starts a member from zero), this endpoint
 * accepts what has already happened: how much they have paid so far, when
 * they started, their payout position/date/amount, and whether the payout
 * has already been received. It writes that history into the ledger as
 * backfilled 'paid' contributions so balances, stamp cards and reports all
 * agree with reality, then schedules the road ahead.
 *
 * Body (JSON):
 * {
 *   member_id?:  uuid                     // use an existing member…
 *   new_member?: { full_name, phone, ghana_card_number,
 *                  mobile_money_number?, mobile_money_provider?, email? }
 *   plans: [{
 *     group_id:          uuid
 *     start_date:        'YYYY-MM-DD'     // when they began contributing
 *     amount_paid:       number           // total paid so far (GHS)
 *     payout_position?:  number           // omitted = next free slot
 *     payout_date?:      'YYYY-MM-DD'
 *     payout_amount?:    number           // omitted = group cashout_amount
 *     payout_received?:  boolean
 *     schedule_end_date?: 'YYYY-MM-DD'    // pending rows generated up to here
 *                                         // (defaults to payout_date)
 *   }]
 * }
 */

const MEMBER_URL = Deno.env.get('MEMBER_URL') ?? 'https://my.abbiewealthsusu.com'
const SIGNIN_URL = `${MEMBER_URL}/m/login`

function generatePasscode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const body = await req.json()
    const plans = Array.isArray(body.plans) ? body.plans : []
    if (plans.length === 0) return error('At least one plan is required')

    const today = new Date().toISOString().split('T')[0]

    // ── Resolve the member: existing, or create a new record ──
    let member: { id: string; member_id: string; full_name: string; phone: string }
    let passcode: string | null = null

    if (body.member_id) {
      const { data: existing, error: mErr } = await supabaseAdmin
        .from('members')
        .select('id, member_id, full_name, phone')
        .eq('id', body.member_id)
        .single()
      if (mErr || !existing) return error('Member not found', 404)
      member = existing
    } else if (body.new_member?.full_name && body.new_member?.phone && body.new_member?.ghana_card_number) {
      const nm = body.new_member
      const normPhone = String(nm.phone).trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')

      const { data: dup } = await supabaseAdmin
        .from('members').select('id, member_id, full_name')
        .eq('phone', normPhone).maybeSingle()
      if (dup) return error(`A member with this phone already exists: ${dup.member_id} (${dup.full_name}). Choose "Existing member" instead.`, 409)

      passcode = generatePasscode()
      const { data: hashData } = await supabaseAdmin.rpc('hash_passcode', { p_passcode: passcode })

      const { data: created, error: cErr } = await supabaseAdmin
        .from('members')
        .insert({
          full_name: nm.full_name,
          phone: normPhone,
          whatsapp_number: normPhone,
          ghana_card_number: nm.ghana_card_number,
          email: nm.email || null,
          mobile_money_number:   nm.mobile_money_number || null,
          mobile_money_provider: nm.mobile_money_provider || null,
          passcode_hash: hashData ?? passcode,
          status: 'active',
        })
        .select('id, member_id, full_name, phone')
        .single()
      if (cErr) return error(cErr.message, 500)
      member = created
    } else {
      return error('Provide member_id (existing member) or new_member details')
    }

    // ── Process each plan ──
    const results: any[] = []

    for (const plan of plans) {
      const { group_id, start_date } = plan
      const amount_paid = Number(plan.amount_paid ?? 0)
      if (!group_id || !start_date) return error('Each plan needs group_id and start_date')
      if (start_date > today)       return error('start_date cannot be in the future')
      if (amount_paid < 0)          return error('amount_paid cannot be negative')

      const slots = Math.max(1, Math.min(10, Number(plan.slots ?? 1)))

      const { data: group } = await supabaseAdmin
        .from('susu_groups')
        .select('id, name, contribution_amount, cycle_days, max_members, current_members, cashout_amount, status')
        .eq('id', group_id).single()
      if (!group) return error(`Group not found: ${group_id}`, 404)

      if (group.current_members + slots > group.max_members) {
        return error(`Group "${group.name}" only has ${group.max_members - group.current_members} slot(s) left — cannot take ${slots}`, 400)
      }

      // Positions currently taken in this group
      const { data: taken } = await supabaseAdmin
        .from('group_memberships').select('payout_position')
        .eq('group_id', group_id)
      const usedSlots = new Set((taken ?? []).map((r: any) => r.payout_position))

      // The recorded amount is the member's TOTAL across all their slots;
      // split it evenly, giving any rounding remainder to the last slot.
      const perSlot = slots > 1 ? Math.floor((amount_paid / slots) * 100) / 100 : amount_paid
      let backfilledTotal = 0
      const slotResults: any[] = []

      for (let sIdx = 0; sIdx < slots; sIdx++) {
        // First slot may use the requested position; extras take next free
        let position = sIdx === 0 && plan.payout_position ? Number(plan.payout_position) : 0
        if (position && usedSlots.has(position)) {
          return error(`Payout position #${position} in "${group.name}" is already taken`, 409)
        }
        if (!position) {
          position = 1
          while (usedSlots.has(position)) position++
        }
        usedSlots.add(position)

        const payout_amount   = plan.payout_amount != null ? Number(plan.payout_amount) : Number(group.cashout_amount ?? 0)
        // Payout date/received apply to the FIRST slot; set the others
        // per-slot afterwards from the member's page.
        const payout_date     = sIdx === 0 ? (plan.payout_date || null) : null
        const payout_received = sIdx === 0 ? !!plan.payout_received : false

        const slotAmount = sIdx === slots - 1
          ? Math.round((amount_paid - perSlot * (slots - 1)) * 100) / 100
          : perSlot

        // ── Membership, joined_at backdated to when they actually started ──
        const gmRow: Record<string, unknown> = {
          member_id: member.id, group_id,
          payout_position: position,
          payout_date, payout_amount, payout_received,
          status: 'active',
          joined_at: `${start_date}T00:00:00Z`,
          onboarded_existing: true,
        }
        let { data: membership, error: gmErr } = await supabaseAdmin
          .from('group_memberships').insert(gmRow).select('id').single()
        if (gmErr && /onboarded_existing/.test(gmErr.message)) {
          delete gmRow.onboarded_existing
          ;({ data: membership, error: gmErr } = await supabaseAdmin
            .from('group_memberships').insert(gmRow).select('id').single())
        }
        if (gmErr || !membership) return error(`Membership failed for "${group.name}": ${gmErr?.message}`, 500)

        // ── Backfill PAID contributions for this slot, daily from start ──
        const daily = Number(group.contribution_amount)
        const fullDays  = daily > 0 ? Math.floor(slotAmount / daily) : 0
        const remainder = daily > 0 ? Math.round((slotAmount - fullDays * daily) * 100) / 100 : 0

        const rows: any[] = []
        for (let i = 0; i < fullDays; i++) {
          const due = addDays(start_date, i)
          rows.push({
            member_id: member.id, group_id, membership_id: membership.id,
            amount: daily, due_date: due, paid_at: `${due}T12:00:00Z`,
            status: 'paid', cycle_number: Math.floor(i / group.cycle_days) + 1,
            is_backfilled: true,
          })
        }
        if (remainder > 0) {
          const due = addDays(start_date, fullDays)
          rows.push({
            member_id: member.id, group_id, membership_id: membership.id,
            amount: remainder, due_date: due, paid_at: `${due}T12:00:00Z`,
            status: 'paid', cycle_number: Math.floor(fullDays / group.cycle_days) + 1,
            is_backfilled: true,
          })
        }

        // ── Forward PENDING schedule up to schedule_end (default payout_date) ──
        const scheduleEnd = plan.schedule_end_date || payout_date
        if (scheduleEnd) {
          const historyEnd = addDays(start_date, fullDays + (remainder > 0 ? 1 : 0) - 1)
          let cursor = historyEnd >= today ? addDays(historyEnd, 1) : today
          let i = fullDays + (remainder > 0 ? 1 : 0)
          while (cursor <= scheduleEnd) {
            rows.push({
              member_id: member.id, group_id, membership_id: membership.id,
              amount: daily, due_date: cursor,
              status: 'pending', cycle_number: Math.floor(i / group.cycle_days) + 1,
            })
            cursor = addDays(cursor, 1); i++
          }
        }

        for (let i = 0; i < rows.length; i += 400) {
          let chunk = rows.slice(i, i + 400)
          let { error: cErr } = await supabaseAdmin.from('contributions').insert(chunk)
          if (cErr && /is_backfilled/.test(cErr.message)) {
            chunk = chunk.map(({ is_backfilled: _drop, ...rest }) => rest)
            ;({ error: cErr } = await supabaseAdmin.from('contributions').insert(chunk))
          }
          if (cErr) return error(`Contribution backfill failed for "${group.name}": ${cErr.message}`, 500)
        }

        // ── Payout record ──
        if (payout_date || payout_received) {
          await supabaseAdmin.from('payouts').insert({
            member_id: member.id, group_id, membership_id: membership.id,
            total_amount: payout_amount,
            scheduled_date: payout_date ?? today,
            status: payout_received ? 'paid' : 'upcoming',
            paid_at: payout_received ? new Date().toISOString() : null,
            notes: 'Created during onboarding of existing member',
          })
        }

        backfilledTotal += fullDays + (remainder > 0 ? 1 : 0)
        slotResults.push({ payout_position: position, payout_date, amount: slotAmount })
      }

      // ── Audit trail: one summary transaction for the historical money ──
      if (amount_paid > 0) {
        await supabaseAdmin.from('transactions').insert({
          member_id: member.id, type: 'contribution', amount: amount_paid,
          reference: `ONBOARD-${member.id.slice(0, 8)}-${group_id.slice(0, 8)}-${Date.now()}`,
          description: `Historical contributions for "${group.name}"${slots > 1 ? ` across ${slots} slots` : ''} (onboarded existing member, started ${start_date})`,
          status: 'success',
        })
      }

      results.push({
        group: group.name,
        slots,
        slot_details: slotResults,
        payout_position: slotResults[0]?.payout_position,
        payout_date: slotResults[0]?.payout_date ?? null,
        payout_amount: plan.payout_amount != null ? Number(plan.payout_amount) : Number(group.cashout_amount ?? 0),
        payout_received: !!plan.payout_received,
        contributions_backfilled: backfilledTotal,
        amount_recorded: amount_paid,
      })
    }

    // Welcome SMS only when we created a fresh account AND the admin wants
    // it sent now; otherwise it waits for the bulk invite.
    const sendCreds = body.send_credentials !== false
    if (passcode && sendCreds) {
      await sendSMS(member.phone, smsTemplates.welcome(member.full_name, member.member_id, passcode, SIGNIN_URL))
      await supabaseAdmin.from('members')
        .update({ credentials_sent_at: new Date().toISOString() })
        .eq('id', member.id)
        .then(({ error: e }) => { if (e) console.log('credentials_sent_at skipped:', e.message) })
    }

    return json({
      message: 'Member onboarded with existing history',
      member: { id: member.id, member_id: member.member_id, full_name: member.full_name, phone: member.phone },
      passcode,                      // null when member already existed
      portal_url: SIGNIN_URL,
      plans: results,
    }, 201)
  } catch (e) {
    console.error(e)
    return error('Internal server error: ' + (e as Error).message, 500)
  }
})
