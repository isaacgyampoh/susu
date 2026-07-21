import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { initializeTransaction } from '../_shared/paystack.ts'
import { paystackConfigured, devPaymentsAllowed, provider } from '../_shared/mode.ts'


/** Validate an uploaded image when present (absent files are fine). */
function checkImage(file: File | null, label: string): string | null {
  if (!file || typeof file === 'string' || file.size === 0) return null
  if (!file.type?.startsWith('image/')) return `${label} must be an image file`
  if (file.size > 5 * 1024 * 1024)      return `${label} must be under 5MB`
  return null
}

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  try {
    const formData = await req.formData()

    const full_name         = formData.get('full_name') as string
    const phone             = formData.get('phone') as string
    const ghana_card_number = formData.get('ghana_card_number') as string

    // An applicant may select several groups at once. 'selected_group_ids'
    // is comma-separated; the old single 'selected_group_id' still works.
    // Preferred: selected_groups JSON [{ id, slots }]; legacy: comma ids
    const FRACS = [0.25, 0.5, 1]
    let slotMap: Record<string, { count: number; fraction: number }> = {}
    try {
      const rawSel = formData.get('selected_groups') as string | null
      if (rawSel) for (const g of JSON.parse(rawSel)) {
        if (g?.id) slotMap[g.id] = { count: Math.max(1, Math.min(10, Number(g.slots ?? 1))), fraction: FRACS.includes(Number(g.fraction)) ? Number(g.fraction) : 1 }
      }
    } catch (_) { /* fall through to ids */ }

    const rawIds = (formData.get('selected_group_ids') as string)
                ?? (formData.get('selected_group_id') as string) ?? ''
    const selectedGroupIds = Object.keys(slotMap).length > 0
      ? Object.keys(slotMap)
      : [...new Set(rawIds.split(',').map(s => s.trim()).filter(Boolean))]
    if (Object.keys(slotMap).length === 0) for (const id of selectedGroupIds) slotMap[id] = { count: 1, fraction: 1 }
    const selected_group_id = selectedGroupIds[0]

    if (!full_name || !phone || !ghana_card_number || selectedGroupIds.length === 0) {
      return error('full_name, phone, ghana_card_number and at least one selected group are required')
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

    // Verify every selected group
    const { data: groupsData } = await supabaseAdmin
      .from('susu_groups')
      .select('id, name, registration_fee, status, current_members, max_members')
      .in('id', selectedGroupIds)

    if (!groupsData || groupsData.length !== selectedGroupIds.length) return error('One or more selected groups were not found', 404)
    for (const g of groupsData) {
      const want = slotMap[g.id]?.count ?? 1
      if (!['open', 'full'].includes(g.status) || g.current_members + want > g.max_members) {
        return error(`"${g.name}" cannot take ${want} slot(s) — only ${Math.max(0, g.max_members - g.current_members)} left`, 400)
      }
    }

    // Total registration fee: fee × slots, across all selected groups
    const totalFee = Math.round(groupsData.reduce((s, g) => s + Number(g.registration_fee || 0) * (slotMap[g.id]?.count ?? 1) * (slotMap[g.id]?.fraction ?? 1), 0) * 100) / 100
    const group = { registration_fee: totalFee }

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
    const kycRow: Record<string, unknown> = ({
        full_name, phone: normPhone,
        email:               formData.get('email') as string | null,
        date_of_birth:       formData.get('date_of_birth') as string | null,
        occupation:          formData.get('occupation') as string | null,
        residential_address: formData.get('residential_address') as string | null,
        ghana_card_number, ghana_card_front_url: frontUrl, ghana_card_back_url: backUrl,
        selected_group_id,
        selected_group_ids: selectedGroupIds,
        selected_slots: slotMap,
        mobile_money_number:   formData.get('mobile_money_number') as string | null,
        mobile_money_provider: formData.get('mobile_money_provider') as string | null,
        bank_name:             formData.get('bank_name') as string | null,
        bank_account_number:   formData.get('bank_account_number') as string | null,
        bank_account_name:     formData.get('bank_account_name') as string | null,
        registration_fee_amount: group.registration_fee,
        // Only ever true without a real payment when dev mode is explicitly on
        registration_fee_paid: devPaymentsAllowed() || group.registration_fee === 0,
        status: 'pending',
      })
    let { data: kyc, error: kycErr } = await supabaseAdmin
      .from('kyc_applications').insert(kycRow).select('id').single()
    if (kycErr && /selected_slots/.test(kycErr.message)) {
      delete kycRow.selected_slots
      ;({ data: kyc, error: kycErr } = await supabaseAdmin
        .from('kyc_applications').insert(kycRow).select('id').single())
    }
    if (kycErr && /selected_group_ids/.test(kycErr.message)) {
      // v9 migration not applied — keep the first choice, drop the array
      delete kycRow.selected_group_ids
      ;({ data: kyc, error: kycErr } = await supabaseAdmin
        .from('kyc_applications').insert(kycRow).select('id').single())
    }
    if (kycErr || !kyc) return error(kycErr?.message ?? 'Could not save application', 500)

    // Registration fee online only via Paystack's redirect. Nalo/Moolre are
    // phone-prompt providers that need an authenticated member, which an
    // applicant is not yet — so under those, the fee is collected manually
    // (admin 'Mark paid' on the KYC list once the MoMo lands).
    let paystackData = null
    if (provider() === 'paystack' && paystackConfigured() && group.registration_fee > 0) {
      const reference  = `KYC-${kyc.id}-${ts}`
      const paystackRes = await initializeTransaction({
        email:        (formData.get('email') as string) ?? `${normPhone.replace('+', '')}@susu.platform`,
        amount:       Math.round(group.registration_fee * 100),
        reference,
        callback_url: `${Deno.env.get('FRONTEND_URL') ?? ''}/join/${selected_group_id}?ref=${reference}`,
        metadata:     { kyc_id: kyc.id, group_id: selected_group_id, group_ids: selectedGroupIds, type: 'registration_fee' },
      })
      if (paystackRes.status) {
        paystackData = { authorization_url: paystackRes.data.authorization_url, reference: paystackRes.data.reference }
      }
    }

    return json({
      message:  'KYC application submitted successfully',
      kyc_id:   kyc.id,
      fee:      group.registration_fee,
      fee_paid: devPaymentsAllowed(),
      paystack: paystackData,
    }, 201)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
