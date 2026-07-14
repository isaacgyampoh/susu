import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'
import { verifyTransaction }       from '../_shared/paystack.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return error('Method not allowed', 405)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  try {
    const { reference } = await req.json()
    if (!reference) return error('reference is required')

    // Check if already recorded as success (webhook may have already processed it)
    const { data: existing } = await supabaseAdmin
      .from('transactions')
      .select('id, status')
      .eq('reference', reference)
      .maybeSingle()

    if (existing?.status === 'success') {
      return json({ verified: true, message: 'Payment already confirmed' })
    }

    // Verify with Paystack
    const paystackRes = await verifyTransaction(reference)

    if (!paystackRes.status || paystackRes.data?.status !== 'success') {
      return json({ verified: false, message: 'Payment not confirmed yet. Please wait or contact support.' })
    }

    const { metadata, amount } = paystackRes.data
    const amountGHS = amount / 100

    // Handle contribution payment
    if (metadata?.type === 'contribution') {
      const { contribution_id, member_id } = metadata

      // Ensure member can only verify their own payment
      if (member_id !== session.sub) return error('Forbidden', 403)

      await supabaseAdmin
        .from('contributions')
        .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: reference })
        .eq('id', contribution_id)

      await supabaseAdmin.from('transactions').upsert({
        member_id,
        type:         'contribution',
        amount:       amountGHS,
        reference,
        description:  'Susu daily contribution',
        status:       'success',
        paystack_data: paystackRes.data,
        related_id:   contribution_id,
      }, { onConflict: 'reference' })
    }

    // Handle registration fee
    if (metadata?.type === 'registration_fee') {
      const kycId = metadata.kyc_id
      await supabaseAdmin
        .from('kyc_applications')
        .update({ registration_fee_paid: true, registration_fee_ref: reference })
        .eq('id', kycId)
    }

    return json({ verified: true, message: 'Payment confirmed successfully' })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
