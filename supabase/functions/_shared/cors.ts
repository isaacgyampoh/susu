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


/**
 * Wraps a handler so CORS is applied to whatever it returns.
 *
 * The previous design had json()/error() take an optional `req` to resolve the
 * allowed origin. Every call site that forgot it silently fell back to a
 * hardcoded origin — which the browser then rejected, surfacing as "Failed to
 * fetch" with no clue as to why. Correctness must not depend on remembering an
 * argument in 100 places.
 *
 * Here the origin is resolved once, at the boundary, from the request that is
 * definitely in scope. Handlers cannot get it wrong because they no longer
 * touch it.
 */
export function serveWithCors(handler: (req: Request) => Promise<Response> | Response) {
  Deno.serve(async (req) => {
    const headers = cors(req)

    if (req.method === 'OPTIONS') return new Response('ok', { headers })

    try {
      const res = await handler(req)

      // A signed URL redirect or a CSV download must keep its own headers;
      // we only overlay the CORS ones.
      const merged = new Headers(res.headers)
      for (const [k, v] of Object.entries(headers)) merged.set(k, v)
      return new Response(res.body, { status: res.status, headers: merged })
    } catch (e) {
      console.error('unhandled:', e)
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }
  })
}
