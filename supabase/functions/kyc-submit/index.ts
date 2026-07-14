import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { initializeTransaction }   from '../_shared/paystack.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return error('Method not allowed', 405)

  try {
    const formData = await req.formData()

    // Required text fields
    const full_name           = formData.get('full_name') as string
    const phone               = formData.get('phone') as string
    const ghana_card_number   = formData.get('ghana_card_number') as string
    const selected_group_id   = formData.get('selected_group_id') as string

    if (!full_name || !phone || !ghana_card_number || !selected_group_id) {
      return error('full_name, phone, ghana_card_number, selected_group_id are required')
    }

    // Optional fields
    const email               = formData.get('email') as string | null
    const date_of_birth       = formData.get('date_of_birth') as string | null
    const occupation          = formData.get('occupation') as string | null
    const residential_address = formData.get('residential_address') as string | null
    const mobile_money_number = formData.get('mobile_money_number') as string | null
    const mobile_money_provider = formData.get('mobile_money_provider') as string | null
    const bank_name           = formData.get('bank_name') as string | null
    const bank_account_number = formData.get('bank_account_number') as string | null
    const bank_account_name   = formData.get('bank_account_name') as string | null

    const normPhone = phone.trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')

    // Check duplicate
    const { data: existing } = await supabaseAdmin
      .from('kyc_applications')
      .select('id, status')
      .eq('phone', normPhone)
      .neq('status', 'rejected')
      .maybeSingle()

    if (existing) return error('An application with this phone number already exists', 409)

    // Verify group is open
    const { data: group } = await supabaseAdmin
      .from('susu_groups')
      .select('id, name, registration_fee, status, current_members, max_members')
      .eq('id', selected_group_id)
      .single()

    if (!group) return error('Group not found', 404)
    if (!['open', 'full'].includes(group.status) || group.current_members >= group.max_members) {
      return error('This group is no longer accepting new members', 400)
    }

    // Upload Ghana Card images to Supabase Storage
    let frontUrl: string | null = null
    let backUrl: string | null  = null
    const timestamp             = Date.now()

    const frontFile = formData.get('ghana_card_front') as File | null
    const backFile  = formData.get('ghana_card_back') as File | null

    if (frontFile) {
      const { data: uploaded, error: uploadErr } = await supabaseAdmin.storage
        .from('kyc-documents')
        .upload(`ghana-cards/${normPhone}-front-${timestamp}`, frontFile, {
          contentType: frontFile.type,
          upsert: true,
        })
      if (!uploadErr) {
        const { data: { publicUrl } } = supabaseAdmin.storage
          .from('kyc-documents')
          .getPublicUrl(uploaded.path)
        frontUrl = publicUrl
      }
    }

    if (backFile) {
      const { data: uploaded, error: uploadErr } = await supabaseAdmin.storage
        .from('kyc-documents')
        .upload(`ghana-cards/${normPhone}-back-${timestamp}`, backFile, {
          contentType: backFile.type,
          upsert: true,
        })
      if (!uploadErr) {
        const { data: { publicUrl } } = supabaseAdmin.storage
          .from('kyc-documents')
          .getPublicUrl(uploaded.path)
        backUrl = publicUrl
      }
    }

    // Create KYC application record
    const { data: kyc, error: kycErr } = await supabaseAdmin
      .from('kyc_applications')
      .insert({
        full_name, phone: normPhone, email, date_of_birth, occupation,
        residential_address, ghana_card_number,
        ghana_card_front_url: frontUrl,
        ghana_card_back_url:  backUrl,
        selected_group_id, mobile_money_number, mobile_money_provider,
        bank_name, bank_account_number, bank_account_name,
        registration_fee_amount: group.registration_fee,
        status: 'pending',
      })
      .select('id')
      .single()

    if (kycErr) return error(kycErr.message, 500)

    // Initialize Paystack payment for registration fee (if fee > 0)
    let paystackData = null
    if (group.registration_fee > 0) {
      const reference = `KYC-${kyc.id}-${timestamp}`
      const paystackRes = await initializeTransaction({
        email:        email ?? `${normPhone.replace('+', '')}@susu.platform`,
        amount:       Math.round(group.registration_fee * 100), // pesewas
        reference,
        callback_url: `${Deno.env.get('FRONTEND_URL')}/join/${selected_group_id}?ref=${reference}`,
        metadata:     { kyc_id: kyc.id, group_id: selected_group_id, type: 'registration_fee' },
      })

      if (paystackRes.status) {
        paystackData = {
          authorization_url: paystackRes.data.authorization_url,
          reference:         paystackRes.data.reference,
        }
      }
    }

    return json({
      message:   'KYC application submitted successfully',
      kyc_id:    kyc.id,
      fee:       group.registration_fee,
      paystack:  paystackData,
    }, 201)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
