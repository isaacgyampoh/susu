'use client'
import { format, isSameDay, isBefore, startOfDay } from 'date-fns'
import type { Contribution } from '@/types'

/**
 * StampCard — the susu collector's card, stripped to structure.
 *
 * A grid of day-boxes, filled when paid. It's the artifact this practice
 * already runs on, and it solves a real problem: 11 members x 30 days = 330
 * payments, unshowable as a list — but one cycle is exactly one card.
 */
export default function StampCard({
  contributions, cycleDays, onPayDay, payingId,
}: {
  contributions: Contribution[]
  cycleDays: number
  onPayDay?: (c: Contribution) => void
  payingId?: string | null
}) {
  const today = startOfDay(new Date())

  // Show the cycle the member is actually living in
  const firstUnpaid = contributions.find(c => c.status !== 'paid')
  const anchorIdx   = firstUnpaid ? contributions.indexOf(firstUnpaid) : Math.max(contributions.length - 1, 0)
  const cycleNo     = Math.floor(anchorIdx / cycleDays)
  const slice       = contributions.slice(cycleNo * cycleDays, (cycleNo + 1) * cycleDays)
  if (!slice.length) return null

  const cols = cycleDays > 24 ? 10 : cycleDays > 12 ? 8 : 7

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <p className="t-label">Cycle {cycleNo + 1}</p>
        <p className="t-meta !text-[11px]">
          {format(new Date(slice[0].due_date), 'd MMM')} – {format(new Date(slice[slice.length - 1].due_date), 'd MMM')}
        </p>
      </div>

      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {slice.map((c, i) => {
          const due     = new Date(c.due_date)
          const paid    = c.status === 'paid'
          const isToday = isSameDay(due, today)
          const late    = !paid && isBefore(due, today)
          const dayNo   = cycleNo * cycleDays + i + 1

          const cls   = paid ? 'box box-paid' : late ? 'box box-late' : isToday ? 'box box-today' : 'box'
          const label = `Day ${dayNo}, ${format(due, 'd MMM')} — ${paid ? 'paid' : late ? 'missed' : `GHS ${c.amount} due`}`

          if (!paid && onPayDay) return (
            <button key={c.id} onClick={() => onPayDay(c)} disabled={payingId === c.id}
              className={`${cls} hover:border-ink disabled:opacity-40`} title={label} aria-label={label}>
              {payingId === c.id ? '·' : dayNo}
            </button>
          )
          return <div key={c.id} className={cls} title={label} aria-label={label}>{paid ? '' : dayNo}</div>
        })}
      </div>

      <div className="flex gap-4 mt-3 t-meta !text-[11px]">
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 bg-ink rounded-[1px]" />Paid</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 border border-line rounded-[1px]" />Due</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 border border-alert rounded-[1px]" />Missed</span>
      </div>
    </div>
  )
}
