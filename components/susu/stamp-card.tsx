'use client'
import { format, isSameDay, isBefore, startOfDay } from 'date-fns'
import type { Contribution } from '@/types'

/**
 * StampCard — the susu collector's card.
 *
 * A grid of day-boxes, stamped in red when paid. It's the artifact this whole
 * practice already runs on, so it needs no explaining to anyone who has ever
 * paid susu in a Ghanaian market.
 *
 * It also solves a real problem: 11 members × 30 days = 330 payments, which is
 * unshowable as a list. But ONE CYCLE is exactly one card.
 */
export default function StampCard({
  contributions,
  cycleDays,
  onPayDay,
  payingId,
}: {
  contributions: Contribution[]
  cycleDays: number
  onPayDay?: (c: Contribution) => void
  payingId?: string | null
}) {
  const today = startOfDay(new Date())

  // Show the cycle the member is actually living in, not cycle 1 forever
  const firstUnpaid = contributions.find(c => c.status !== 'paid')
  const anchor      = firstUnpaid ?? contributions[contributions.length - 1]
  const anchorIdx   = anchor ? contributions.indexOf(anchor) : 0
  const cycleNo     = Math.floor(anchorIdx / cycleDays)
  const slice       = contributions.slice(cycleNo * cycleDays, (cycleNo + 1) * cycleDays)

  if (slice.length === 0) return null

  const cols = cycleDays > 24 ? 10 : cycleDays > 12 ? 8 : 7

  return (
    <div>
      <p className="stencil text-dim mb-2.5">
        Cycle {cycleNo + 1} — {format(new Date(slice[0].due_date), 'd MMM')} to {format(new Date(slice[slice.length - 1].due_date), 'd MMM')}
      </p>

      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {slice.map((c, i) => {
          const due     = new Date(c.due_date)
          const paid    = c.status === 'paid'
          const isToday = isSameDay(due, today)
          const late    = !paid && isBefore(due, today)
          const dayNo   = cycleNo * cycleDays + i + 1

          const cls = paid ? 'box box-paid' : late ? 'box box-late' : isToday ? 'box box-today' : 'box'
          const label = paid
            ? `Day ${dayNo}, ${format(due, 'd MMM')} — paid`
            : late ? `Day ${dayNo}, ${format(due, 'd MMM')} — missed`
            : `Day ${dayNo}, ${format(due, 'd MMM')} — GHS ${c.amount}`

          // Only unpaid boxes are actionable — a stamped box is history
          if (!paid && onPayDay) {
            return (
              <button key={c.id} onClick={() => onPayDay(c)} disabled={payingId === c.id}
                className={`${cls} hover:border-ink disabled:opacity-50`} title={label} aria-label={label}>
                {payingId === c.id ? <span className="animate-pulse">·</span> : late ? '✕' : dayNo}
              </button>
            )
          }
          return (
            <div key={c.id} className={cls} title={label} aria-label={label}>
              {paid ? <span className="text-[13px] font-black leading-none -rotate-[8deg]">✓</span>
                : late ? '✕' : dayNo}
            </div>
          )
        })}
      </div>
    </div>
  )
}
