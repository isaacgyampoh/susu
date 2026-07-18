/**
 * Moolre — Ghanaian payments. https://docs.moolre.com/llms-full.txt
 *
 * Two things about this API drive the design:
 *
 * 1. THE WEBHOOK CANNOT BE TRUSTED. Moolre's callback carries no documented
 *    signature — unlike Paystack's HMAC-SHA512. So a callback is treated as a
 *    hint that something happened, never as proof of what. Every settlement is
 *    confirmed by calling the status endpoint ourselves.
 *
 * 2. COLLECTION IS A PROMPT, NOT A REDIRECT. The member gets a USSD push on
 *    their phone and approves with their PIN. Nobody leaves the app. Some
 *    networks insert an OTP step first (code TP14).
 */

const LIVE    = 'https://api.moolre.com'
const SANDBOX = 'https://sandbox.moolre.com'

const USER    = () => Deno.env.get('MOOLRE_API_USER') ?? ''
const KEY     = () => Deno.env.get('MOOLRE_API_KEY') ?? ''      // private
const PUBKEY  = () => Deno.env.get('MOOLRE_PUB_KEY') ?? ''      // public
const ACCOUNT = () => Deno.env.get('MOOLRE_ACCOUNT_NUMBER') ?? ''
const SBOX    = () => Deno.env.get('MOOLRE_SANDBOX') === 'true'

export const base = () => (SBOX() ? SANDBOX : LIVE)
export const moolreConfigured = () => !!USER() && !!ACCOUNT() && (SBOX() || !!KEY())

/**
 * Channel codes differ between collecting and paying out. MTN is 13 when we
 * take money and 1 when we send it — the same network, the same provider, two
 * numbers. Getting this wrong sends money down the wrong rail.
 */
export const COLLECT_CHANNEL: Record<string, string> = {
  MTN: '13', TELECEL: '6', VODAFONE: '6', AIRTELTIGO: '7', AT: '7',
}
export const PAYOUT_CHANNEL: Record<string, string> = {
  MTN: '1', TELECEL: '6', VODAFONE: '6', AIRTELTIGO: '7', AT: '7', BANK: '2',
}

/**
 * The provider string comes out of the database, so it can be anything a form
 * once stored: "MTN", "MTN Mobile Money", "mtn momo". An exact-match lookup
 * returns null for all but the first, and a null channel means a member cannot
 * pay. Match on the network name appearing anywhere in the string.
 *
 * Order matters: AIRTELTIGO is checked before AT, since AT is inside it.
 */
export function channelFor(provider: string | null | undefined, dir: 'collect' | 'payout'): string | null {
  const s = (provider ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  if (!s) return null

  const network =
    s.includes('AIRTELTIGO') || s.includes('TIGO') ? 'AIRTELTIGO' :
    s.includes('MTN')                              ? 'MTN' :
    s.includes('TELECEL')                          ? 'TELECEL' :
    s.includes('VODAFONE') || s.includes('VODA')   ? 'VODAFONE' :
    s.includes('BANK')                             ? 'BANK' :
    s === 'AT' || s.startsWith('AT')               ? 'AT' :
    null

  if (!network) return null
  const map = dir === 'collect' ? COLLECT_CHANNEL : PAYOUT_CHANNEL
  return map[network] ?? null
}

/** Moolre wants a bare local number: 0244000000, not +233244000000. */
export function localPhone(phone: string): string {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.startsWith('233')) return '0' + d.slice(3)
  if (d.startsWith('0'))   return d
  if (d.length === 9)      return '0' + d
  return d
}

type MoolreRes = {
  status: number | string
  code: string
  message: unknown
  data: unknown
  go?: unknown
}

async function call(path: string, body: unknown, auth: 'private' | 'public'): Promise<MoolreRes> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-USER': USER(),
  }
  // Sandbox needs no key at all; live needs the right one for the endpoint.
  if (!SBOX()) {
    if (auth === 'private') headers['X-API-KEY'] = KEY()
    else                    headers['X-API-PUBKEY'] = PUBKEY() || KEY()
  }

  const res = await fetch(`${base()}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  const text = await res.text()
  try {
    return JSON.parse(text) as MoolreRes
  } catch {
    throw new Error(`Moolre returned non-JSON (${res.status}): ${text.slice(0, 200)}`)
  }
}

/** Moolre reports success as 1 or "1" depending on the endpoint. */
const ok = (r: MoolreRes) => String(r.status) === '1'

// ── COLLECTIONS ───────────────────────────────────────────────

export type PromptResult =
  | { kind: 'prompted'; moolreRef: string }
  | { kind: 'otp_required'; message: string }
  | { kind: 'duplicate' }
  | { kind: 'failed'; code: string; message: string }

/**
 * Push a payment prompt to the member's phone. They approve with their MoMo PIN.
 * externalref must be unique — Moolre rejects a repeat with TP13, which is a
 * useful accident: it makes double-charging hard.
 */
export async function requestPayment(args: {
  payer: string
  amount: number
  provider: string
  externalref: string
  reference?: string
  otpcode?: string
}): Promise<PromptResult> {
  const channel = channelFor(args.provider, 'collect')
  if (!channel) return { kind: 'failed', code: 'CHANNEL', message: `Unsupported network: ${args.provider}` }

  const r = await call('/open/transact/payment', {
    type: 1,
    channel,
    currency: 'GHS',
    payer: localPhone(args.payer),
    amount: args.amount.toFixed(2),
    externalref: args.externalref,
    ...(args.otpcode ? { otpcode: args.otpcode } : {}),
    ...(args.reference ? { reference: args.reference } : {}),
    accountnumber: ACCOUNT(),
  }, 'private')

  if (r.code === 'TP14') {
    return { kind: 'otp_required', message: String(r.message ?? 'Check your SMS for a verification code.') }
  }
  if (r.code === 'TP13') return { kind: 'duplicate' }
  if (ok(r) && typeof r.data === 'string') return { kind: 'prompted', moolreRef: r.data }

  return { kind: 'failed', code: r.code, message: String(r.message ?? 'Payment could not be started') }
}

/** Hosted checkout, for cases where a prompt is not appropriate. */
export async function paymentLink(args: {
  amount: number
  email: string
  externalref: string
  callback?: string
  redirect?: string
  metadata?: Record<string, unknown>
}): Promise<{ url: string; reference: string } | null> {
  const r = await call('/embed/link', {
    type: 1,
    amount: args.amount.toFixed(2),
    email: args.email,
    externalref: args.externalref,
    ...(args.callback ? { callback: args.callback } : {}),
    ...(args.redirect ? { redirect: args.redirect } : {}),
    reusable: '0',
    expiration_time: 30,
    currency: 'GHS',
    accountnumber: ACCOUNT(),
    ...(args.metadata ? { metadata: args.metadata } : {}),
  }, 'public')

  const d = r.data as { authorization_url?: string; reference?: string } | undefined
  if (ok(r) && d?.authorization_url) return { url: d.authorization_url, reference: d.reference ?? args.externalref }
  return null
}

export type TxStatus = {
  settled: boolean
  pending: boolean
  amount: number
  transactionid: string
  externalref: string
  raw: unknown
}

/**
 * The only thing we believe.
 *
 * txstatus: 1 = success, 0 = pending, 2 = failed. A webhook may say anything;
 * this is asked of Moolre directly and is what decides whether money moved.
 */
export async function paymentStatus(externalref: string): Promise<TxStatus | null> {
  const r = await call('/open/transact/status', {
    type: 1,
    idtype: '1',              // look up by OUR reference, not theirs
    id: externalref,
    accountnumber: ACCOUNT(),
  }, 'public')

  const d = r.data as { txstatus?: number; amount?: string; transactionid?: string; externalref?: string } | undefined
  if (!d || d.txstatus === undefined) return null

  return {
    settled:       Number(d.txstatus) === 1,
    pending:       Number(d.txstatus) === 0,
    amount:        Number(d.amount ?? 0),
    transactionid: String(d.transactionid ?? ''),
    externalref:   String(d.externalref ?? externalref),
    raw:           r,
  }
}

// ── DISBURSEMENTS ─────────────────────────────────────────────

/**
 * Whose account is this, really?
 *
 * Confirms the name on a MoMo number before a cashout leaves. A transposed
 * digit sends someone's collection to a stranger, and it is not coming back.
 */
export async function validateRecipient(receiver: string, provider: string): Promise<string | null> {
  const channel = channelFor(provider, 'payout')
  if (!channel) return null
  const r = await call('/open/transact/validate', {
    type: 1,
    receiver: localPhone(receiver),
    channel,
    currency: 'GHS',
    accountnumber: ACCOUNT(),
  }, 'public')
  return ok(r) && typeof r.data === 'string' ? r.data : null
}

export async function sendTransfer(args: {
  receiver: string
  provider: string
  amount: number
  externalref: string
  reference?: string
}): Promise<{ ok: boolean; transactionid?: string; receivername?: string; message: string }> {
  const channel = channelFor(args.provider, 'payout')
  if (!channel) return { ok: false, message: `Unsupported network: ${args.provider}` }

  const r = await call('/open/transact/transfer', {
    type: 1,
    channel,
    currency: 'GHS',
    amount: args.amount.toFixed(2),
    receiver: localPhone(args.receiver),
    externalref: args.externalref,
    ...(args.reference ? { reference: args.reference } : {}),
    accountnumber: ACCOUNT(),
  }, 'private')

  const d = r.data as { txstatus?: number; transactionid?: string; receivername?: string } | undefined
  const msg = Array.isArray(r.message) ? r.message.join(' ') : String(r.message ?? '')
  if (ok(r) && d) {
    return { ok: Number(d.txstatus) === 1, transactionid: String(d.transactionid ?? ''), receivername: d.receivername, message: msg }
  }
  return { ok: false, message: msg || 'Transfer failed' }
}
