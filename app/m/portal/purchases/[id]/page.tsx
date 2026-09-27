'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { format } from 'date-fns'
import { ShoppingBag } from 'lucide-react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import { AppBar } from '@/components/susu/app-bar'
import { ScheduleTable, mediaUrl } from '@/components/susu/purchases'
import { Button, EmptyState, Skeleton, useToast, cx } from '@/components/ui'

/** Same rule as the schedule: an unreadable date is omitted, never thrown. */
const safeDate = (v: string | null | undefined, fmt: string) => {
  if (!v) return ''
  const t = new Date(v)
  return Number.isNaN(t.getTime()) ? '' : format(t, fmt)
}
import { ghs } from '@/lib/money'

/**
 * ONE PURCHASE, IN FULL.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The schedule, every payment that reached it, and where it is in fulfilment.
 *
 * The id in this URL grants nothing. `get_purchase_detail` matches on member
 * AND purchase, from the verified session — putting somebody else's id here
 * returns a 404 rather than their television, and the check is in SQL where no
 * edit to this file can loosen it.
 */
interface Detail {
  purchase: {
    id: string; reference: string; product: string; plan: string
    cash_price: number; total: number; installment_amount: number
    deposit_amount: number; duration_count: number; frequency: string
    status: string; fulfilment_status: string
    started_on: string; completed_at: string | null
    paid: number; balance: number
    media: { kind: string; path: string }[]
  }
  schedule: {
    id: string; sequence: number; amount: number; paid_amount: number
    remaining: number; due_date: string; status: string; paid_at: string | null
  }[]
  payments: {
    reference: string; amount: number; at: string; kind: string
    installment: number | null; reversed: boolean
  }[]
  fulfilment: { status: string; note: string | null; at: string }[]
}

const FULFILMENT_WORDS: Record<string, string> = {
  not_ready: 'Not ready yet',
  ready:     'Ready to collect',
  released:  'Released to you',
  delivered: 'Delivered',
  collected: 'Collected',
  returned:  'Returned',
}

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const [d, setD]         = useState<Detail | null>(null)
  const [loading, setL]   = useState(true)
  const [failed, setFail] = useState('')
  const [paying, setPaying] = useState(false)

  const load = useCallback(async () => {
    setL(true); setFail('')
    const { data, error } = await callFunction<Detail>(`member-purchases?id=${id}`, {
      token: getMemberToken()!,
    })
    setL(false)
    if (error) { setFail(error); return }
    setD(data ?? null)
  }, [id])

  useEffect(() => { load() }, [load])

  async function pay() {
    setPaying(true)
    const { data, error } = await callFunction<{ message: string }>('shop-pay', {
      method: 'POST', token: getMemberToken()!, body: { purchase_id: id },
    })
    setPaying(false)
    if (error) { toast.error({ title: 'Could not start the payment', body: error }); return }
    toast.success({ title: 'Check your phone', body: data?.message ?? '' })
    setTimeout(load, 6000)
  }

  if (loading) return (
    <div>
      <AppBar title="Purchase" back={{ href: '/m/portal/purchases', label: 'My purchases' }} />
      <div className="portal-w pt-6 space-y-3"><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>
    </div>
  )

  if (failed || !d?.purchase) return (
    <div>
      <AppBar title="Purchase" back={{ href: '/m/portal/purchases', label: 'My purchases' }} />
      <div className="portal-w pt-10">
        <EmptyState
          icon={ShoppingBag}
          title={failed ? 'Could not load this purchase' : 'Purchase not found'}
          body={failed
            ? 'This is usually temporary. Nothing you have paid has changed.'
            : 'This purchase does not exist, or it is not yours.'}
          action={failed ? <Button onClick={load}>Try again</Button> : undefined}
        />
      </div>
    </div>
  )

  const p = d.purchase
  const done = p.status === 'fully_paid'
  const img = mediaUrl(p.media.find(m => m.kind === 'image')?.path ?? null)
  const pct = p.total > 0 ? Math.round((p.paid / p.total) * 100) : 0

  return (
    <div className="animate-fade-in">
      <AppBar title={p.product} back={{ href: '/m/portal/purchases', label: 'My purchases' }} />

      <div className="portal-w pt-6 pb-4">
        {/* The headline: one figure, and what it is. */}
        <div className={cx('rounded-xl p-4', done ? 'bg-pop' : 'bg-surface border border-line')}>
          <div className="flex items-start gap-3">
            <div className="w-16 h-16 rounded-lg bg-surface-2 shrink-0 overflow-hidden">
              {img && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt="" className="w-full h-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className={cx('t-eyebrow', done && '!text-ink/60')}>
                {done ? 'Paid in full' : 'Left to pay'}
              </p>
              <p className="font-display text-2xl font-semibold text-ink tnum tracking-[-.02em] mt-0.5">
                GHS {ghs(done ? p.total : p.balance)}
              </p>
              <p className={cx('text-xs mt-1 tnum', done ? 'text-ink/65' : 'text-ink-3')}>
                {done
                  ? `${p.plan} · finished ${safeDate(p.completed_at, 'd MMM yyyy')}`
                  : `GHS ${ghs(p.paid)} of GHS ${ghs(p.total)} paid · ${pct}%`}
              </p>
            </div>
          </div>

          {!done && (
            <button type="button" onClick={pay} disabled={paying}
              className="btn-pop btn-sm w-full mt-3">
              {paying ? 'Starting…' : 'Make a payment'}
            </button>
          )}
        </div>

        {/* Where the goods are. Separate from the money, because they are. */}
        <div className="border-b border-line py-3.5 mt-4">
          <p className="t-eyebrow">Collection</p>
          <p className="text-base font-medium text-ink mt-1">
            {FULFILMENT_WORDS[p.fulfilment_status] ?? p.fulfilment_status}
          </p>
          {p.fulfilment_status === 'ready' && (
            <p className="text-xs text-ink-2 mt-1 leading-relaxed">
              The shop will contact you about collecting it.
            </p>
          )}
          {!done && (
            <p className="text-xs text-ink-3 mt-1 leading-relaxed">
              It becomes ready once the balance reaches zero.
            </p>
          )}
        </div>

        <div className="pt-4">
          <p className="t-eyebrow mb-0.5">Payment schedule</p>
          <ScheduleTable rows={d.schedule} />
        </div>

        {d.payments.length > 0 && (
          <div className="pt-5">
            <p className="t-eyebrow mb-0.5">Payments received</p>
            <ol className="divide-y divide-line-2">
              {d.payments.map((x, i) => (
                <li key={`${x.reference}-${i}`} className="flex items-baseline gap-3 py-2.5">
                  <span className="text-sm font-medium text-ink tnum shrink-0 w-[88px]">
                    GHS {ghs(x.amount)}
                  </span>
                  <span className="text-xs text-ink-2 flex-1 min-w-0 truncate">
                    {safeDate(x.at, 'd MMM yyyy, HH:mm')}
                    {x.installment && ` · payment ${x.installment}`}
                  </span>
                  {/* A reversal stays on the record rather than disappearing —
                      money that arrived and went back is a fact the customer
                      may need to point at later. */}
                  <span className={cx('text-2xs shrink-0',
                    x.reversed ? 'text-hot' : 'text-ink-3')}>
                    {x.reversed ? 'Reversed' : x.reference}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <p className="text-2xs text-ink-3 mt-6 leading-relaxed">
          Reference {p.reference} · {p.plan} · started {safeDate(p.started_on + 'T12:00:00Z', 'd MMM yyyy')}.
          The price and terms are the ones you agreed to and do not change.
        </p>
      </div>
    </div>
  )
}
