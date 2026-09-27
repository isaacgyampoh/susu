'use client'
import { format } from 'date-fns'
import { ghs } from '@/lib/money'
import { cx } from '@/components/ui'

/* ---------------------------------------------------------------------------
   WHAT A CUSTOMER IS PAYING FOR

   A purchase answers four questions, and a card that does not answer all four
   sends the customer to a phone call: what is it, how much is left, when is
   the next payment, and can I collect it yet.

   Progress is a bar because "GHS 2,000 of GHS 4,000" is arithmetic the reader
   has to do; a half-filled bar is not. The figures sit beside it for the
   reader who wants them exactly — which, this being money, is most of them.
   ------------------------------------------------------------------------ */

export interface PurchaseRow {
  id: string
  reference: string
  product: string
  plan: string
  image: string | null
  total: number
  paid: number
  balance: number
  progress: number
  installment_amount: number
  paid_count: number
  total_count: number
  overdue_count: number
  status: 'pending' | 'active' | 'fully_paid' | 'cancelled' | 'refunded' | 'defaulted' | 'on_hold'
  fulfilment_status: 'not_ready' | 'ready' | 'released' | 'delivered' | 'collected' | 'returned'
  next_due: { id: string; sequence: number; amount: number; due_date: string; remaining: number } | null
  started_on: string
  completed_at: string | null
}

const MEDIA = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/storage/v1/object/public/product-media/`
export const mediaUrl = (p: string | null) => (p ? MEDIA + p : null)

/* date-fns `format` throws RangeError on an unparseable value, and one bad
   date in a schedule of twelve took the whole page down to a blank. A date we
   cannot read is a date we do not show. */
const when = (d?: string | null) => {
  if (!d) return null
  const t = new Date(d + 'T12:00:00Z')
  return Number.isNaN(t.getTime()) ? null : format(t, 'd MMM yyyy')
}

/**
 * What this purchase is doing, in words.
 *
 * Payment and delivery are separate states, and the honest label depends on
 * both: "Paid in full" is not the end of the story if the fridge is still in
 * the shop, and the customer's next question is exactly that.
 */
export function purchaseLabel(p: PurchaseRow): { text: string; tone: 'good' | 'warn' | 'plain' } {
  if (p.status === 'cancelled') return { text: 'Cancelled', tone: 'plain' }
  if (p.status === 'refunded')  return { text: 'Refunded',  tone: 'plain' }
  if (p.status === 'on_hold')   return { text: 'On hold',   tone: 'warn' }
  if (p.status === 'fully_paid') {
    switch (p.fulfilment_status) {
      case 'collected':
      case 'delivered': return { text: 'Collected', tone: 'good' }
      case 'released':  return { text: 'Released to you', tone: 'good' }
      case 'returned':  return { text: 'Returned', tone: 'plain' }
      default:          return { text: 'Paid — ready to collect', tone: 'good' }
    }
  }
  if (p.overdue_count > 0) {
    return { text: `${p.overdue_count} payment${p.overdue_count === 1 ? '' : 's'} overdue`, tone: 'warn' }
  }
  return { text: 'Paying', tone: 'plain' }
}

function Bar({ percent, tone }: { percent: number; tone: 'good' | 'warn' | 'plain' }) {
  const pct = Math.max(0, Math.min(100, percent))
  return (
    <div
      className="h-1.5 rounded-full bg-surface-3 overflow-hidden"
      role="progressbar"
      aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
      aria-label={`${pct}% paid`}
    >
      <div
        className={cx('h-full rounded-full',
          tone === 'good' ? 'bg-accent' : tone === 'warn' ? 'bg-hot' : 'bg-ink')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function PurchaseCard({
  p, onPay, href,
}: { p: PurchaseRow; onPay?: (p: PurchaseRow) => void; href?: string }) {
  const label = purchaseLabel(p)
  const img = mediaUrl(p.image)
  const done = p.status === 'fully_paid'

  const Body = (
    <>
      <div className="flex items-start gap-3">
        {/* A product people recognise by sight. The placeholder is a neutral
            block rather than an icon: a generic picture of a box is not more
            informative than no picture. */}
        <div className="w-14 h-14 rounded-lg bg-surface-2 shrink-0 overflow-hidden">
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold text-ink leading-tight">
            {p.product}
          </p>
          <p className="text-xs text-ink-3 mt-0.5 truncate">
            {p.plan} · {p.reference}
          </p>
        </div>

        {/* Status is a word. Colour only reinforces it. */}
        <span className={cx('text-2xs font-medium shrink-0 text-right',
          label.tone === 'good' ? 'text-accent'
          : label.tone === 'warn' ? 'text-hot' : 'text-ink-3')}>
          {label.text}
        </span>
      </div>

      <div className="mt-3">
        <Bar percent={p.progress} tone={label.tone} />
        <p className="flex items-baseline justify-between gap-3 mt-1.5 text-xs tnum">
          <span className="text-ink-2">
            GHS {ghs(p.paid)} paid of GHS {ghs(p.total)}
          </span>
          <span className={cx('font-medium', done ? 'text-accent' : 'text-ink')}>
            {done ? 'Nothing left to pay' : `GHS ${ghs(p.balance)} left`}
          </span>
        </p>
      </div>

      {!done && p.next_due && (
        <p className="text-xs text-ink-3 mt-2 tnum">
          Next: GHS {ghs(p.next_due.remaining)} on {when(p.next_due.due_date)}
          {' · '}payment {p.paid_count + 1} of {p.total_count}
        </p>
      )}

      {done && p.fulfilment_status === 'ready' && (
        <p className="text-xs text-ink-2 mt-2 leading-relaxed">
          Fully paid. The shop will contact you about collecting it.
        </p>
      )}
    </>
  )

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      {href ? <a href={href} className="block">{Body}</a> : Body}

      {onPay && !done && p.status !== 'cancelled' && p.status !== 'refunded' && (
        <button
          type="button"
          onClick={() => onPay(p)}
          className="btn-pop btn-sm w-full mt-3"
        >
          Pay GHS {ghs(p.next_due?.remaining ?? p.installment_amount)}
        </button>
      )}
    </div>
  )
}

/**
 * The payment schedule.
 *
 * Every instalment, including the ones already settled: a customer checking
 * whether March was taken needs to see March. Overdue is named, not coloured
 * red and left to infer.
 */
export function ScheduleTable({
  rows,
}: {
  rows: {
    id: string; sequence: number; amount: number; paid_amount: number
    remaining: number; due_date: string; status: string; paid_at: string | null
  }[]
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-3">No schedule yet.</p>
  }
  return (
    <ol className="divide-y divide-line-2">
      {rows.map(r => {
        const part = r.paid_amount > 0.004 && r.status !== 'paid'
        return (
          <li key={r.id} className="flex items-baseline gap-3 py-2.5 min-h-[44px]">
            <span className="text-sm text-ink-3 tnum shrink-0 w-6">{r.sequence}</span>
            <span className="text-sm text-ink tnum shrink-0 w-[88px]">
              GHS {ghs(r.amount)}
            </span>
            <span className="text-sm text-ink-2 tnum flex-1 min-w-0">
              {when(r.due_date)}
            </span>
            <span className={cx('text-xs font-medium shrink-0 text-right',
              r.status === 'paid' ? 'text-accent'
              : r.status === 'overdue' ? 'text-hot'
              : r.status === 'waived' ? 'text-ink-3' : 'text-ink-3')}>
              {r.status === 'paid' ? 'Paid'
                : r.status === 'overdue' ? 'Overdue'
                : r.status === 'waived' ? 'Waived'
                /* A part payment must not read as unpaid — the customer gave
                   real money and would reasonably think it had gone missing. */
                : part ? `GHS ${ghs(r.remaining)} left` : 'Pending'}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
