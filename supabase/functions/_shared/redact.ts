/**
 * KEEPING CREDENTIALS OUT OF THE PLACES A MESSAGE GOES AFTERWARDS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two SMS templates carry a member's passcode, because an SMS is how a new
 * member receives it. That part is correct. What was not correct is that the
 * message was then written verbatim into `sms_log` and into the function logs,
 * leaving 27 members' passcodes in plaintext in a database table indefinitely.
 *
 * The passcode in `members` is hashed. Plaintext sitting beside it in another
 * table undoes that entirely — a hash is only worth something if the original
 * is nowhere.
 *
 * Its own file, with no Deno dependency, for two reasons: `africas-talking.ts`
 * reads `Deno.env` at module load and so cannot be imported by the test runner,
 * and a security guarantee that nothing checks is only a claim. See
 * `src/infrastructure/security/redact.test.ts`.
 */

/**
 * Strip credential values while keeping the shape of the message.
 *
 * What the operator needs from a delivery log is "was a welcome SMS sent to
 * this person, when, and did it arrive" — all of which survives redaction.
 */
export function redactSecrets(message: string): string {
  return message
    // "Passcode: 4821 | Sign in: …" → label kept, value gone. Stops at
    // whitespace or the `|` separator, so the rest of the message survives.
    .replace(/(passcode:\s*)([^\s|]+)/gi, '$1[redacted]')
    .replace(/(\bPIN:\s*)([^\s|]+)/gi, '$1[redacted]')
    // A passcode quoted on its own — "your passcode is 4821".
    .replace(/(\bpasscode\s+is\s+)(\S+)/gi, '$1[redacted]')
}

/**
 * Does this text still contain a credential?
 *
 * Used by the test and by the scrub check, so "is it clean?" is answered by one
 * definition rather than by a regex retyped at each call site — the first
 * version of that check matched the word `[redacted]` itself and reported 27
 * leaks that were already fixed.
 */
export function containsSecret(message: string): boolean {
  return /(passcode:|(?:\bPIN:)|\bpasscode\s+is)\s*(?!\[redacted\])\S/i.test(message)
}
