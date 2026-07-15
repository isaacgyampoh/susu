'use client'
import { format, addDays } from 'date-fns'

/**
 * Rotation — the queue.
 * Members don't think in percentages, they think "I'm number 4".
 * Dates derive from slot x cycle, which guarantees they're in order.
 */
export default function Rotation({
  total, position, cycleDays, startDate, collected,
}: {
  total: number; position: number; cycleDays: number
  startDate?: string | null; collected: number
}) {
  if (!startDate) return <p className="t-meta py-4">Turn dates are set when the group starts.</p>
  const start = new Date(startDate)

  return (
    <table className="w-full">
      <tbody className="divide-y divide-line border-y border-line">
        {Array.from({ length: total }).map((_, i) => {
          const slot = i + 1
          const me   = slot === position
          const done = slot <= collected
          return (
            <tr key={slot} className={me ? 'bg-wash' : ''}>
              <td className="py-3 pr-3 w-8 t-meta tnum">{String(slot).padStart(2, '0')}</td>
              <td className={`py-3 pr-3 text-[14px] ${me ? 'font-bold' : 'font-medium text-ink-2'}`}>
                {me ? 'You' : `Member ${slot}`}
              </td>
              <td className="py-3 pr-3 t-meta whitespace-nowrap">{format(addDays(start, slot * cycleDays), 'd MMM')}</td>
              <td className="py-3 text-right">
                {done ? <span className="st-off">Collected</span> : me ? <span className="st-on">Your turn</span> : null}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
