import { supabaseAdmin } from './supabase-admin.ts'

/*
 * ────────────────────────────────────────────────────────────────────────
 *  Passcode hashing. One entry point, and it fails closed.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Six call sites used to write the hash like this:
 *
 *     const { data: hash } = await supabaseAdmin.rpc('hash_passcode', {...})
 *     await supabaseAdmin.from('members')
 *       .update({ passcode_hash: hash ?? passcode })      // ← the bug
 *
 * When the RPC returned nothing — an error, a permissions change, a dropped
 * connection — that `?? passcode` wrote the member's six-digit PIN into the
 * database IN CLEAR TEXT. Two things then happened, both bad:
 *
 *   1. The PIN sat readable in members.passcode_hash.
 *   2. The member was locked out anyway, because verification does
 *      crypt(pin, stored_hash) and "123456" is not a valid bcrypt salt, so
 *      it could never match. A silent lockout AND a plaintext credential.
 *
 * A seventh site wrote `passcode_hash: hash` with no fallback, which stores
 * NULL on failure — same silent lockout, no plaintext.
 *
 * There is no sensible fallback for "we could not hash this credential". The
 * only correct behaviour is to abort before anything is written, so the caller
 * returns an error and the member's record is left untouched.
 */

/**
 * Generate a 6-digit passcode from the CSPRNG.
 *
 * Every call site previously used:
 *
 *     Math.floor(100000 + Math.random() * 900000).toString()
 *
 * `Math.random()` is not cryptographically secure. V8's generator is seeded
 * once per context and its internal state can be recovered from a modest run
 * of outputs — so an attacker who can observe a handful of issued passcodes
 * (by registering, or by being a member through a batch invite) can predict
 * the ones issued around them. These are account credentials for a system
 * holding people's savings; they must come from `crypto.getRandomValues`.
 *
 * Rejection sampling rather than a modulo: `% 900000` over a uint32 range
 * biases the low end of the interval. The bias is small, but there is no
 * reason to accept any.
 */
export function generatePasscode(): string {
  const LOW = 100000, SPAN = 900000
  const LIMIT = Math.floor(0xFFFFFFFF / SPAN) * SPAN   // largest unbiased bound
  const buf = new Uint32Array(1)
  let v: number
  do {
    crypto.getRandomValues(buf)
    v = buf[0]!
  } while (v >= LIMIT)
  return String(LOW + (v % SPAN))
}

/** A bcrypt hash from pgcrypto's crypt()/gen_salt('bf'). */
const BCRYPT = /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/

export class PasscodeHashError extends Error {
  constructor(cause: string) {
    super(`Could not secure the passcode (${cause}). Nothing was saved — please try again.`)
    this.name = 'PasscodeHashError'
  }
}

/**
 * Hash a passcode via pgcrypto. Throws PasscodeHashError rather than ever
 * returning something unusable — callers must not have a way to store a
 * non-hash by accident.
 */
export async function hashPasscode(passcode: string): Promise<string> {
  const pin = String(passcode ?? '')
  if (!/^\d{4,10}$/.test(pin)) throw new PasscodeHashError('not a valid passcode')

  const { data, error } = await supabaseAdmin.rpc('hash_passcode', { p_passcode: pin })
  if (error) throw new PasscodeHashError(error.message)

  const hash = typeof data === 'string' ? data : null
  if (!hash) throw new PasscodeHashError('hashing returned nothing')

  // Belt and braces: if this is not a bcrypt hash, something upstream changed
  // and we must not persist whatever it is.
  if (!BCRYPT.test(hash)) throw new PasscodeHashError('hashing returned an unexpected value')
  if (hash === pin)       throw new PasscodeHashError('hashing did not transform the passcode')

  return hash
}

/**
 * Wraps a handler so a PasscodeHashError becomes a clean 500 instead of an
 * unhandled throw. Keeps the failure legible to the operator without leaking
 * the passcode into a log line.
 */
export function passcodeErrorResponse(
  e: unknown,
  error: (m: string, s?: number) => Response,
): Response | null {
  if (e instanceof PasscodeHashError) {
    console.error('passcode hashing failed:', e.message)
    return error(e.message, 500)
  }
  return null
}
