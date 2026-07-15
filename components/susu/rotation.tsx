'use client'
import { format, addDays } from 'date-fns'

/**
 * Rotation — the queue.
 *
 * Susu members don't think in percentages, they think "I'm number 4."
 * So this is a numbered list, the way the collector's book records it.
 * Dates derive from slot × cycle length, which guarantees they're in order.
 */
export default function Rotation({
  total, position, cycleDays, startDate, collected,
}: {
  total: number
  position: number
  cycleDays: number
  startDate?: string | null
  collected: number
}) {
  if (!startDate) {
    return (
      <p className="text-dim-field text-[13px] py-3">
        Turn dates are set when the group starts.
      </p>
    )
  }
  const start = new Date(startDate)

  return (
    <div className="bg-field-2 rounded-[4px] p-1">
      {Array.from({ length: total }).map((_, i) => {
        const slot = i + 1
        const me   = slot === position
        const done = slot <= collected
        const date = addDays(start, slot * cycleDays)

        return (
          <div key={slot}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[2px] ${me ? 'bg-gold text-ink' : ''} ${i > 0 && !me ? 'border-t border-white/5' : ''}`}>
            <span className={`font-mono text-[12px] font-bold w-5 ${me ? '' : 'opacity-55'}`}>
              {String(slot).padStart(2, '0')}
            </span>
            <span className={`text-[13px] flex-1 ${me ? 'font-extrabold' : 'font-semibold'}`}>
              {me ? 'You' : `Member ${slot}`}
            </span>
            <span className={`text-[11px] font-semibold ${me ? 'opacity-75' : 'opacity-50'}`}>
              {format(date, 'd MMM')}
            </span>
            {done  && <span className="tag-done">Collected</span>}
            {me && !done && <span className="tag-me">Your turn</span>}
          </div>
        )
      })}
    </div>
  )
}
