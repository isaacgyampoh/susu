'use client'
import { format, isSameDay, isBefore, startOfDay } from 'date-fns'
import type { Contribution } from '@/types'

/**
 * The contribution grid for the member's current cycle.
 * 11 members x 30 days = 330 payments is unshowable as a list,
 * but one cycle fits on one screen.
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
  const firstUnpaid = contributions.find(c => c.status !== 'paid')
  const anchorIdx   = firstUnpaid ? contributions.indexOf(firstUnpaid) : Math.max(contributions.length - 1, 0)
  const cycleNo     = Math.floor(anchorIdx / cycleDays)
  const slice       = contributions.slice(cycleNo * cycleDays, (cycleNo + 1) * cycleDays)
  if (!slice.length) return null

  const cols = cycleDays > 24 ? 10 : cycleDays > 12 ? 8 : 7
  const paidCount = slice.filter(c => c.status === 'paid').length

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <p className="t-h2">Cycle {cycleNo + 1}</p>
        <p className="t-meta">{paidCount} of {slice.length} paid</p>
      </div>

      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {slice.map((c, i) => {
          const due     = new Date(c.due_date)
          const paid    = c.status === 'paid'
          const isToday = isSameDay(due, today)
          const late    = !paid && isBefore(due, today)
          const dayNo   = cycleNo * cycleDays + i + 1
          const cls     = paid ? 'box box-paid' : late ? 'box box-late' : isToday ? 'box box-today' : 'box'
          const label   = `Day ${dayNo}, ${format(due, 'd MMM')} — ${paid ? 'paid' : late ? 'missed' : `GHS ${c.amount} due`}`

          if (!paid && onPayDay) return (
            <button key={c.id} onClick={() => onPayDay(c)} disabled={payingId === c.id}
              className={`${cls} hover:border-ink disabled:opacity-40`} title={label} aria-label={label}>
              {payingId === c.id ? '·' : dayNo}
            </button>
          )
          return <div key={c.id} className={cls} title={label} aria-label={label}>{dayNo}</div>
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3.5 t-meta !text-[11.5px]">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-[3px] bg-ink" />Paid</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-[3px] border border-line bg-paper" />Due</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-[3px] bg-amber-50 border border-ink" />Today</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-[3px] bg-red-50 border border-red/40" />Missed</span>
      </div>
    </div>
  )
}
