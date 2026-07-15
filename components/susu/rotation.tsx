'use client'
import { format, addDays } from 'date-fns'

/** The rotation queue — members think "I'm number 4", not in percentages. */
export default function Rotation({
  total, position, cycleDays, startDate, collected,
}: {
  total: number; position: number; cycleDays: number
  startDate?: string | null; collected: number
}) {
  if (!startDate) return <p className="t-meta py-3">Collection dates are set when the group starts.</p>
  const start = new Date(startDate)

  return (
    <div className="divide-y divide-line">
      {Array.from({ length: total }).map((_, i) => {
        const slot = i + 1
        const me   = slot === position
        const done = slot <= collected
        return (
          <div key={slot} className={`flex items-center gap-3 py-3 px-3 -mx-3 ${me ? 'bg-blue-lt rounded-[10px]' : ''}`}>
            <span className={`w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ${
              me ? 'bg-blue text-white' : done ? 'bg-blue-lt text-blue' : 'bg-blue-lt/60 text-ink-3'
            }`}>{slot}</span>
            <span className={`text-[13.5px] flex-1 ${me ? 'font-bold' : 'font-medium text-ink-2'}`}>
              {me ? 'You' : `Member ${slot}`}
            </span>
            <span className="t-meta whitespace-nowrap">{format(addDays(start, slot * cycleDays), 'd MMM')}</span>
            {done ? <span className="pill-off">Collected</span> : me ? <span className="pill-on">Your turn</span> : null}
          </div>
        )
      })}
    </div>
  )
}
