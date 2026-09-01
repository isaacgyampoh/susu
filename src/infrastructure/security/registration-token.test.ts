import { describe, it, expect } from 'vitest'
import {
  issueRegistrationToken, hashToken, looksLikeToken, TOKEN_TTL_DAYS,
} from '../../../supabase/functions/_shared/registration-token'

/**
 * The applicant's payment link is a CREDENTIAL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * An applicant has no account, so the token in the URL is the only thing
 * standing between one applicant and another's registration. It lives in
 * infrastructure, not the domain, because it is inherently about a platform
 * CSPRNG and a hash function — but it is tested here rather than trusted,
 * because "unpredictable" is a claim, and a claim about a credential should
 * have a test under it.
 *
 * These import the REAL module the edge function uses. It has no Deno-specific
 * imports precisely so that this is possible: `crypto.getRandomValues`,
 * `crypto.subtle` and `btoa` are standard in both runtimes.
 */

describe('registration token — unpredictable', () => {
  it('is 256 bits of CSPRNG output, base64url encoded', async () => {
    const { token } = await issueRegistrationToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)   // 32 bytes → 43 chars unpadded
  })

  it('never repeats across a thousand issues', async () => {
    const tokens = await Promise.all(
      Array.from({ length: 1000 }, () => issueRegistrationToken().then(t => t.token)))
    expect(new Set(tokens).size).toBe(1000)
  })

  it('shows no positional bias a guesser could exploit', async () => {
    // A weak generator — a timestamp, a counter, a truncated uuid — leaks
    // structure by holding characters constant at some positions. With 500
    // samples, every position of a real CSPRNG output should vary.
    const tokens = await Promise.all(
      Array.from({ length: 500 }, () => issueRegistrationToken().then(t => t.token)))
    const frozen: number[] = []
    for (let i = 0; i < 43; i++) {
      if (new Set(tokens.map(t => t[i])).size < 8) frozen.push(i)
    }
    expect(frozen, `positions with almost no variation: ${frozen}`).toEqual([])
  })

  it('shares no prefix between consecutive issues', async () => {
    // Time-seeded generators produce neighbouring values in quick succession.
    const a = await issueRegistrationToken()
    const b = await issueRegistrationToken()
    let shared = 0
    while (shared < 43 && a.token[shared] === b.token[shared]) shared++
    expect(shared).toBeLessThan(4)
  })
})

describe('registration token — the raw token is never what is stored', () => {
  it('hashes to 64 hex characters', async () => {
    const { token, hash } = await issueRegistrationToken()
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(token)
  })

  it('is deterministic, so an indexed lookup is possible', async () => {
    const { token, hash } = await issueRegistrationToken()
    expect(await hashToken(token)).toBe(hash)
  })

  it('gives a completely different hash for a one-character change', async () => {
    const { token, hash } = await issueRegistrationToken()
    const tweaked = (token[0] === 'a' ? 'b' : 'a') + token.slice(1)
    expect(await hashToken(tweaked)).not.toBe(hash)
  })

  it('matches the SHA-256 the database computes', async () => {
    // The database looks a token up with encode(digest(token,'sha256'),'hex').
    // If these two ever disagreed, every payment link would silently 404 —
    // and the failure would look like an expiry bug rather than a hash bug.
    // Both vectors below were read back from production alongside this test.
    expect(await hashToken('abc'))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await hashToken('token-under-test'))
      .toBe('dc33894a36d99e262fd7d79636121e5d1798acd098cf25984e881b750fdbf5c6')
  })
})

describe('registration token — malformed input never reaches the database', () => {
  it('rejects everything that is not exactly our shape', () => {
    for (const bad of [
      '', 'short', null, undefined, 42, {}, [],
      'a'.repeat(42), 'a'.repeat(44),
      "'; DROP TABLE kyc_applications; --",
      '../../etc/passwd',
      'A'.repeat(43) + '=',            // padded base64
      'A'.repeat(42) + '+',            // standard-alphabet base64
      'A'.repeat(42) + '/',
    ]) {
      expect(looksLikeToken(bad as unknown), String(bad)).toBe(false)
    }
  })

  it('accepts a freshly issued token', async () => {
    const { token } = await issueRegistrationToken()
    expect(looksLikeToken(token)).toBe(true)
  })
})

describe('registration token — expiry', () => {
  it('expires, and within a fortnight', async () => {
    const { expiresAt } = await issueRegistrationToken()
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(TOKEN_TTL_DAYS - 0.01)
    expect(days).toBeLessThan(TOKEN_TTL_DAYS + 0.01)
    expect(TOKEN_TTL_DAYS).toBeLessThanOrEqual(30)
  })
})
