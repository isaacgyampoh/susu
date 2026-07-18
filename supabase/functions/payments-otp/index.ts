import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'
import { requestPayment }          from '../_shared/moolre.ts'

/**
 * Some networks put an OTP in front of the payment prompt (Moolre code TP14).
 * The member gets a code by SMS, types it here, and we re-submit the SAME
 * externalref with the otpcode attached — same reference, so the retry cannot
 * become a second charge.
 */
serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  try {
    const { reference, otp } = await req.json()
    if (!reference || !otp) return error('reference and otp are required')

    // The reference must belong to this member — never take one on trust
    const { data: tx } = await supabaseAdmin
      .from('transactions')
      .select('reference, amount, member_id, status')
      .eq('reference', reference)
      .eq('member_id', session.sub)
      .maybeSingle()

    if (!tx) return error('Payment not found', 404)
    if (tx.status === 'success') return json({ message: 'This payment is already complete' })

    const { data: member } = await supabaseAdmin
      .from('members').select('phone, mobile_money_number, mobile_money_provider')
      .eq('id', session.sub).single()

    const res = await requestPayment({
      payer:       member?.mobile_money_number ?? member?.phone ?? '',
      amount:      Number(tx.amount),
      provider:    member?.mobile_money_provider ?? 'MTN',
      externalref: reference,          // deliberately the same
      otpcode:     String(otp),
      reference:   'Susu contribution',
    })

    if (res.kind === 'prompted') {
      return json({ status: 'prompted', message: 'Approve the prompt on your phone.' })
    }
    if (res.kind === 'otp_required') {
      return error('That code was not accepted. Check your SMS and try again.', 400)
    }
    if (res.kind === 'duplicate') {
      return json({ status: 'prompted', message: 'Already sent — approve the prompt on your phone.' })
    }
    return error(res.message, 400)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
