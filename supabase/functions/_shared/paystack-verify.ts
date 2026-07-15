/**
 * Paystack signs every webhook with HMAC-SHA512 of the raw body, using your
 * secret key, in the x-paystack-signature header.
 *
 * Without this check the webhook is an open endpoint that marks contributions
 * paid from any POST body — i.e. free money. This is not optional.
 */
const SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time compare — a plain === leaks timing information. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyPaystackSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!SECRET)    return false   // no key configured: reject, never fall open
  if (!signature) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  return safeEqual(toHex(mac), signature.trim().toLowerCase())
}

export function isPaystackConfigured(): boolean {
  return !!SECRET
}
