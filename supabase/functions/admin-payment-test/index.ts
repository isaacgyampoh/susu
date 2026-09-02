import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }        from '../_shared/supabase-admin.ts'
import { requireAdmin }         from '../_shared/jwt.ts'
import { provider }             from '../_shared/mode.ts'
import { requestPayment as naloRequest,   paymentStatus as naloStatus }   from '../_shared/nalo.ts'

/*
 * Admin payment self-test. Fires a real (small) MoMo prompt to a chosen
 * phone so you can validate provider credentials and field mapping before
 * trusting live contributions — then reports exactly what the provider
 * returned. Two actions:
 *
 *   POST { action: 'status' }                       → which provider is live
 *   POST { action: 'prompt', phone, network, amount }→ fire a test prompt
 *   POST { action: 'check', reference }             → re-check that test
 *
 * The money is real; keep the amount tiny (default GHS 1).
 */
serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const action = body.action ?? 'status'
  const prov = provider()

  if (action === 'status') {
    return json({
      provider: prov,
      configured: prov !== 'none',
      note: prov === 'none'
        ? 'No provider configured. Set PAYMENT_PROVIDER and its credentials in Edge Function secrets.'
        : `Live provider: ${prov}. Fire a test prompt to confirm the mapping.`,
    })
  }

  if (prov !== 'nalo') {
    return error(`Test prompts only apply to phone-prompt providers. Active provider: ${prov}.`, 400)
  }
  const doRequest = naloRequest
  const doStatus  = naloStatus

  if (action === 'prompt') {
    const phone   = String(body.phone ?? '').trim()
    const network = String(body.network ?? 'MTN')
    const amount  = Math.max(0.1, Math.min(5, Number(body.amount ?? 1)))   // GHS 0.10–5 only
    if (!phone) return error('phone is required')

    const reference = `TEST-${Date.now()}`
    const res = await doRequest({
      payer: phone, amount, provider: network,
      externalref: reference, reference: 'Susu provider test',
    })

    /*
     * No local row is written for a test prompt.
     *
     * There used to be one, inserted with `type: 'provider_test'` — a value the
     * `tx_type` enum does not have (`registration_fee | contribution | payout`).
     * The insert therefore failed every single time, into a swallowed
     * `.then(() => {}, () => {})`, while its comment claimed it existed so the
     * `check` action would have something to look at.
     *
     * It never did, and `check` never needed it: that action asks NaloPay
     * directly by reference. A diagnostic also has no business putting rows in
     * the financial tables.
     */
    const orderId = res.kind === 'prompted' ? res.providerOrderId : null
    return json({ provider: prov, reference, order_id: orderId, result: res })
  }

  if (action === 'check') {
    const reference = String(body.reference ?? '')
    if (!reference) return error('reference is required')
    const tx = await doStatus(reference)
    return json({ provider: prov, reference, status: tx })
  }

  return error('Unknown action', 400)
})
