import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }        from '../_shared/supabase-admin.ts'
import { requireAdmin }         from '../_shared/jwt.ts'
import { provider }             from '../_shared/mode.ts'
import { requestPayment as naloRequest,   paymentStatus as naloStatus }   from '../_shared/nalo.ts'
import { requestPayment as moolreRequest, paymentStatus as moolreStatus } from '../_shared/moolre.ts'

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

  if (prov !== 'nalo' && prov !== 'moolre') {
    return error(`Test prompts only apply to phone-prompt providers. Active provider: ${prov}.`, 400)
  }
  const doRequest = prov === 'nalo' ? naloRequest : moolreRequest
  const doStatus  = prov === 'nalo' ? naloStatus  : moolreStatus

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

    // Record it so a later status check has something to look at
    await supabaseAdmin.from('transactions').insert({
      member_id: null, type: 'contribution', amount, reference,
      description: `Provider self-test (${prov}) to ${phone}`,
      status: res.kind === 'prompted' ? 'pending' : 'failed',
    }).then(() => {}, () => {})   // best-effort; member_id may be non-null-constrained

    return json({ provider: prov, reference, result: res })
  }

  if (action === 'check') {
    const reference = String(body.reference ?? '')
    if (!reference) return error('reference is required')
    const tx = await doStatus(reference)
    return json({ provider: prov, reference, status: tx })
  }

  return error('Unknown action', 400)
})
