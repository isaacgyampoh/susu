/**
 * Access-Control-Allow-Origin was '*': any site on the internet could call these
 * endpoints. Now an allowlist, driven by ALLOWED_ORIGINS.
 *
 * This is not what stops a stolen token being used — a token works from curl,
 * with or without CORS. What it stops is a hostile page in a member's browser
 * scripting our endpoints, and it removes casual scraping and abuse of the
 * public ones.
 */
const CONFIGURED = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

const FALLBACK = [
  'https://abbiewealthsusu.com',
  'https://www.abbiewealthsusu.com',
  'https://admin.abbiewealthsusu.com',
  'https://my.abbiewealthsusu.com',
]

const ALLOWED = CONFIGURED.length ? CONFIGURED : FALLBACK

function originFor(req: Request): string {
  const o = req.headers.get('origin') ?? ''
  if (ALLOWED.includes(o)) return o
  // Vercel previews and local work stay usable without opening the door wide
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o)) return o
  if (/^http:\/\/localhost:\d+$/.test(o)) return o
  return ALLOWED[0]
}

export function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': originFor(req),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-member-token, x-admin-token, x-paystack-signature, x-cron-secret',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

/** Kept so existing imports still work; prefer cors(req). */
export const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED[0],
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-member-token, x-admin-token, x-paystack-signature, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Vary': 'Origin',
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  return null
}

export function json(data: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...(req ? cors(req) : corsHeaders),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',   // never let a proxy hold someone's balance
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function error(message: string, status = 400, req?: Request): Response {
  return json({ error: message }, status, req)
}
