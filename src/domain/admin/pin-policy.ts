/**
 * WHICH ADMINISTRATOR PINs ARE TOO EASY TO GUESS.
 *
 * ────────────────────────────────────────────────────────────────────────
 * This module does NOT enforce anything. The authority is
 * `change_admin_password()` in the database, which refuses a bad PIN whatever
 * route the caller took to reach it. What lives here is the console's copy,
 * and it exists for one reason: so somebody typing a new PIN is told why it
 * will be refused before a round trip, rather than after.
 *
 * A second copy of a rule is a liability unless something checks that the two
 * still agree. `pin-policy.test.ts` walks all 10,000 PINs and asserts this
 * function and the database's `IN (...)` lists reject an identical set — so a
 * rule tightened in one place and forgotten in the other fails the build
 * instead of quietly making the console stricter than the system it fronts.
 *
 * That asymmetry is the one that actually hurts. A console stricter than the
 * server merely annoys; a console LOOSER than the server promises a PIN will
 * be accepted and then shows a refusal the user was given no warning about.
 * ────────────────────────────────────────────────────────────────────────
 */

/** The PIN this system ships with. Published in the setup instructions. */
export const SHIPPED_PIN = '1024'

/** Exactly four digits — the shape sign-in can authenticate. */
export function isWellFormedPin(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

/** All four digits the same: 0000, 1111, … 9999. */
function isRepeated(pin: string): boolean {
  return new Set(pin).size === 1
}

/** Four consecutive digits, ascending or descending: 1234, 9876, 3210. */
function isRun(pin: string): boolean {
  const d = [...pin].map(Number)
  const step = d[1] - d[0]
  if (step !== 1 && step !== -1) return false
  return d.every((n, i) => i === 0 || n - d[i - 1] === step)
}

/**
 * True when the PIN is one an attacker tries first. Out of 10,000 PINs these
 * are a rounding error — but they are where guessing starts, so they are worth
 * refusing even though the rate limit is what really does the work.
 */
export function isTrivialPin(pin: string): boolean {
  if (!isWellFormedPin(pin)) return false   // shape is a separate question
  return isRepeated(pin) || isRun(pin)
}

/** The console's reason to show, or null when the PIN is acceptable. */
export function rejectNewPin(next: string, current: string): string | null {
  if (!isWellFormedPin(next)) return 'Your new PIN must be exactly 4 digits'
  if (next === current)       return 'Choose a PIN you have not used'
  if (next === SHIPPED_PIN)   return 'That is the PIN this system shipped with. Choose another.'
  if (isTrivialPin(next))     return 'That PIN is too easy to guess. Avoid runs and repeated digits.'
  return null
}
