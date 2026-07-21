/**
 * NaloPay — Ghanaian payments (collections). merchant.nalopay.com
 * API docs: https://documenter.getpostman.com/view/46352845/2sB3QRoSva
 *
 * Two truths, same as the other providers:
 *   1. THE CALLBACK IS A HINT, NOT PROOF. We settle nothing on the callback
 *      alone — every order is confirmed against collection-status ourselves.
 *   2. COLLECTION IS A PROMPT, NOT A REDIRECT. The member approves a MoMo
 *      prompt with their PIN; nobody leaves the app.
 *
 * Three-step flow:
 *   a) POST generate-payment-token  (Basic auth)      -> short-lived JWT
 *   b) POST collection              (JWT + trans_hash) -> prompt pushed, order_id
 *   c) POST collection-status       (by order_id)      -> PENDING/COMPLETED/FAILED
 *
 * trans_hash = HMAC_SHA256(merchant_id + account_number + amount + reference, secret) hex.
 *
 * Exposes the SAME shapes as _shared/moolre.ts so callers are provider-agnostic.
 */

const BASE     = () => (Deno.env.get('NALO_BASE_URL') ?? 'https://api.nalopay.com').replace(/\/$/, '')
const MERCHANT = () => Deno.env.get('NALO_MERCHANT_ID') ?? ''
const SECRET   = () => Deno.env.get('NALO_SECRET_KEY') ?? ''
// The portal's "Auth key" already includes "Basic". Accept it with or without.
const AUTH_RAW = () => Deno.env.get('NALO_AUTH_KEY') ?? ''
const AUTH_HEADER = () => {
  const a = AUTH_RAW().trim()
  return a.toLowerCase().startsWith('basic ') ? a : (a ? `Basic ${a}` : '')
}

export const naloConfigured = () => !!MERCHANT() && !!SECRET() && !!AUTH_RAW()

/**
 * NaloPay validates the callback as a real public https URL and rejects blanks
 * (PAY-INVAL-0069, cause "callback"). Prefer the configured URL; if it's
 * missing or not https, derive the webhook from the Supabase project URL.
 */
function callbackUrl(): string {
  const explicit = (Deno.env.get('NALO_CALLBACK_URL') ?? '').trim()
  if (/^https:\/\/\S+$/.test(explicit)) return explicit
  const supa = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')
  if (supa) return `${supa}/functions/v1/nalo-webhook`
  return 'https://example.com/nalo-webhook'   // last resort; NaloPay needs *some* valid https URL
}

/** NaloPay networks: MTN, AT (AirtelTigo), TELECEL. */
export function networkFor(provider: string | null | undefined): string | null {
  const s = (provider ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  if (!s) return null
  if (s.includes('AIRTELTIGO') || s.includes('TIGO')) return 'AT'
  if (s.includes('MTN')) return 'MTN'
  if (s.includes('TELECEL') || s.includes('VODAFONE') || s.includes('VODA')) return 'TELECEL'
  if (s === 'AT' || s.startsWith('AT')) return 'AT'
  return null
}

/** NaloPay wants 233XXXXXXXXX (no plus, no leading zero). */
export function naloPhone(phone: string): string {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.startsWith('233')) return d
  if (d.startsWith('0'))   return '233' + d.slice(1)
  if (d.length === 9)      return '233' + d
  return d
}

// Common result shapes (match moolre.ts)
export type PromptResult =
  | { kind: 'prompted'; moolreRef: string }        // moolreRef carries NaloPay order_id
  | { kind: 'otp_required'; message: string }
  | { kind: 'duplicate' }
  | { kind: 'failed'; code: string; message: string; raw?: unknown }

export type TxStatus = {
  settled: boolean
  pending: boolean
  amount: number
  transactionid: string
  externalref: string
  raw: unknown
}

async function post(path: string, body: unknown, headers: Record<string, string>): Promise<any> {
  const res = await fetch(`${BASE()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  try { return JSON.parse(text) }
  catch { throw new Error(`NaloPay non-JSON (${res.status}): ${text.slice(0, 200)}`) }
}

/** Step a: exchange Basic auth for a short-lived JWT. */
async function getToken(): Promise<string> {
  const r = await post('/clientapi/generate-payment-token/', { merchant_id: MERCHANT() }, {
    Authorization: AUTH_HEADER(),
  })
  const token = r?.data?.token
  if (!token) throw new Error(`NaloPay token failed: ${JSON.stringify(r).slice(0, 200)}`)
  return token
}

/** trans_hash = HMAC_SHA256(merchant_id + account_number + amount + reference, secret). */
async function transHash(account_number: string, amount: string, reference: string): Promise<string> {
  const message = `${MERCHANT()}${account_number}${amount}${reference}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// COLLECTIONS ──────────────────────────────────────────────────

/**
 * Push a MoMo prompt to the member's phone. externalref (our reference) must
 * be unique. On success NaloPay returns an order_id we store to check status.
 */
export async function requestPayment(args: {
  payer: string
  amount: number
  provider: string
  externalref: string
  reference?: string          // human description
  accountName?: string
}): Promise<PromptResult> {
  const network = networkFor(args.provider)
  if (!network) return { kind: 'failed', code: 'CHANNEL', message: `Unsupported network: ${args.provider}` }

  const phone233 = naloPhone(args.payer)                    // 233XXXXXXXXX
  const phone0   = phone233.replace(/^233/, '0')            // 0XXXXXXXXX
  const amt2dp   = args.amount.toFixed(2)                    // "1.00"
  const amtInt   = String(args.amount)                       // "1"

  let token: string
  try { token = await getToken() }
  catch (e) { return { kind: 'failed', code: 'TOKEN', message: (e as Error).message } }

  // NaloPay's hash inputs (amount decimals, phone format) are ambiguous in the
  // docs, so try the sensible combinations and use the first it accepts. The
  // amount SENT must match the amount HASHED, and the account_number sent is
  // always 233-format; only the hash's phone representation varies.
  const candidates: { amountStr: string; hashPhone: string; label: string }[] = [
    { amountStr: amt2dp, hashPhone: phone233, label: '2dp/233' },
    { amountStr: amt2dp, hashPhone: phone0,   label: '2dp/0' },
    { amountStr: amtInt, hashPhone: phone233, label: 'int/233' },
    { amountStr: amtInt, hashPhone: phone0,   label: 'int/0' },
  ]

  let lastRaw: unknown = null
  for (const c of candidates) {
    let hash: string
    try { hash = await transHash(c.hashPhone, c.amountStr, args.externalref) }
    catch (e) { return { kind: 'failed', code: 'HASH', message: (e as Error).message } }

    let r: any
    try {
      r = await post('/clientapi/collection/', {
        merchant_id:    MERCHANT(),
        service_name:   'MOMO_TRANSACTION',
        trans_hash:     hash,
        account_number: phone233,
        account_name:   args.accountName ?? 'Susu member',
        network,
        amount:         c.amountStr,
        reference:      args.externalref,
        callback:       callbackUrl(),
        description:    args.reference ?? 'Susu contribution',
      }, { token })
    } catch (e) {
      return { kind: 'failed', code: 'NET', message: (e as Error).message }
    }

    if (r?.success && r?.data?.order_id) {
      console.log(`NaloPay: accepted hash format ${c.label}`)
      return { kind: 'prompted', moolreRef: String(r.data.order_id) }
    }
    lastRaw = r
    const cause = String(r?.error?.cause ?? '')
    // Only keep trying while it's specifically the hash it dislikes
    if (cause !== 'trans_hash') break
  }

  const r: any = lastRaw
  const msg = String(r?.message ?? r?.error?.description ?? r?.data?.message ?? 'Payment could not be started')
  if (/duplicate|already/i.test(msg)) return { kind: 'duplicate' }
  console.error('NaloPay collection rejected:', JSON.stringify(r))
  return { kind: 'failed', code: String(r?.code ?? 'FAIL'), message: msg, raw: r }
}

/**
 * The only thing we believe: ask NaloPay whether the money moved. Looked up by
 * order_id (returned at creation, echoed in the callback), stored as our ref.
 */
export async function paymentStatus(orderId: string): Promise<TxStatus | null> {
  let r: any
  try {
    r = await post('/clientapi/collection-status/', {
      merchant_id: MERCHANT(),
      order_id:    orderId,
    }, {})
  } catch { return null }

  const status = String(r?.data?.status ?? '').toUpperCase()
  if (!status) return null

  return {
    settled: status === 'COMPLETED' || status === 'SUCCESS' || status === 'PAID',
    pending: status === 'PENDING',
    amount:  Number(r?.data?.amount ?? 0),
    transactionid: orderId,
    externalref:   orderId,
    raw: r,
  }
}

/** Read a callback into our common shape. Never trusted alone — used only to
 *  know which order_id to re-verify. */
export function parseCallback(body: any): { externalref: string | null; claimsSuccess: boolean } {
  const externalref = body?.order_id ?? null
  const status = String(body?.status ?? '').toUpperCase()
  return { externalref, claimsSuccess: status === 'COMPLETED' }
}
