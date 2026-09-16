'use client'
import { format } from 'date-fns'
import { ghs } from '@/lib/money'
import { cx } from '@/components/ui'

/* ---------------------------------------------------------------------------
   THE ROTATION, AS A MEMBER SEES IT

   A susu is an order of turns. Knowing you hold turn 8 is not much use on its
   own; knowing somebody collects on 12 September is what makes this week's
   contribution feel like it matters.

   ── A TURN IS NOT A PERSON ─────────────────────────────────────────────────

   Four quarter-shares make a turn. Two halves are one turn, and the two people
   holding them collect on the same day under the same number. So the rotation
   list is one row per TURN, not per member — an earlier version listed one row
   per membership, which showed a shared turn twice with no way to tell that
   from a duplicate.

   ── WHAT THESE COMPONENTS NEVER RECEIVE ────────────────────────────────────

   No name, no phone, no other member's payout. Not "receive and hide" —
   `get_member_rotation` does not read the members table at all and returns NULL
   for anyone else's amount, so there is nothing here to leak. A component that
   hides private data with CSS is one devtools tab away from not hiding it.

   A member is told their OWN turn is shared and what their own share is. Who
   they share it with, and for how much, never arrives.
   ------------------------------------------------------------------------ */

export interface Seat {
  position: number
  date: string | null
  is_you: boolean
  received?: boolean
  /** The caller's own figure only. Always null for a turn they do not hold. */
  amount?: number | null
}

export interface Rotation {
  group: { id: string; name: string; payment_deadline: string | null } | null
  next: { position: number; date: string; is_you: boolean } | null
  mine: {
    membership_id: string
    position: number
    date: string | null
    amount: number | null
    received: boolean
    is_next: boolean
    slot_fraction: number
    /** "Full slot" | "Half slot" | "Quarter slot" — the member's own share. */
    share_label: string | null
    /** Whether somebody else holds the rest of this turn. Never who. */
    shares_turn: boolean
  } | null
  upcoming: Seat[]
  collected: number
  total_slots: number
}

const when = (d?: string | null) =>
  d ? format(new Date(d + 'T12:00:00Z'), 'd MMMM yyyy') : null
const shortWhen = (d?: string | null) =>
  d ? format(new Date(d + 'T12:00:00Z'), 'd MMM') : null

/** Whole days from today. Negative is in the past. */
function daysAway(d: string): number {
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.round((new Date(d + 'T12:00:00Z').getTime() - t.getTime()) / 86400000)
}

/* ── One headline ────────────────────────────────────────────────────────────
   Two treatments, and the difference between them carries the meaning.

   `fill` — the member's OWN payout. A lime panel with ink on it: the one thing
   they came to look at, and the only block on the screen that is a colour. Ink
   on this lime is 12.6:1, better than the body text it sits beside, so the
   brightest thing on the page is also the most legible.

   `quiet` — everything else. A label, a number, a date, one hairline. Stacking
   two filled cards would spend the whole screen shouting and leave the member
   to work out which one is theirs. */
function Payout({
  label, position, date, status, tone, note,
}: {
  label: string
  position: number | null
  date: string | null
  status?: string
  tone: 'fill' | 'quiet'
  note?: string
}) {
  const filled = tone === 'fill'
  return (
    <div className={cx(filled ? 'rounded-xl bg-pop p-4' : 'py-3.5')}>
      <p className={cx('t-eyebrow', filled && '!text-ink/60')}>{label}</p>

      {position === null ? (
        <p className={cx('text-sm mt-1.5 leading-relaxed', filled ? 'text-ink/75' : 'text-ink-2')}>
          {note}
        </p>
      ) : (
        <>
          <p className="flex items-baseline gap-2 mt-1">
            <span className={cx(
              'font-display font-semibold tracking-[-.025em] tnum text-ink',
              filled ? 'text-3xl' : 'text-xl',
            )}>
              #{position}
            </span>
            <span className={cx('text-base tnum truncate', filled ? 'text-ink/70' : 'text-ink-2')}>
              {when(date) ?? 'Date not set'}
            </span>
          </p>
          {(status || note) && (
            <p className={cx('text-xs mt-1 leading-relaxed', filled ? 'text-ink/65' : 'text-ink-3')}>
              {status}{status && note ? ' · ' : ''}{note}
            </p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The two headlines: the turn coming next, and the member's own.
 *
 * When the member IS next, one headline says so rather than two describing the
 * same turn as though they belonged to different people.
 */
export function PayoutHeadlines({ r }: { r: Rotation }) {
  const mine = r.mine
  const next = r.next

  // What a member holds — "Half slot, shared" — is their own membership, and a
  // half-slot holder who cannot see they hold a half cannot check their payout.
  const share = mine?.share_label
    ? `${mine.share_label}${mine.shares_turn ? ', shared turn' : ''}`
    : undefined

  if (mine?.is_next && mine.date) {
    const away = daysAway(mine.date)
    return (
      <Payout
        label="Your payout — you are next"
        position={mine.position}
        date={mine.date}
        tone="fill"
        status={
          away > 1 ? `In ${away} days`
          : away === 1 ? 'Tomorrow'
          : away === 0 ? 'Today'
          : undefined
        }
        note={[share, mine.amount != null ? `GHS ${ghs(mine.amount)}` : null]
          .filter(Boolean).join(' · ') || undefined}
      />
    )
  }

  return (
    <div className="space-y-2">
      <Payout
        label="My payout"
        position={mine?.position ?? null}
        date={mine?.date ?? null}
        tone="fill"
        status={mine?.received ? 'Already collected' : 'Your turn'}
        note={mine
          ? (mine.date
              ? [share, mine.amount != null ? `GHS ${ghs(mine.amount)}` : null]
                  .filter(Boolean).join(' · ') || undefined
              : 'Your collector has not set your date yet.')
          : 'You are not in a rotation yet.'}
      />
      {/* Second, and quiet. Whose turn is next matters, but not more than the
          member's own — the previous order put someone else's turn first and
          in the same weight. */}
      <div className="border-t border-line">
        <Payout
          label="Next payout"
          position={next?.position ?? null}
          date={next?.date ?? null}
          tone="quiet"
          status={next ? 'Next in the rotation' : undefined}
          note={next ? undefined : 'No collection date has been set for this group yet.'}
        />
      </div>
    </div>
  )
}

/**
 * The order of turns. One row per turn, whoever holds it.
 *
 * Number, date, status — and nothing else, because §15 of the brief is right
 * that a member does not need to know who is in the other turns and this is
 * exactly where that would leak in.
 */
export function RotationList({ seats, limit }: { seats: Seat[]; limit?: number }) {
  const rows = limit ? seats.slice(0, limit) : seats

  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-3 leading-relaxed">
        No upcoming turns. Every collection date in this group has either passed
        or has not been set yet.
      </p>
    )
  }

  return (
    <ol className="divide-y divide-line-2">
      {rows.map((s, i) => {
        const isNext = i === 0 && !s.received
        return (
          <li
            key={`${s.position}-${s.date ?? 'none'}`}
            /* The same lime family as the member's own payout tile above.
               It was a mint green — a second colour meaning "this is you",
               which makes the reader check whether it means something else. */
            className={cx(
              'flex items-baseline gap-3 py-3 min-h-[44px]',
              s.is_you && 'bg-pop-soft -mx-3 px-3 rounded-lg',
            )}
          >
            <span className="text-sm font-medium text-ink tnum shrink-0 w-[46px]">
              #{s.position}
            </span>

            <span className="text-sm text-ink-2 tnum flex-1 min-w-0">
              {shortWhen(s.date) ?? <span className="text-ink-3">Date not set</span>}
            </span>

            {/* Status is a word. Colour alone is not a status. */}
            <span className={cx(
              'text-xs font-medium shrink-0 text-right',
              s.is_you ? 'text-accent' : isNext ? 'text-ink' : 'text-ink-3',
            )}>
              {s.is_you ? 'You' : isNext ? 'Next' : 'Upcoming'}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Whether this member owes anything, in one line.
 *
 * Deliberately unalarming: an outstanding contribution is a normal state in a
 * daily susu, and a red banner every time somebody is a day behind teaches
 * people to ignore banners.
 */
export function ContributionStatus({
  outstanding, overdue, deadline,
}: { outstanding: number; overdue: number; deadline?: string | null }) {
  const owes = outstanding > 0.005
  const late = overdue > 0.005

  /* Coral ONLY when something is actually late. A colour that appears every
     day stops being a signal — and in a daily susu most members are mid-cycle
     and owe something, which is normal, not a problem. Ink on this coral is
     8.1:1, so the one time it does appear it is still comfortable to read. */
  return (
    <div className={cx(late ? 'rounded-xl bg-hot-soft border border-hot/35 p-4' : 'py-3.5')}>
      <p className={cx('t-eyebrow', late && '!text-ink/60')}>Contribution status</p>
      <p className="flex items-center gap-2 mt-1">
        <span aria-hidden="true" className={cx(
          'w-1.5 h-1.5 rounded-full shrink-0',
          late ? 'bg-hot' : owes ? 'bg-ink-3' : 'bg-success',
        )} />
        {/* The word carries it; the colour only reinforces. */}
        <span className="text-base font-medium text-ink">
          {late ? 'Overdue' : owes ? 'Payment due' : 'Up to date'}
        </span>
      </p>
      {(owes || deadline) && (
        <p className={cx('text-xs mt-1 leading-relaxed tnum',
                         late ? 'text-ink/70' : 'text-ink-3')}>
          {owes && `GHS ${ghs(outstanding)} outstanding`}
          {owes && late && `, of which GHS ${ghs(overdue)} is overdue`}
          {owes && '. '}
          {/* The consequence, said once, where the status is — not again in a
              second block four lines further down. */}
          {late && 'Anything still owing on your collection date is deducted from what you receive. '}
          {deadline && `Pay before ${deadline} each day.`}
        </p>
      )}
    </div>
  )
}
