const SECRET = Deno.env.get('JWT_SECRET') ?? 'susu-jwt-secret-change-in-production'
const EXPIRY = 60 * 60 * 24 * 7 // 7 days

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function decode64url(str: string): string {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'))
}

async function getKey(usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage
  )
}

export async function signJWT(payload: Record<string, unknown>): Promise<string> {
  const header  = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body    = base64url(new TextEncoder().encode(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + EXPIRY,
  })))
  const msg     = `${header}.${body}`
  const key     = await getKey(['sign'])
  const sig     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return `${msg}.${base64url(sig)}`
}

export async function verifyJWT(token: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, body, sig] = parts
    const key      = await getKey(['verify'])
    const sigBytes = Uint8Array.from(decode64url(sig), (c) => c.charCodeAt(0))
    const valid    = await crypto.subtle.verify(
      'HMAC', key, sigBytes, new TextEncoder().encode(`${header}.${body}`)
    )
    if (!valid) return null

    const payload = JSON.parse(decode64url(body))
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export async function requireAdmin(req: Request): Promise<Record<string, unknown> | null> {
  const auth = req.headers.get('authorization') ?? req.headers.get('x-admin-token')
  if (!auth) return null
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth
  const payload = await verifyJWT(token)
  if (!payload || payload.type !== 'admin') return null
  return payload
}

export async function requireMember(req: Request): Promise<Record<string, unknown> | null> {
  const auth = req.headers.get('authorization') ?? req.headers.get('x-member-token')
  if (!auth) return null
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth
  const payload = await verifyJWT(token)
  if (!payload || payload.type !== 'member') return null
  return payload
}
