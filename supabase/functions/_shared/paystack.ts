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
  if (!PAYSTACK_SECRET) {
    // Dev mode: return a fake auth URL that marks payment as done
    return {
      status: true,
      data: {
        authorization_url: `${params.callback_url ?? ''}${params.callback_url?.includes('?') ? '&' : '?'}dev_ref=${params.reference}&dev_paid=true`,
        reference: params.reference,
      },
    }
  }
  return paystackRequest('POST', '/transaction/initialize', params)
}

export async function verifyTransaction(reference: string) {
  if (!PAYSTACK_SECRET) {
    return { status: true, data: { status: 'success', reference, amount: 0, metadata: {} } }
  }
  return paystackRequest('GET', `/transaction/verify/${reference}`)
}

export async function createTransfer(params: {
  source: 'balance'; amount: number; recipient: string; reason?: string; reference?: string
}) {
  if (!PAYSTACK_SECRET) return { status: true, data: { transfer_code: 'DEV_TRANSFER' } }
  return paystackRequest('POST', '/transfer', params)
}
