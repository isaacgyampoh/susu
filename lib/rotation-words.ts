import { format } from 'date-fns'

/**
 * ONE VOCABULARY FOR THE ROTATION.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Visual QA at 360px found the same fact written four different ways across
 * four screens a member moves between in seconds:
 *
 *   Home      "Slot 8"   "Collects 24 Oct 2026"   "Collection date not yet assigned"
 *   Payments  "Slot 8"   "½ slot"                 "Not set — ask your collector"
 *   Profile   "Slot 8"                            "No collection date assigned yet"
 *   Rotation  "#8"       "Half slot"              "Date not set"
 *
 * Four phrasings do not read as four styles; they read as four different
 * things, and a member trying to work out whether "Slot 8" and "#8" are the
 * same number has been given a puzzle instead of an answer.
 *
 * ── WHY "SLOT" HAD TO GO ───────────────────────────────────────────────────
 *
 * It was also wrong. Since payout units, a turn can be held by two half slots
 * or four quarters — so two people share "Slot 8", and a word implying sole
 * ownership actively misleads. The turn has a number; a member holds a share
 * of it. `payoutLabel` says the first, `shareLabel` says the second.
 *
 * Every screen imports from here so the next screen cannot invent a fifth way.
 */

/** The turn's number, as a member reads it. Shared turns show the same one. */
export const payoutLabel = (position: number | null | undefined) =>
  position == null ? 'No payout number yet' : `Payout #${position}`

/** The same number where space is tight — lists, chips, table cells. */
export const payoutShort = (position: number | null | undefined) =>
  position == null ? '—' : `#${position}`

/**
 * What a member holds of that turn.
 *
 * Spelled out rather than "½": a fraction glyph next to a slot number reads as
 * arithmetic on the number, which is exactly the confusion to avoid.
 */
export function shareLabel(fraction: number | null | undefined): string | null {
  const f = Number(fraction ?? 1)
  if (f === 1)    return 'Full slot'
  if (f === 0.5)  return 'Half slot'
  if (f === 0.25) return 'Quarter slot'
  return null
}

/** The one phrasing for a date the collector has not set. */
export const NO_DATE = 'Date not set'

/**
 * A date the collector has not set, with somewhere to go about it.
 *
 * The longer form belongs where a member might act on it; the bare `NO_DATE`
 * belongs in lists, where eight rows of advice is noise.
 */
export const NO_DATE_HELP = 'Date not set — ask your collector'

export const collectionDate = (d: string | null | undefined) =>
  d ? format(new Date(d + 'T12:00:00Z'), 'd MMM yyyy') : null

/** "Collects 24 Oct 2026", or the one agreed phrase when there is no date. */
export const collectionLine = (d: string | null | undefined) => {
  const when = collectionDate(d)
  return when ? `Collects ${when}` : NO_DATE
}
