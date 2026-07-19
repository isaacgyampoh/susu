import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS, smsTemplates }   from '../_shared/africas-talking.ts'

// The member portal is a different hostname from the console. Deriving it from
// FRONTEND_URL produced admin.abbiewealthsusu.com/m/login — a 404 in the
// member's hand, because middleware blocks /m/* on the admin host.
const MEMBER_URL = Deno.env.get('MEMBER_URL') ?? 'https://my.abbiewealthsusu.com'
const SIGNIN_URL = `${MEMBER_URL}/m/login`

function generatePasscode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  // Support both GET (list KYC) and POST (review action)
  if (req.method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin) return error('Unauthorized', 401)
    const url    = new URL(req.url)
    const status = url.searchParams.get('status') ?? 'pending'

    let query = supabaseAdmin
      .from('kyc_applications')
      .select('*, susu_groups(id, name, registration_fee)')
      .order('submitted_at', { ascending: false })

    if (status !== 'all') query = query.eq('status', status)
    const { data, error: dbErr } = await query
    if (dbErr) return error(dbErr.message, 500)

    // Resolve names for multi-group selections
    const allIds = [...new Set((data ?? []).flatMap((a: any) => a.selected_group_ids ?? []))]
    let nameMap: Record<string, string> = {}
    if (allIds.length > 0) {
      const { data: gs } = await supabaseAdmin.from('susu_groups').select('id, name').in('id', allIds)
      nameMap = Object.fromEntries((gs ?? []).map((g: any) => [g.id, g.name]))
    }
    const enriched = (data ?? []).map((a: any) => ({
      ...a,
      selected_groups: (a.selected_group_ids ?? [a.selected_group_id]).filter(Boolean)
        .map((id: string) => ({
          id,
          name: nameMap[id] ?? a.susu_groups?.name ?? '—',
          slots: Math.max(1, Number(a.selected_slots?.[id]?.count ?? a.selected_slots?.[id] ?? 1)),
          fraction: Number(a.selected_slots?.[id]?.fraction ?? 1),
        })),
    }))
    return json(enriched)
  }

  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const url    = new URL(req.url)
    const kycId  = url.searchParams.get('id')
    const body = await req.json()
    const { action, rejection_reason } = body

    if (!kycId) return error('KYC application ID required')
    if (!['approve', 'reject', 'mark_fee_paid'].includes(action)) return error('action must be approve, reject or mark_fee_paid')

    const { data: kyc } = await supabaseAdmin
      .from('kyc_applications')
      .select('*, susu_groups(id, name, max_members, current_members)')
      .eq('id', kycId)
      .single()

    if (!kyc) return error('KYC application not found', 404)
    if (kyc.status !== 'pending') return error('Application already reviewed')

    if (action === 'mark_fee_paid') {
      if (kyc.registration_fee_paid) return error('Registration fee is already marked paid', 400)

      await supabaseAdmin.from('kyc_applications')
        .update({ registration_fee_paid: true })
        .eq('id', kycId)

      // If they're already a member (approved), put it on their money record
      const feeAmount = Number(kyc.registration_fee_amount ?? 0)
      if (kyc.created_member_id && feeAmount > 0) {
        await supabaseAdmin.from('transactions').insert({
          member_id: kyc.created_member_id, type: 'registration_fee',
          amount: feeAmount,
          reference: `REG-MANUAL-${String(kycId).slice(0, 8)}-${Date.now()}`,
          description: `Registration fee received manually (marked by admin)`,
          status: 'success',
        })
      }
      await sendSMS(kyc.phone, `Hi ${kyc.full_name.split(' ')[0]}, we received your registration fee of GHS ${feeAmount.toLocaleString()}. Thank you!`)
      return json({ message: 'Registration fee marked as paid' })
    }

    if (action === 'reject') {
      await supabaseAdmin.from('kyc_applications')
        .update({ status: 'rejected', rejection_reason, reviewer_id: admin.sub, reviewed_at: new Date().toISOString() })
        .eq('id', kycId)
      await sendSMS(kyc.phone, smsTemplates.applicationRejected(kyc.full_name, rejection_reason ?? 'Application did not meet requirements'))
      return json({ message: 'Application rejected' })
    }

    // APPROVE — the applicant may have chosen several groups
    const targetIds: string[] = (kyc.selected_group_ids && kyc.selected_group_ids.length > 0)
      ? kyc.selected_group_ids
      : [kyc.selected_group_id]

    const { data: targetGroups } = await supabaseAdmin
      .from('susu_groups').select('id, name, max_members, current_members, cashout_amount')
      .in('id', targetIds)

    // Payout dates chosen by the admin at approval time. Preferred shape is
    // per slot — body.payout_dates_slots = { "<group_id>": ["d1","d2",...] } —
    // with the older per-group shape kept as slot 1's date.
    const legacyDates: Record<string, string> = body.payout_dates ?? {}
    const slotDates: Record<string, string[]> = body.payout_dates_slots ?? {}
    const dateForSlot = (gid: string, i: number): string | null =>
      slotDates[gid]?.[i] || (i === 0 ? (legacyDates[gid] || null) : null)

    const slotWanted = (gid: string) => Math.max(1, Math.min(10, Number(kyc.selected_slots?.[gid]?.count ?? kyc.selected_slots?.[gid] ?? 1)))
    const fracWanted = (gid: string) => [0.25, 0.5, 1].includes(Number(kyc.selected_slots?.[gid]?.fraction)) ? Number(kyc.selected_slots[gid].fraction) : 1
    const openTargets = (targetGroups ?? []).filter(g => g.current_members + slotWanted(g.id) <= g.max_members)
    const fullTargets = (targetGroups ?? []).filter(g => g.current_members + slotWanted(g.id) > g.max_members)
    if (openTargets.length === 0) return error('All selected groups are now full', 400)

    // An applicant may already be a member (added manually, or applying for
    // MORE groups from the website). Reuse their account instead of tripping
    // the unique-phone constraint.
    const normPhone = String(kyc.phone ?? '').trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')
    const { data: existingMember } = await supabaseAdmin
      .from('members').select('id, member_id, full_name, status')
      .in('phone', [kyc.phone, normPhone].filter(Boolean))
      .maybeSingle()

    let member: { id: string; member_id: string }
    let passcode: string | null = null

    if (existingMember) {
      if (existingMember.status !== 'active') {
        return error(`${existingMember.full_name} (${existingMember.member_id}) already exists but is ${existingMember.status}. Reactivate them on their member page, then approve.`, 409)
      }
      member = existingMember
    } else {
    passcode = generatePasscode()

    // Hash the passcode using Postgres
    const { data: hashData } = await supabaseAdmin.rpc('hash_passcode', { p_passcode: passcode })

    // Create member
    const { data: created, error: memErr } = await supabaseAdmin
      .from('members')
      .insert({
        full_name: kyc.full_name, phone: kyc.phone, email: kyc.email,
        whatsapp_number: kyc.mobile_money_number ?? kyc.phone,
        ghana_card_number: kyc.ghana_card_number,
        ghana_card_front_url: kyc.ghana_card_front_url,
        ghana_card_back_url:  kyc.ghana_card_back_url,
        passcode_hash: hashData ?? passcode,
        status: 'active',
        date_of_birth: kyc.date_of_birth, occupation: kyc.occupation,
        residential_address: kyc.residential_address,
        bank_name: kyc.bank_name, bank_account_number: kyc.bank_account_number,
        bank_account_name: kyc.bank_account_name,
        mobile_money_number: kyc.mobile_money_number,
        mobile_money_provider: kyc.mobile_money_provider,
      })
      .select('id, member_id')
      .single()

    if (memErr || !created) return error(memErr?.message ?? 'Could not create member', 500)
    member = created
    }

    // Assign next available payout position in each open group
    const assignments: { group: string; payout_position: number; payout_date?: string | null }[] = []
    for (const g of openTargets) {
      const wanted = slotWanted(g.id)
      const { data: taken } = await supabaseAdmin
        .from('group_memberships').select('payout_position')
        .eq('group_id', g.id)
      const used = new Set((taken ?? []).map((r: any) => r.payout_position))

      const fraction = fracWanted(g.id)
      const payoutAmount = Math.round(Number(g.cashout_amount ?? 0) * fraction * 100) / 100
      for (let i = 0; i < wanted; i++) {
        let nextPosition = 1
        while (used.has(nextPosition)) nextPosition++
        used.add(nextPosition)

        const payoutDate = dateForSlot(g.id, i)

        const gmRow: Record<string, unknown> = {
          member_id: member.id, group_id: g.id,
          payout_position: nextPosition, status: 'active',
          payout_date: payoutDate, payout_amount: payoutAmount,
          slot_fraction: fraction,
        }
        let { data: gm, error: gmE } = await supabaseAdmin.from('group_memberships').insert(gmRow).select('id').single()
        if (gmE && /slot_fraction/.test(gmE.message)) {
          delete gmRow.slot_fraction
          ;({ data: gm } = await supabaseAdmin.from('group_memberships').insert(gmRow).select('id').single())
        }

        if (payoutDate && gm) {
          await supabaseAdmin.from('payouts').insert({
            member_id: member.id, group_id: g.id, membership_id: gm.id,
            total_amount: payoutAmount, scheduled_date: payoutDate,
            status: 'upcoming', notes: 'Scheduled at KYC approval',
          })
        }
        // Joining a RUNNING group: give this slot its payment schedule
        if (gm?.id) await supabaseAdmin.rpc('generate_membership_schedule', { p_membership_id: gm.id })
          .then(({ error: sErr }) => { if (sErr) console.log('schedule gen skipped:', sErr.message) })

        assignments.push({ group: g.name, payout_position: nextPosition, payout_date: payoutDate, slot: i + 1, of_slots: wanted })
      }
    }

    // Update KYC
    await supabaseAdmin.from('kyc_applications')
      .update({ status: 'approved', reviewer_id: admin.sub, reviewed_at: new Date().toISOString(), created_member_id: member.id })
      .eq('id', kycId)

    // Send welcome SMS (skipped silently if no AT key)
    const sendCreds = body.send_credentials !== false
    if (sendCreds) {
      if (passcode) {
        await sendSMS(kyc.phone, smsTemplates.applicationApproved(kyc.full_name, member.member_id, passcode, SIGNIN_URL))
      } else {
        const names = assignments.map(a => a.group).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')
        await sendSMS(kyc.phone, `Hi ${kyc.full_name.split(' ')[0]}, your application is approved — you've been added to ${names}. Sign in as usual: ${SIGNIN_URL}`)
      }
      if (passcode) await supabaseAdmin.from('members')
        .update({ credentials_sent_at: new Date().toISOString() })
        .eq('id', member.id)
        .then(({ error: e }) => { if (e) console.log('credentials_sent_at skipped:', e.message) })
    }

    return json({
      message:    sendCreds ? 'Member approved and credentials sent via SMS' : 'Member approved — credentials NOT sent (held for bulk invite)',
      member_id:  member.member_id,
      existing_member: !passcode,
      passcode,   // also returned in response so admin can share manually if no SMS
      portal_url: SIGNIN_URL,
      assignments,
      skipped_full_groups: fullTargets.map(g => g.name),
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
