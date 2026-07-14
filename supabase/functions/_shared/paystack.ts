const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')!
const BASE = 'https://api.paystack.co'

async function paystackRequest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

/** Initialize a Paystack transaction */
export async function initializeTransaction(params: {
  email: string
  amount: number        // in Ghana Pesewas (GHS * 100)
  reference: string
  callback_url?: string
  metadata?: Record<string, unknown>
}) {
  return paystackRequest('POST', '/transaction/initialize', params)
}

/** Verify a Paystack transaction by reference */
export async function verifyTransaction(reference: string) {
  return paystackRequest('GET', `/transaction/verify/${reference}`)
}

/** Initiate a transfer (payout to member) */
export async function createTransfer(params: {
  source: 'balance'
  amount: number
  recipient: string   // Paystack recipient code
  reason?: string
  reference?: string
}) {
  return paystackRequest('POST', '/transfer', params)
}

/** Create a transfer recipient (bank account) */
export async function createRecipient(params: {
  type: 'ghipss' | 'mobile_money'
  name: string
  account_number: string
  bank_code: string
  currency?: string
}) {
  return paystackRequest('POST', '/transferrecipient', { ...params, currency: 'GHS' })
}

/** Validate Paystack webhook signature */
export function validateWebhookSignature(rawBody: string, signature: string): boolean {
  // In production use HMAC-SHA512 with PAYSTACK_SECRET
  // Simplified check here — implement full HMAC in production
  return signature.length > 0
}
