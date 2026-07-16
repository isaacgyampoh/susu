import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { initializeTransaction, isPaystackEnabled } from '../_shared/paystack.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  try {
    const formData = await req.formData()

    const full_name         = formData.get('full_name') as string
    const phone             = formData.get('phone') as string
    const ghana_card_number = formData.get('ghana_card_number') as string
    const selected_group_id = formData.get('selected_group_id') as string

    if (!full_name || !phone || !ghana_card_number || !selected_group_id) {
      return error('full_name, phone, ghana_card_number, selected_group_id are required')
    }

    const normPhone = phone.trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')

    // Check duplicate
    const { data: existing } = await supabaseAdmin
      .from('kyc_applications')
      .select('id, status')
      .eq('phone', normPhone)
      .neq('status', 'rejected')
      .maybeSingle()
    if (existing) return error('An application with this phone number already exists', 409)

    // Verify group
    const { data: group } = await supabaseAdmin
      .from('susu_groups')
      .select('id, name, registration_fee, status, current_members, max_members')
      .eq('id', selected_group_id)
      .single()
    if (!group) return error('Group not found', 404)
    if (!['open', 'full'].includes(group.status) || group.current_members >= group.max_members) {
      return error('This group is no longer accepting new members', 400)
    }

    // Upload Ghana Card images
    let frontUrl: string | null = null
    let backUrl:  string | null = null
    const ts = Date.now()

    const frontFile = formData.get('ghana_card_front') as File | null
    const backFile  = formData.get('ghana_card_back')  as File | null

    for (const [file, label] of [[frontFile, 'Ghana Card front'], [backFile, 'Ghana Card back']] as const) {
      const bad = checkImage(file, label)
      if (bad) return error(bad, 400, req)
    }

    if (frontFile) {
      const { data: up } = await supabaseAdmin.storage
        .from('kyc-documents')
        .upload(`ghana-cards/${crypto.randomUUID()}-front`, frontFile, { contentType: frontFile.type, upsert: false })
      if (up) {
        const { data: { publicUrl } } = supabaseAdmin.storage.from('kyc-documents').getPublicUrl(up.path)
        frontUrl = publicUrl
      }
    }
    if (backFile) {
      const { data: up } = await supabaseAdmin.storage
        .from('kyc-documents')
        .upload(`ghana-cards/${crypto.randomUUID()}-back`, backFile, { contentType: backFile.type, upsert: false })
      if (up) {
        const { data: { publicUrl } } = supabaseAdmin.storage.from('kyc-documents').getPublicUrl(up.path)
        backUrl = publicUrl
      }
    }

    // Create KYC record
    const { data: kyc, error: kycErr } = await supabaseAdmin
      .from('kyc_applications')
      .insert({
        full_name, phone: normPhone,
        email:               formData.get('email') as string | null,
        date_of_birth:       formData.get('date_of_birth') as string | null,
        occupation:          formData.get('occupation') as string | null,
        residential_address: formData.get('residential_address') as string | null,
        ghana_card_number, ghana_card_front_url: frontUrl, ghana_card_back_url: backUrl,
        selected_group_id,
        mobile_money_number:   formData.get('mobile_money_number') as string | null,
        mobile_money_provider: formData.get('mobile_money_provider') as string | null,
        bank_name:             formData.get('bank_name') as string | null,
        bank_account_number:   formData.get('bank_account_number') as string | null,
        bank_account_name:     formData.get('bank_account_name') as string | null,
        registration_fee_amount: group.registration_fee,
        // If no Paystack, mark fee as paid immediately (dev/cash mode)
        registration_fee_paid: !isPaystackEnabled() || group.registration_fee === 0,
        status: 'pending',
      })
      .select('id')
      .single()

    if (kycErr) return error(kycErr.message, 500)

    // Initialize Paystack payment (if enabled and fee > 0)
    let paystackData = null
    if (isPaystackEnabled() && group.registration_fee > 0) {
      const reference  = `KYC-${kyc.id}-${ts}`
      const paystackRes = await initializeTransaction({
        email:        (formData.get('email') as string) ?? `${normPhone.replace('+', '')}@susu.platform`,
        amount:       Math.round(group.registration_fee * 100),
        reference,
        callback_url: `${Deno.env.get('FRONTEND_URL') ?? ''}/join/${selected_group_id}?ref=${reference}`,
        metadata:     { kyc_id: kyc.id, group_id: selected_group_id, type: 'registration_fee' },
      })
      if (paystackRes.status) {
        paystackData = { authorization_url: paystackRes.data.authorization_url, reference: paystackRes.data.reference }
      }
    }

    return json({
      message:  'KYC application submitted successfully',
      kyc_id:   kyc.id,
      fee:      group.registration_fee,
      fee_paid: !isPaystackEnabled(),
      paystack: paystackData,
    }, 201)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
