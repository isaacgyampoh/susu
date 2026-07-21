/**
 * Nalo Solutions — Ghanaian payments (collections). https://nalosolutions.com
 *
 * Same two truths that shape the Moolre integration apply here:
 *
 * 1. THE CALLBACK IS A HINT, NOT PROOF. Nalo POSTs a callback to our webhook
 *    when a charge resolves, but we never settle money on the callback alone —
 *    we confirm every payment by asking Nalo's status endpoint ourselves.
 *
 * 2. COLLECTION IS A PROMPT, NOT A REDIRECT. make_payment triggers a mobile
 *    money prompt on the member's phone; they approve with their PIN. Nobody
 *    leaves the app. Some networks insert an OTP step first.
 *
 * This module deliberately exposes the SAME shapes as _shared/moolre.ts
 * (PromptResult, TxStatus, requestPayment, paymentStatus, localPhone) so the
 * edge functions can treat providers interchangeably.
 */

const PAY_BASE = () => Deno.env.get('NALO_PAYMENT_URL') ?? 'https://api.nalosolutions.com/payplus/api/'
const USERNAME = () => Deno.env.get('NALO_PAYMENT_USERNAME') ?? ''
const PASSWORD = () => Deno.env.get('NALO_PAYMENT_PASSWORD') ?? ''
const MERCHANT = () => Deno.env.get('NALO_MERCHANT_ID') ?? ''
const CALLBACK = () => Deno.env.get('NALO_CALLBACK_URL') ?? ''

export const naloConfigured = () =>
  !!USERNAME() && !!PASSWORD() && !!MERCHANT()

/** Nalo's payby values by network. */
export function paybyFor(provider: string | null | undefined): string | null {
  const s = (provider ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  if (!s) return null
  if (s.includes('AIRTELTIGO') || s.includes('TIGO')) return 'AIRTELTIGO'
  if (s.includes('MTN')) return 'MTN'
  if (s.includes('TELECEL') || s.includes('VODAFONE') || s.includes('VODA')) return 'VODAFONE'
  if (s === 'AT' || s.startsWith('AT')) return 'AIRTELTIGO'
  return null
}

/** Nalo wants 233XXXXXXXXX (no plus, no leading zero). */
export function naloPhone(phone: string): string {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.startsWith('233')) return d
  if (d.startsWith('0'))   return '233' + d.slice(1)
  if (d.length === 9)      return '233' + d
  return d
}

// Same result shapes as moolre.ts, so callers are provider-agnostic
export type PromptResult =
  | { kind: 'prompted'; moolreRef: string }        // 'moolreRef' kept for a common field name
  | { kind: 'otp_required'; message: string }
  | { kind: 'duplicate' }
  | { kind: 'failed'; code: string; message: string }

export type TxStatus = {
  settled: boolean
  pending: boolean
  amount: number
  transactionid: string
  externalref: string
  raw: unknown
}

async function call(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${PAY_BASE()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  try { return JSON.parse(text) }
  catch { throw new Error(`Nalo returned non-JSON (${res.status}): ${text.slice(0, 200)}`) }
}

/**
 * Nalo signals success in a few shapes across accounts; accept the documented
 * ones. 'ACCEPTED'/'SUCCESS'/status 1 mean the prompt was pushed.
 */
const accepted = (r: any) => {
  const s = String(r?.Status ?? r?.status ?? '').toUpperCase()
  const code = String(r?.Code ?? r?.code ?? '')
  return s === 'ACCEPTED' || s === 'SUCCESS' || s === '1' || code === '00' || code === '000'
}

// ── COLLECTIONS ───────────────────────────────────────────────

/**
 * Push a payment prompt to the member's phone. externalref (our order_id)
 * must be unique so a repeat can't double-charge.
 */
export async function requestPayment(args: {
  payer: string
  amount: number
  provider: string
  externalref: string
  reference?: string          // human description
  otpcode?: string
}): Promise<PromptResult> {
  const payby = paybyFor(args.provider)
  if (!payby) return { kind: 'failed', code: 'CHANNEL', message: `Unsupported network: ${args.provider}` }

  const body: Record<string, unknown> = {
    merchant_id:     MERCHANT(),
    secrete:         PASSWORD(),      // Nalo payment password
    key:             USERNAME(),      // Nalo payment username
    order_id:        args.externalref,
    customerName:    args.reference ?? 'Susu member',
    amount:          args.amount.toFixed(2),
    item_desc:       args.reference ?? 'Susu contribution',
    customerNumber:  naloPhone(args.payer),
    payby,
    newVodaPayment:  payby === 'VODAFONE' ? true : undefined,
    callback:        CALLBACK() || undefined,
    isussd:          1,
  }
  if (args.otpcode) body.otpcode = args.otpcode

  let r: any
  try { r = await call('', body) }
  catch (e) { return { kind: 'failed', code: 'NET', message: (e as Error).message } }

  // Some networks (notably Vodafone/Telecel) require an OTP the member gets by SMS
  const msg = String(r?.Message ?? r?.message ?? '')
  if (/otp/i.test(msg) && !args.otpcode) {
    return { kind: 'otp_required', message: msg || 'Check your SMS for a verification code.' }
  }
  if (/duplicate|already/i.test(msg)) return { kind: 'duplicate' }

  if (accepted(r)) {
    const ref = String(r?.TransactionId ?? r?.transaction_id ?? r?.InvoiceNo ?? args.externalref)
    return { kind: 'prompted', moolreRef: ref }
  }
  return { kind: 'failed', code: String(r?.Code ?? r?.code ?? 'FAIL'), message: msg || 'Payment could not be started' }
}

/**
 * The only thing we believe: ask Nalo directly whether the money moved.
 * Nalo exposes a transaction-status query keyed by our order_id.
 */
export async function paymentStatus(externalref: string): Promise<TxStatus | null> {
  let r: any
  try {
    r = await call('', {
      merchant_id: MERCHANT(),
      secrete:     PASSWORD(),
      key:         USERNAME(),
      order_id:    externalref,
      action:      'status',        // status query
    })
  } catch { return null }

  const s = String(r?.Status ?? r?.status ?? '').toUpperCase()
  const code = String(r?.Code ?? r?.code ?? '')
  const settled = s === 'PAID' || s === 'SUCCESS' || code === '00' || code === '000'
  const failed  = s === 'FAILED' || s === 'CANCELLED'
  if (!settled && !failed && !s && !code) return null

  return {
    settled,
    pending: !settled && !failed,
    amount: Number(r?.amount ?? r?.Amount ?? 0),
    transactionid: String(r?.TransactionId ?? r?.transaction_id ?? ''),
    externalref,
    raw: r,
  }
}

/**
 * Read a callback body into our common shape. Never trusted on its own —
 * the webhook uses this only to know WHICH order to re-verify.
 */
export function parseCallback(body: any): { externalref: string | null; claimsSuccess: boolean } {
  const externalref = body?.order_id ?? body?.Order_id ?? body?.externalref ?? null
  const s = String(body?.Status ?? body?.status ?? '').toUpperCase()
  const code = String(body?.Code ?? body?.code ?? '')
  return { externalref, claimsSuccess: s === 'PAID' || s === 'SUCCESS' || code === '00' || code === '000' }
}
