import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'

/**
 * OTP CONFIRMATION — NOT SUPPORTED BY THE PROVIDER.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The header on this file used to describe Moolre's behaviour: a network puts
 * an OTP in front of the prompt, the member types it, and the same externalref
 * is resubmitted with the code attached. Moolre was dropped for NaloPay, and
 * NaloPay does not work that way.
 *
 * `requestPayment` returns 'prompted', 'duplicate' or 'failed'. It never
 * returns 'otp_required' — that member of the union is declared and never
 * produced. What NaloPay does return is a USSD dial-string in `otp_code`, which
 * is a thing to dial, not a code to type back.
 *
 * ── WHY THIS NOW REFUSES ────────────────────────────────────────────────
 *
 * The previous body passed the member's code to `requestPayment` as `otpcode`.
 * That function builds its payload from named fields and has never read such a
 * field, so the code was dropped and a SECOND collection was requested against
 * the same reference — a duplicate payment attempt on somebody who believed
 * they were confirming the first one. It was unreachable in practice only
 * because nothing produces 'otp_required'; the UI branch that calls it exists.
 *
 * Refusing is the only safe answer: the retry could not have succeeded and
 * could have charged twice. If NaloPay ever introduces a real OTP challenge,
 * this needs building against their documented field rather than a guessed one.
 *
 * Kept rather than deleted so the member-facing prompt, which still has an OTP
 * branch, gets a clear sentence instead of a 404 that reads like an outage.
 */
serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  try {
    const { reference } = await req.json().catch(() => ({}))
    if (!reference) return error('reference is required')

    // Still scoped to the caller: a reference belonging to somebody else must
    // not even reveal whether it exists.
    const { data: tx } = await supabaseAdmin
      .from('transactions')
      .select('reference, status')
      .eq('reference', reference)
      .eq('member_id', session.sub)
      .maybeSingle()

    if (!tx) return error('Payment not found', 404)
    if (tx.status === 'success') return json({ message: 'This payment is already complete' })

    console.warn(`payments-otp called for ${reference} — NaloPay does not use OTP challenges`)

    return error(
      'This payment is approved on your phone, not with a code. Check for the ' +
      'mobile money prompt and approve it there.',
      400,
    )
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
