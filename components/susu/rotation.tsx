'use client'
import { format } from 'date-fns'
import { ghs } from '@/lib/money'
import { cx } from '@/components/ui'

/* ---------------------------------------------------------------------------
   THE ROTATION, AS A MEMBER SEES IT

   A susu is an order of turns. A member knowing they hold position 8 is not
   much use on its own; knowing somebody collects on 12 September is what makes
   this week's contribution feel like it matters.

   ── WHAT THESE COMPONENTS NEVER RECEIVE ────────────────────────────────────

   No name, no phone, no other member's payout. Not "receive and hide" —
   `get_member_rotation` does not read the members table at all and returns NULL
   for anyone else's amount, so there is nothing here to leak. A component that
   hides private data with CSS is one devtools tab away from not hiding it.
   ------------------------------------------------------------------------ */

export interface Seat {
  position: number
  date: string | null
  is_you: boolean
  received?: boolean
  /** The caller's own figure only. Always null for another member's seat. */
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
  } | null
  upcoming: Seat[]
  collected: number
  total_slots: number
}

const when = (d?: string | null) =>
  d ? format(new Date(d + 'T12:00:00Z'), 'd MMMM yyyy') : null
const shortWhen = (d?: string | null) =>
  d ? format(new Date(d + 'T12:00:00Z'), 'd MMM yyyy') : null

/** Whole days from today. Negative is in the past. */
function daysAway(d: string): number {
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.round((new Date(d + 'T12:00:00Z').getTime() - t.getTime()) / 86400000)
}

/* ── One headline card ──────────────────────────────────────────────────
   Used for both Next and Mine, so the two read as the same kind of fact and
   differ only in what they say — not in how they are drawn. */
function PayoutCard({
  label, position, date, status, tone, note,
}: {
  label: string
  position: number | null
  date: string | null
  status: string
  tone: 'next' | 'mine'
  note?: string
}) {
  return (
    <div className={cx(
      'rounded-xl border p-4',
      tone === 'mine' ? 'border-ink/20 bg-surface' : 'border-line bg-surface-2',
    )}>
      <p className="t-eyebrow">{label}</p>

      {position === null ? (
        <p className="text-sm text-ink-2 mt-2 leading-relaxed">{note}</p>
      ) : (
        <>
          <p className="font-display text-xl font-semibold text-ink tracking-[-.02em] mt-1.5 tnum">
            Position {position}
          </p>
          <p className="text-base text-ink mt-0.5 tnum">
            {when(date) ?? 'Date not set yet'}
          </p>
          {/* Status is a word, never only a colour. */}
          <p className={cx(
            'text-xs font-medium mt-2',
            tone === 'mine' ? 'text-accent' : 'text-ink-2',
          )}>
            {status}
          </p>
          {note && <p className="text-xs text-ink-3 mt-1.5 leading-relaxed">{note}</p>}
        </>
      )}
    </div>
  )
}

/**
 * The two headline cards.
 *
 * When the member IS next, one card says so rather than two cards describing
 * the same turn as if they were different people's.
 */
export function PayoutHeadlines({ r }: { r: Rotation }) {
  const mine = r.mine
  const next = r.next

  if (mine?.is_next && mine.date) {
    const away = daysAway(mine.date)
    return (
      <PayoutCard
        label="Your payout — you are next"
        position={mine.position}
        date={mine.date}
        status="You collect next"
        tone="mine"
        note={
          away > 1 ? `In ${away} days. Keep your contributions up to date until then.`
          : away === 1 ? 'Tomorrow. Keep your contributions up to date until then.'
          : away === 0 ? 'Today.'
          : undefined
        }
      />
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <PayoutCard
        label="Next payout"
        position={next?.position ?? null}
        date={next?.date ?? null}
        status="Next in the rotation"
        tone="next"
        note={next
          ? undefined
          : 'No upcoming collection date has been set for this group yet.'}
      />
      <PayoutCard
        label="My payout"
        position={mine?.position ?? null}
        date={mine?.date ?? null}
        status={mine?.received ? 'Already collected' : 'Your turn'}
        tone="mine"
        note={mine
          ? (mine.date
              ? (mine.amount != null ? `You collect GHS ${ghs(mine.amount)}` : undefined)
              : 'Your collector has not set your date yet.')
          : 'You are not in a rotation yet.'}
      />
    </div>
  )
}

/**
 * The order of turns.
 *
 * Position, date, status. The member's own row is marked "You" in words as well
 * as weight, so it is findable without relying on colour.
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
            className={cx(
              'flex items-baseline gap-3 py-3 min-h-[44px]',
              s.is_you && 'bg-accent-soft -mx-3 px-3 rounded-lg',
            )}
          >
            <span className="text-sm font-medium text-ink tnum shrink-0 w-[92px]">
              Position {s.position}
            </span>

            <span className="text-sm text-ink-2 tnum flex-1 min-w-0">
              {shortWhen(s.date) ?? <span className="text-ink-3">Date not set</span>}
            </span>

            <span className={cx(
              'text-xs font-medium shrink-0 text-right',
              s.is_you ? 'text-accent' : isNext ? 'text-ink' : 'text-ink-3',
            )}>
              {s.is_you ? 'You' : isNext ? 'Next payout' : 'Upcoming'}
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
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="t-eyebrow">Payment status</p>
      <p className="flex items-center gap-2 mt-1.5">
        <span aria-hidden="true" className={cx(
          'w-1.5 h-1.5 rounded-full shrink-0',
          overdue > 0.005 ? 'bg-warning' : owes ? 'bg-ink-3' : 'bg-success',
        )} />
        <span className="text-base font-medium text-ink">
          {overdue > 0.005 ? 'Contribution overdue' : owes ? 'Contribution due' : 'Up to date'}
        </span>
      </p>
      {(owes || deadline) && (
        <p className="text-xs text-ink-2 mt-1.5 leading-relaxed tnum">
          {owes && `GHS ${ghs(outstanding)} outstanding across your groups.`}
          {owes && deadline ? ' ' : ''}
          {deadline && `Pay before ${deadline} each day.`}
        </p>
      )}
    </div>
  )
}
