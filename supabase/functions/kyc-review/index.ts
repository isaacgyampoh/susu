import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS, smsTemplates }   from '../_shared/africas-talking.ts'

const PORTAL_URL = Deno.env.get('FRONTEND_URL') ?? 'https://susuplatform.vercel.app'

/** Generate a random 6-digit passcode */
function generatePasscode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const url    = new URL(req.url)
    const kycId  = url.searchParams.get('id')
    const { action, rejection_reason } = await req.json()

    if (!kycId)                         return error('KYC application ID is required')
    if (!['approve','reject'].includes(action)) return error('action must be approve or reject')

    // Fetch the KYC application
    const { data: kyc, error: kycErr } = await supabaseAdmin
      .from('kyc_applications')
      .select('*, susu_groups(name, max_members, current_members, registration_fee)')
      .eq('id', kycId)
      .single()

    if (kycErr || !kyc) return error('KYC application not found', 404)
    if (kyc.status !== 'pending')       return error('Application has already been reviewed')
    if (!kyc.registration_fee_paid && kyc.registration_fee_amount > 0) {
      return error('Registration fee has not been paid yet')
    }

    if (action === 'reject') {
      await supabaseAdmin
        .from('kyc_applications')
        .update({ status: 'rejected', rejection_reason, reviewer_id: admin.sub, reviewed_at: new Date().toISOString() })
        .eq('id', kycId)

      // Notify applicant via SMS
      await sendSMS(kyc.phone, smsTemplates.applicationRejected(kyc.full_name, rejection_reason ?? 'Application did not meet requirements'))

      return json({ message: 'Application rejected and applicant notified' })
    }

    // APPROVE — create member account
    // Check group still has space
    const group = kyc.susu_groups
    if (group.current_members >= group.max_members) {
      return error('Group is now full. Cannot approve.', 400)
    }

    // Generate passcode
    const passcode = generatePasscode()

    // Hash passcode using Postgres crypt via RPC
    const { data: hashData } = await supabaseAdmin
      .rpc('hash_passcode', { p_passcode: passcode })
      .single()

    // Create member record
    const { data: member, error: memErr } = await supabaseAdmin
      .from('members')
      .insert({
        full_name:             kyc.full_name,
        phone:                 kyc.phone,
        email:                 kyc.email,
        whatsapp_number:       kyc.mobile_money_number ?? kyc.phone,
        ghana_card_number:     kyc.ghana_card_number,
        ghana_card_front_url:  kyc.ghana_card_front_url,
        ghana_card_back_url:   kyc.ghana_card_back_url,
        passcode_hash:         hashData ?? passcode, // fallback if RPC not set up
        status:                'active',
        date_of_birth:         kyc.date_of_birth,
        occupation:            kyc.occupation,
        residential_address:   kyc.residential_address,
        bank_name:             kyc.bank_name,
        bank_account_number:   kyc.bank_account_number,
        bank_account_name:     kyc.bank_account_name,
        mobile_money_number:   kyc.mobile_money_number,
        mobile_money_provider: kyc.mobile_money_provider,
      })
      .select('id, member_id')
      .single()

    if (memErr) return error(memErr.message, 500)

    // Assign to group — next available payout position
    const { data: existingSlots } = await supabaseAdmin
      .from('group_memberships')
      .select('payout_position')
      .eq('group_id', kyc.selected_group_id)
      .order('payout_position', { ascending: false })
      .limit(1)

    const nextPosition = (existingSlots?.[0]?.payout_position ?? 0) + 1

    await supabaseAdmin.from('group_memberships').insert({
      member_id:      member.id,
      group_id:       kyc.selected_group_id,
      payout_position: nextPosition,
      status:         'active',
    })

    // Update KYC record
    await supabaseAdmin
      .from('kyc_applications')
      .update({
        status:            'approved',
        reviewer_id:       admin.sub,
        reviewed_at:       new Date().toISOString(),
        created_member_id: member.id,
      })
      .eq('id', kycId)

    // Record registration fee transaction
    if (kyc.registration_fee_ref) {
      await supabaseAdmin.from('transactions').insert({
        member_id:    member.id,
        type:         'registration_fee',
        amount:       kyc.registration_fee_amount,
        reference:    kyc.registration_fee_ref,
        description:  `Registration fee for group: ${group.name}`,
        status:       'success',
      })
    }

    // Send welcome SMS with credentials
    await sendSMS(
      kyc.phone,
      smsTemplates.applicationApproved(
        kyc.full_name,
        member.member_id,
        passcode,
        `${PORTAL_URL}/login`
      )
    )

    // Log notification
    await supabaseAdmin.from('notifications').insert({
      member_id: member.id,
      type:      'sms',
      message:   `Welcome SMS sent with credentials`,
      status:    'sent',
      sent_at:   new Date().toISOString(),
    })

    return json({
      message:   'Member approved and credentials sent via SMS',
      member_id: member.member_id,
      member_db_id: member.id,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
