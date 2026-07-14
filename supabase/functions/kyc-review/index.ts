import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS, smsTemplates }   from '../_shared/africas-talking.ts'

const PORTAL_URL = Deno.env.get('FRONTEND_URL') ?? 'https://susuplatform.vercel.app'

function generatePasscode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

Deno.serve(async (req) => {
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
    return json(data)
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

    // APPROVE
    const group = kyc.susu_groups
    if (group.current_members >= group.max_members) return error('Group is now full', 400)

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

    // Assign next available payout position
    const { data: slots } = await supabaseAdmin
      .from('group_memberships').select('payout_position')
      .eq('group_id', kyc.selected_group_id)
      .order('payout_position', { ascending: false }).limit(1)

    const nextPosition = (slots?.[0]?.payout_position ?? 0) + 1

    await supabaseAdmin.from('group_memberships').insert({
      member_id: member.id, group_id: kyc.selected_group_id,
      payout_position: nextPosition, status: 'active',
    })

    // Update KYC
    await supabaseAdmin.from('kyc_applications')
      .update({ status: 'approved', reviewer_id: admin.sub, reviewed_at: new Date().toISOString(), created_member_id: member.id })
      .eq('id', kycId)

    // Send welcome SMS (skipped silently if no AT key)
    await sendSMS(kyc.phone, smsTemplates.applicationApproved(kyc.full_name, member.member_id, passcode, `${PORTAL_URL}/login`))

    return json({
      message:    'Member approved and credentials sent via SMS',
      member_id:  member.member_id,
      passcode,   // also returned in response so admin can share manually if no SMS
      portal_url: `${PORTAL_URL}/login`,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
