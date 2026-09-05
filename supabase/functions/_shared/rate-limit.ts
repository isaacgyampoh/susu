import { supabaseAdmin } from './supabase-admin.ts'

/**
 * A RATE LIMIT FOR ENDPOINTS ANYONE CAN CALL.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Only the login endpoints had one. `kyc-submit` — the public application form,
 * no session required — writes a row, performs nine storage operations and
 * sends two SMS per call. Unlimited, that is a filled registration queue, a
 * filled bucket and a real SMS bill from one caller in a loop.
 *
 * ── THE KEY IS NEVER SUPPLIED BY THE CALLER ─────────────────────────────
 *
 * It is the request source, from the platform's own proxy header. A limiter
 * keyed on anything in the body or the query string is not a limiter: the
 * caller simply varies it. This is the same reasoning that decides how the
 * admin PIN gate is keyed.
 */

/** Trust the platform's proxy header; fall back to something rather than nothing. */
export function sourceOf(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  const ip = fwd?.split(',')[0]?.trim()
  return ip && ip.length > 0 ? ip : (req.headers.get('cf-connecting-ip') ?? 'unknown')
}

export interface Limit {
  allowed: boolean
  retryAfterSeconds: number
  hits: number
}

/**
 * Record this attempt and report whether it is allowed.
 *
 * FAILS OPEN. If the limiter itself errors, the request proceeds: a database
 * hiccup must not stop a real applicant submitting their registration. The
 * limiter protects against volume, and volume is exactly when the database is
 * least likely to be the thing that broke.
 */
export async function rateLimit(
  req: Request,
  bucket: string,
  max: number,
  minutes: number,
  keyOverride?: string,
): Promise<Limit> {
  try {
    const { data, error } = await supabaseAdmin.rpc('hit_rate_limit', {
      p_bucket: bucket,
      p_key: keyOverride ?? sourceOf(req),
      p_max: max,
      p_minutes: minutes,
    })
    if (error || !data?.[0]) {
      console.error(`rate limit ${bucket} unavailable:`, error?.message)
      return { allowed: true, retryAfterSeconds: 0, hits: 0 }
    }
    const r = data[0]
    return {
      allowed: r.allowed !== false,
      retryAfterSeconds: Number(r.retry_after_seconds ?? 0),
      hits: Number(r.hits ?? 0),
    }
  } catch (e) {
    console.error(`rate limit ${bucket} threw:`, (e as Error).message)
    return { allowed: true, retryAfterSeconds: 0, hits: 0 }
  }
}

/** The message a blocked caller sees. Says when, not why — never a count. */
export function tooManyMessage(seconds: number, what: string): string {
  const mins = Math.max(1, Math.ceil(seconds / 60))
  return `Too many ${what}. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`
}
