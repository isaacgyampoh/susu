/**
 * The applicant's payment link.
 *
 * ────────────────────────────────────────────────────────────────────────
 * An applicant is not a member. They have no account, no passcode and no JWT,
 * so the link they follow to pay their registration fee IS their credential.
 * That forces three properties, and the design follows from them:
 *
 *   UNPREDICTABLE — 32 bytes from the platform CSPRNG. Not a database id, not
 *   a timestamp, not a counter. `Math.random()` is not used anywhere near this
 *   file: it is seeded predictably and its output is recoverable from a
 *   handful of samples.
 *
 *   NOT STORED — only the SHA-256 of the token goes into the database. A
 *   reader of `kyc_applications` — a leaked backup, a support query, a
 *   compromised console — cannot reconstruct any applicant's link. This is the
 *   same reason passcodes are bcrypted rather than kept.
 *
 *   SHORT-LIVED — 14 days. Long enough that someone who applies on a Friday
 *   and pays on payday still has a working link; short enough that a link
 *   forwarded through a family WhatsApp group stops working. Expiry is
 *   enforced in `get_registration_public()`, in SQL, not here.
 *
 * The token identifies ONE application and grants exactly one capability:
 * paying that application's registration fee. It cannot read the applicant's
 * Ghana Card, cannot change the application, and confers nothing
 * administrative.
 */

/** Days a freshly issued link stays usable. */
export const TOKEN_TTL_DAYS = 14

/**
 * A new payment token. Returns the raw token — which is sent to the applicant
 * and never persisted — and the hash, which is what the database stores.
 */
export async function issueRegistrationToken(): Promise<{
  token: string
  hash: string
  expiresAt: string
}> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)

  // base64url: URL-safe, so the token survives being pasted into a browser,
  // an SMS, or a QR code without escaping.
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000)

  return { token, hash: await hashToken(token), expiresAt: expires.toISOString() }
}

/**
 * The lookup key for a presented token.
 *
 * SHA-256 rather than bcrypt, deliberately: bcrypt's salt makes it impossible
 * to look a value up by index, and this needs to be an indexed equality
 * search. The property bcrypt buys — resistance to brute-forcing a weak
 * secret — is irrelevant here, because the secret is 256 uniform random bits
 * rather than a six-digit PIN. Passcodes remain bcrypted; they are guessable
 * and these are not.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Reject anything that cannot be one of our tokens before it reaches the
 * database. Cheap, and it keeps malformed input out of the query path.
 */
export function looksLikeToken(t: unknown): t is string {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t)
}
