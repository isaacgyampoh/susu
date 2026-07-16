const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')
const BASE            = 'https://api.paystack.co'

async function paystackRequest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

export function isPaystackEnabled(): boolean {
  return !!PAYSTACK_SECRET
}

export async function initializeTransaction(params: {
  email: string; amount: number; reference: string
  callback_url?: string; metadata?: Record<string, unknown>
}) {
  // No fake success. Callers gate on mode.ts and refuse when unconfigured —
  // a helper that invents a successful payment is how a missing key becomes
  // free money.
  if (!PAYSTACK_SECRET) throw new Error('PAYSTACK_SECRET_KEY is not set')
  return paystackRequest('POST', '/transaction/initialize', params)
}

export async function verifyTransaction(reference: string) {
  if (!PAYSTACK_SECRET) throw new Error('PAYSTACK_SECRET_KEY is not set')
  return paystackRequest('GET', `/transaction/verify/${reference}`)
}

export async function createTransfer(params: {
  source: 'balance'; amount: number; recipient: string; reason?: string; reference?: string
}) {
  if (!PAYSTACK_SECRET) throw new Error('PAYSTACK_SECRET_KEY is not set')
  return paystackRequest('POST', '/transfer', params)
}
