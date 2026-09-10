'use client'
import { format } from 'date-fns'
import { ghs } from '@/lib/money'
import { cx } from '@/components/ui'

/* ---------------------------------------------------------------------------
   THE ROTATION, AS TURNS

   The roster answers "who is in this group". It cannot answer "when does this
   group pay out", because it is one row per person — so two halves sharing a
   turn appear as two rows on the same date with nothing to say why, and an
   administrator reasonably reads that as a duplicate.

   A turn is one block here, however many people hold shares of it. That is the
   shape of the business: four quarter-shares make a turn, and the turn has the
   number and the date.
   ------------------------------------------------------------------------ */

export interface TurnMember {
  membership_id: string
  member_id: string
  name: string
  slot_fraction: number
  share_label: 'Full' | 'Half' | 'Quarter' | null
  payout_amount: number | null
  received: boolean
  status: string
}

export interface Turn {
  id: string
  unit_number: number
  payout_date: string | null
  quarters: number
  complete: boolean
  received: boolean
  members: TurnMember[]
}

const when = (d?: string | null) =>
  d ? format(new Date(d + 'T12:00:00Z'), 'd MMM yyyy') : null

/** Four quarter-shares, drawn as four. Reads at a glance; no legend needed. */
function Fill({ quarters }: { quarters: number }) {
  return (
    <span className="inline-flex gap-[3px]" aria-hidden="true">
      {[0, 1, 2, 3].map(i => (
        <span
          key={i}
          className={cx(
            'w-2.5 h-2.5 rounded-[3px]',
            i < quarters ? 'bg-ink' : 'bg-line',
          )}
        />
      ))}
    </span>
  )
}

export function RotationTurns({ turns }: { turns: Turn[] }) {
  if (turns.length === 0) {
    return (
      <p className="text-sm text-ink-3 leading-relaxed">
        No turns yet. A turn appears when the first member takes a slot.
      </p>
    )
  }

  const partial = turns.filter(t => !t.complete && t.quarters > 0)

  return (
    <>
      {/*
        Said once, at the top, rather than as a badge on every incomplete turn.
        A part-filled turn is a normal state in a susu that is still filling up,
        not a fault, and marking each one as a problem trains people to ignore
        the marking.
      */}
      {partial.length > 0 && (
        <p className="text-xs text-ink-2 mb-3 leading-relaxed">
          {partial.length} turn{partial.length === 1 ? ' has' : 's have'} room left.
          A turn is four quarter-shares — one full slot, two halves, or four
          quarters — and fills as members join.
        </p>
      )}

      <ol className="space-y-2">
        {turns.map(t => {
          const active = t.members.filter(m => m.status === 'active')
          const former = t.members.filter(m => m.status !== 'active')
          return (
          <li
            key={t.id}
            className={cx(
              'rounded-xl border p-3.5',
              t.received ? 'border-line bg-surface-2' : 'border-line bg-surface',
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2.5 min-w-0">
                <span className="font-display text-base font-semibold text-ink tnum shrink-0">
                  Payout #{t.unit_number}
                </span>
                <span className="text-sm text-ink-2 tnum truncate">
                  {when(t.payout_date) ?? <span className="text-ink-3">Date not set</span>}
                </span>
              </div>
              <span className="flex items-center gap-2 shrink-0">
                <Fill quarters={t.quarters} />
                <span className="text-2xs text-ink-3 tnum">{t.quarters}/4</span>
              </span>
            </div>

            {/*
              A forfeited slot no longer holds its share — that is what
              forfeiture means, and the turn genuinely has room again. Listing
              a former holder among the current ones made a turn read as
              occupied and empty at the same time.
            */}
            {active.length === 0 && former.length === 0 ? (
              <p className="text-xs text-ink-3 mt-2">Empty turn.</p>
            ) : (
              <>
                {active.length > 0 && (
                  <ul className="mt-2.5 divide-y divide-line-2">
                    {active.map(m => (
                      <li key={m.membership_id} className="flex items-baseline gap-3 py-1.5">
                        <span className="text-sm text-ink flex-1 min-w-0 truncate">{m.name}</span>
                        <span className="text-xs text-ink-2 shrink-0">{m.share_label}</span>
                        {m.payout_amount != null && (
                          <span className="text-xs text-ink-2 tnum shrink-0 w-[92px] text-right">
                            GHS {ghs(m.payout_amount)}
                          </span>
                        )}
                        {/* Status in a word. Colour alone is not a status. */}
                        <span className={cx(
                          'text-2xs shrink-0 w-[64px] text-right',
                          m.received ? 'text-success' : 'text-ink-3',
                        )}>
                          {m.received ? 'Collected' : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {active.length === 0 && (
                  <p className="text-xs text-ink-3 mt-2">
                    Free turn — nobody holds a share of it.
                  </p>
                )}
                {former.length > 0 && (
                  <p className="text-2xs text-ink-3 mt-2 leading-relaxed">
                    Previously {former.map(m => `${m.name} (${m.status})`).join(', ')}
                  </p>
                )}
              </>
            )}
          </li>
          )
        })}
      </ol>
    </>
  )
}
