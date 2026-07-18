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
        .map((id: string) => ({ id, name: nameMap[id] ?? a.susu_groups?.name ?? '—' })),
    }))
    return json(enriched)
  }

  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const url    = new URL(req.url)
    const kycId  = url.searchParams.get('id')
    const { action, rejection_reason } = await req.json()

    if (!kycId) return error('KYC application ID required')
    if (!['approve', 'reject'].includes(action)) return error('action must be approve or reject')

    const { data: kyc } = await supabaseAdmin
      .from('kyc_applications')
      .select('*, susu_groups(id, name, max_members, current_members)')
      .eq('id', kycId)
      .single()

    if (!kyc) return error('KYC application not found', 404)
    if (kyc.status !== 'pending') return error('Application already reviewed')

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
      .from('susu_groups').select('id, name, max_members, current_members')
      .in('id', targetIds)

    const openTargets = (targetGroups ?? []).filter(g => g.current_members < g.max_members)
    const fullTargets = (targetGroups ?? []).filter(g => g.current_members >= g.max_members)
    if (openTargets.length === 0) return error('All selected groups are now full', 400)

    const passcode = generatePasscode()

    // Hash the passcode using Postgres
    const { data: hashData } = await supabaseAdmin.rpc('hash_passcode', { p_passcode: passcode })

    // Create member
    const { data: member, error: memErr } = await supabaseAdmin
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

    if (memErr) return error(memErr.message, 500)

    // Assign next available payout position in each open group
    const assignments: { group: string; payout_position: number }[] = []
    for (const g of openTargets) {
      const { data: slots } = await supabaseAdmin
        .from('group_memberships').select('payout_position')
        .eq('group_id', g.id)
        .order('payout_position', { ascending: false }).limit(1)

      const nextPosition = (slots?.[0]?.payout_position ?? 0) + 1

      await supabaseAdmin.from('group_memberships').insert({
        member_id: member.id, group_id: g.id,
        payout_position: nextPosition, status: 'active',
      })
      assignments.push({ group: g.name, payout_position: nextPosition })
    }

    // Update KYC
    await supabaseAdmin.from('kyc_applications')
      .update({ status: 'approved', reviewer_id: admin.sub, reviewed_at: new Date().toISOString(), created_member_id: member.id })
      .eq('id', kycId)

    // Send welcome SMS (skipped silently if no AT key)
    await sendSMS(kyc.phone, smsTemplates.applicationApproved(kyc.full_name, member.member_id, passcode, SIGNIN_URL))

    return json({
      message:    'Member approved and credentials sent via SMS',
      member_id:  member.member_id,
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
