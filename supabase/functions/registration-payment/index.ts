import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }        from '../_shared/supabase-admin.ts'
import { rateLimit, tooManyMessage } from '../_shared/rate-limit.ts'
import { requestPayment as naloRequest, paymentStatus } from '../_shared/nalo.ts'
import { provider, paymentsUnavailable, withServiceCharge, serviceChargePct } from '../_shared/mode.ts'
import { hashToken, looksLikeToken } from '../_shared/registration-token.ts'
import { settleRegistrationFee } from '../_shared/registration-fee.ts'
import { memberPortalUrl } from '../_shared/urls.ts'

/**
 * PUBLIC REGISTRATION PAYMENT — the applicant pays before approval.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE GAP THIS CLOSES
 *
 * Registration was gated on payment, but an applicant had no way to pay:
 * NaloPay prompts a phone, prompting needs an authenticated caller, and an
 * applicant has no account. So the fee could only be recorded by an admin,
 * by hand, after the fact — which is how 13 approved members ended up
 * carrying an unpaid fee of GHS 1,320.50 between them.
 *
 * The applicant now authenticates with a capability token instead of an
 * account (see `_shared/registration-token.ts`). The token grants ONE thing:
 * paying one named application's fee.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT MAY MARK A REGISTRATION PAID
 *
 * Only NaloPay's own status endpoint, asked by us. Not this request body, not
 * a callback payload, not a successful initialization. `POST action=initiate`
 * returning 200 means a prompt was raised on somebody's phone — it says
 * nothing about whether they approved it, and the page it drives says
 * "Awaiting confirmation", never "Paid".
 *
 * This endpoint is unauthenticated by design and therefore deployed with
 * --no-verify-jwt. Every route below is scoped by the token to exactly one
 * application; no route accepts an application id.
 */


serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const url = new URL(req.url)

    // The token never travels in a query string on a write, where it would be
    // more likely to end up in an access log or a Referer header.
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const raw  = req.method === 'POST' ? body.token : url.searchParams.get('token')

    // An identical 404 for a malformed token, an unknown token and an
    // application that does not exist. Distinguishing them would turn this
    // into an oracle for probing which tokens are live.
    if (!looksLikeToken(raw)) return error('This payment link is not valid.', 404, req)

    const reg = await load(await hashToken(raw))
    if (!reg)          return error('This payment link is not valid.', 404, req)
    if (reg.expired)   return error('This payment link has expired. Ask your susu admin to send a new one.', 410, req)

    if (req.method === 'GET')  return json(view(reg))
    if (req.method !== 'POST') return error('Method not allowed', 405)

  /*
   * ── RATE LIMIT ────────────────────────────────────────────────────────
   * Every call here can raise a live NaloPay prompt, so an unlimited caller
   * makes somebody's phone ring with payment requests indefinitely.
   *
   * Keyed on the capability token rather than the request source, because the
   * token identifies one applicant: two people paying from the same office
   * connection must not block each other, and one applicant retrying is exactly
   * what needs bounding. Ten an hour leaves plenty of room for a failed prompt
   * and a genuine retry.
   *
   * Only 'initiate' is limited: 'verify' just reads a status and a member
   * refreshing to see whether their payment landed should never be blocked.
   */
    if (body.action === 'initiate') {
      // Keyed on the token's HASH, never the token: this table is not a place to
        // keep a live capability, and the hash is just as unique.
        const limit = await rateLimit(
          req, 'registration-payment', 10, 60, `tok:${await hashToken(raw)}`)
      if (!limit.allowed) {
        return error(tooManyMessage(limit.retryAfterSeconds, 'payment attempts'), 429, req)
      }
      return await initiate(req, reg, body)
    }
    if (body.action === 'verify')   return await verify(reg)
    return error('action must be initiate or verify', 400, req)
  } catch (e) {
    console.error('registration-payment:', e)
    return error('Internal server error', 500)
  }
})

// ── The application, as the applicant is allowed to see it ──────────────────
// The projection lives in `get_registration_public()`, not here: a SQL function
// that returns exactly the safe columns is a stronger guarantee than a service
// -role client that could select anything and is trusted not to.
interface Reg {
  expired?: boolean
  kyc_id: string
  full_name: string
  phone_masked: string
  groups: { name: string; registration_fee: number; contribution_amount: number; frequency: string; slots: number }[]
  fee: number
  fee_paid: boolean
  status: string
  submitted_at: string
  expires_at: string | null
  last_attempt: { reference: string; amount: number; status: string; created_at: string } | null
}

async function load(hash: string): Promise<Reg | null> {
  const { data, error: e } = await supabaseAdmin.rpc('get_registration_public', { p_token_hash: hash })
  if (e) { console.error('get_registration_public:', e.message); return null }
  return (data as Reg | null) ?? null
}

/**
 * The single place that decides what an applicant is told about their state.
 *
 * `payment_state` is derived from the database, never from what the browser
 * last saw. The distinction between `awaiting_confirmation` and `paid` is the
 * whole point: a raised prompt is not money.
 */
function view(reg: Reg) {
  const pending = reg.last_attempt?.status === 'pending'
  const state = reg.fee_paid            ? 'paid'
              : reg.fee <= 0            ? 'no_fee'
              : pending                 ? 'awaiting_confirmation'
              :                           'payment_required'

  return {
    applicant:  { name: reg.full_name, phone: reg.phone_masked },
    groups:     reg.groups,
    fee:        reg.fee,
    // What the provider will actually charge, shown before anyone approves a
    // prompt — the service charge is not a surprise added at the till.
    charged:    reg.fee > 0 ? withServiceCharge(reg.fee).charged : 0,
    service_charge_pct: serviceChargePct(),
    payment_state: state,
    registration_status: reg.status,
    submitted_at:  reg.submitted_at,
    link_expires:  reg.expires_at,
    reference:     pending ? reg.last_attempt!.reference : null,
    // Deliberate: approval is a separate human step, and paying does not buy it.
    next_step: state === 'paid'
      ? 'Your registration fee has been received. Your application is now awaiting approval.'
      : state === 'awaiting_confirmation'
        ? 'We are waiting for your mobile money provider to confirm this payment.'
        : state === 'no_fee'
          ? 'No registration fee is due. Your application is awaiting approval.'
          : 'Pay your registration fee to complete your application.',
    sign_in_url: memberPortalUrl() + '/m/login',
  }
}

// ── Raise the prompt ────────────────────────────────────────────────────────
async function initiate(req: Request, reg: Reg, body: Record<string, unknown>) {
  const blocked = paymentsUnavailable(req, error)
  if (blocked) return blocked

  if (reg.fee_paid)              return error('This registration fee has already been paid.', 409, req)
  if (reg.status === 'rejected') return error('This application was not approved. Please contact your susu admin.', 409, req)
  if (reg.fee <= 0)              return error('No registration fee is due on this application.', 400, req)
  if (provider() !== 'nalo')     return error('Online payment is not available right now. Please contact your susu admin.', 503, req)

  // ── FEE INTEGRITY ────────────────────────────────────────────────────────
  // The amount comes from `kyc_applications.registration_fee_amount`, which the
  // server computed from `susu_groups.registration_fee` when the form was
  // submitted. The request body is not consulted: a browser sending
  // `amount: 1` changes nothing, because no branch here reads an amount.
  const fee = Number(reg.fee)
  const { charged, fee: serviceFee } = withServiceCharge(fee)

  const momo = String(body.pay_number ?? '').trim()
  if (!/^(0|\+233)\d{9}$/.test(momo.replace(/\s/g, ''))) {
    return error('Enter the mobile money number you want to pay from.', 400, req)
  }
  const network = String(body.pay_network ?? 'MTN').trim().toUpperCase()

  // A double-tap must not raise two prompts. An attempt still awaiting the
  // provider is returned as-is rather than replaced.
  const { data: live } = await supabaseAdmin
    .from('transactions')
    .select('reference, created_at')
    .eq('kyc_application_id', reg.kyc_id).eq('type', 'registration_fee').eq('status', 'pending')
    .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (live) {
    return json({
      status: 'awaiting_confirmation', reference: live.reference, amount_charged: charged,
      message: 'A payment for this registration is already awaiting confirmation.',
    })
  }

  const reference   = `REG-${reg.kyc_id.slice(0, 8)}-${Date.now()}`
  const providerRef = `RG${Date.now().toString(36)}${crypto.randomUUID().slice(0, 4)}`.toUpperCase().slice(0, 20)

  // Recorded BEFORE the prompt is raised. If the record failed after a prompt
  // succeeded, the applicant would be charged for a payment we had no row for.
  const { data: tx, error: txErr } = await supabaseAdmin.from('transactions').insert({
    member_id: null,                 // there is no member yet — that is the point
    kyc_application_id: reg.kyc_id,
    type: 'registration_fee',
    amount: fee,                     // the FEE, not the grossed-up charge
    reference,
    status: 'pending',
    description: `Registration fee (charged GHS ${charged.toFixed(2)} incl. ${serviceChargePct()}% service charge)`,
    paystack_data: { provider_order_id: providerRef, channel: 'public_registration' },
  }).select('id, reference').single()

  if (txErr || !tx) {
    console.error('registration-payment: could not record the payment', txErr?.message)
    return error('Could not start the payment. Please try again.', 500, req)
  }

  const res = await naloRequest({
    payer: momo, amount: charged, provider: network,
    externalref: providerRef, reference: 'Susu registration fee', accountName: reg.full_name,
  })

  if (res.kind === 'prompted') {
    if (res.providerOrderId && res.providerOrderId !== providerRef) {
      // Match on whatever id the provider actually keyed the payment by,
      // otherwise the callback and the sweeper both fail to find this row.
      await supabaseAdmin.from('transactions')
        .update({ paystack_data: { provider_order_id: res.providerOrderId, channel: 'public_registration' } as never })
        .eq('id', tx.id)
    }
    return json({
      status: 'awaiting_confirmation',      // NOT 'paid'. A prompt is not money.
      reference, amount: fee, amount_charged: charged, service_charge: serviceFee,
      ussd: res.ussd,
      message: res.ussd
        ? `Dial ${res.ussd} on ${momo} to pay GHS ${charged.toFixed(2)}.`
        : `Approve GHS ${charged.toFixed(2)} on ${momo}.`,
    })
  }

  // The prompt never reached the phone, so nothing can arrive against this
  // row. Marking it failed keeps it out of the reconciliation queue, which is
  // for payments that may yet be real.
  await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', tx.id)

  if (res.kind === 'otp_required') {
    return json({ status: 'otp_required', reference, message: res.message })
  }
  return error(res.kind === 'failed' ? res.message : 'Could not start the payment.', 400, req)
}

// ── Ask the provider, and only then settle ──────────────────────────────────
async function verify(reg: Reg) {
  if (reg.fee_paid) return json({ status: 'paid', message: 'Your registration fee has been received.' })

  const attempt = reg.last_attempt
  if (!attempt) return json({ status: 'payment_required', message: 'No payment has been started yet.' })
  if (attempt.status === 'success') return json({ status: 'paid', message: 'Your registration fee has been received.' })
  if (attempt.status === 'failed')  return json({ status: 'failed', message: 'That payment did not complete. You can try again.' })

  const { data: tx } = await supabaseAdmin
    .from('transactions').select('reference, paystack_data')
    .eq('reference', attempt.reference).maybeSingle()

  const orderId = (tx?.paystack_data as { provider_order_id?: string } | null)?.provider_order_id
  const s = await paymentStatus(orderId ?? attempt.reference)

  if (!s)        return json({ status: 'awaiting_confirmation', message: 'Waiting for confirmation…' })
  if (s.pending) return json({ status: 'awaiting_confirmation', message: 'Waiting for you to approve the prompt…' })

  if (!s.settled) {
    await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('reference', attempt.reference)
    return json({ status: 'failed', message: 'That payment did not complete. You can try again.' })
  }

  // The engine — not this function — decides whether the confirmed amount is
  // enough, and refuses to settle a short payment.
  const r = await settleRegistrationFee(attempt.reference, s.amount)

  if (r.short) {
    return json({
      status: 'short',
      message: `We received GHS ${r.amount.toFixed(2)} of the GHS ${r.expected.toFixed(2)} registration fee. `
             + 'Please contact your susu admin — your application has not been marked paid.',
    })
  }
  return json({
    status: 'paid',
    amount: r.amount,
    message: 'Registration fee received. Your application is now awaiting approval.',
  })
}
