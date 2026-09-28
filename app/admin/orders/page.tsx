'use client'
import { useCallback, useEffect, useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { ghs } from '@/lib/money'
import {
  Page, PageHeader, Button, EmptyState, Skeleton, SearchBar,
  Metric, MetricRow, cx, useToast,
} from '@/components/ui'

/**
 * OUTRIGHT ORDERS.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Paid orders first — somebody has given the shop money and is waiting to hear
 * about their fridge. Unpaid ones sit at the bottom: an abandoned checkout is
 * not a task.
 *
 * ── PAYMENT STATUS IS NOT EDITABLE HERE ─────────────────────────────────
 * The buttons move an order along its own progress: processing, ready,
 * completed. Whether it is PAID comes from `paid_reference`, set only when
 * NaloPay confirmed, and nothing on this screen can set it. An order marked
 * paid by hand would be a receipt for money nobody received.
 */
interface Order {
  id: string; reference: string; status: string
  customer: string; phone: string; address: string | null
  subtotal: number; total: number
  paid_at: string | null; paid_reference: string | null
  fulfilment_status: string; created_at: string
  items: { name: string; qty: number; unit_price: number; line_total: number }[]
}
interface Payload {
  totals: { matching: number; revenue: number; awaiting: number; unpaid: number }
  orders: Order[]
}

const STATUSES = [
  ['', 'All'], ['paid', 'Paid'], ['processing', 'Processing'],
  ['ready', 'Ready'], ['completed', 'Completed'], ['pending_payment', 'Unpaid'],
] as const

function Count({ label, value, tone, sub }: {
  label: string; value: number; tone?: 'good' | 'warn'; sub?: string
}) {
  return (
    <div className="min-w-0">
      <p className="t-eyebrow mb-1.5">{label}</p>
      <p className={cx('font-display text-xl font-semibold tnum tracking-[-.02em]',
        tone === 'good' ? 'text-success' : tone === 'warn' ? 'text-warning' : 'text-ink')}>
        {value}
      </p>
      {sub && <p className="text-2xs text-ink-3 mt-1">{sub}</p>}
    </div>
  )
}

export default function AdminOrdersPage() {
  const toast = useToast()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setL] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [acting, setActing] = useState('')

  const load = useCallback(async () => {
    setL(true)
    const qs = new URLSearchParams()
    if (q) qs.set('q', q)
    if (status) qs.set('status', status)
    const { data, error } = await callFunction<Payload>(
      `admin-orders?${qs}`, { token: getAdminToken()! })
    setL(false); setErr(error ?? ''); setData(data ?? null)
  }, [q, status])

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t) }, [load, q])

  async function move(o: Order, next: string) {
    setActing(o.id)
    const { error } = await callFunction(`admin-orders?id=${o.id}`, {
      method: 'PATCH', token: getAdminToken()!, body: { status: next },
    })
    setActing('')
    if (error) { toast.error({ title: 'Could not update', body: error }); return }
    toast.success({ title: `Marked ${next}` })
    load()
  }

  const t = data?.totals
  const rows = data?.orders ?? []

  return (
    <Page>
      <PageHeader title="Orders" sub="Products bought and paid for outright" />

      {t && (
        <MetricRow>
          <Metric label="Revenue" value={t.revenue} primary
                  sub={`${t.matching} order${t.matching === 1 ? '' : 's'}`} />
          <Count label="Waiting on you" value={t.awaiting}
                 tone={t.awaiting > 0 ? 'good' : undefined}
                 sub={t.awaiting > 0 ? 'paid, not yet handed over' : 'nothing waiting'} />
          <Count label="Never paid" value={t.unpaid}
                 sub={t.unpaid > 0 ? 'abandoned at checkout' : 'none'} />
        </MetricRow>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-6 mb-3">
        <div className="w-full sm:w-[300px]">
          <SearchBar value={q} onChange={setQ} placeholder="Customer, phone or order number…" />
        </div>
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {STATUSES.map(([v, label]) => (
            <button key={v} type="button" onClick={() => setStatus(v)}
              className={cx('px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
                status === v ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink-2 hover:text-ink')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" /></div>
      ) : err ? (
        <EmptyState icon={ShoppingBag} title="Could not load orders" body={err}
                    action={<Button onClick={load}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={ShoppingBag}
          title={q || status ? 'Nothing matches' : 'No orders yet'}
          body={q || status ? 'Try a different search or filter.'
            : 'Orders appear here when somebody buys something outright from the shop.'} />
      ) : (
        <div className="space-y-3">
          {rows.map(o => (
            <section key={o.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold text-ink">{o.customer}</p>
                  <p className="text-xs text-ink-2 mt-0.5 tnum">
                    <a href={`tel:${o.phone}`} className="hover:text-ink underline underline-offset-2">
                      {o.phone}
                    </a>
                    {o.address && ` · ${o.address}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-display text-base font-semibold text-ink tnum">
                    GHS {ghs(o.total)}
                  </p>
                  <p className="text-2xs text-ink-3 tnum">{o.reference}</p>
                </div>
              </div>

              <ul className="mt-2.5 divide-y divide-line-2">
                {o.items.map((i, n) => (
                  <li key={n} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                    <span className="text-ink min-w-0 truncate">
                      {i.name}{i.qty > 1 && <span className="text-ink-3"> × {i.qty}</span>}
                    </span>
                    <span className="text-ink-2 tnum shrink-0">GHS {ghs(i.line_total)}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-line-2">
                {/* Paid is a fact from the provider, shown as one — never a control. */}
                <span className={cx('text-xs font-medium',
                  o.paid_reference ? 'text-accent' : 'text-ink-3')}>
                  {o.paid_reference ? 'Paid' : 'Not paid'}
                </span>
                <span className="text-xs text-ink-3">· {o.status.replace(/_/g, ' ')}</span>

                <span className="ml-auto flex gap-2">
                  {o.paid_reference && o.status === 'paid' && (
                    <Button size="sm" disabled={acting === o.id}
                            onClick={() => move(o, 'processing')}>Start preparing</Button>
                  )}
                  {o.paid_reference && o.status === 'processing' && (
                    <Button size="sm" disabled={acting === o.id}
                            onClick={() => move(o, 'ready')}>Ready</Button>
                  )}
                  {o.paid_reference && o.status === 'ready' && (
                    <Button size="sm" disabled={acting === o.id}
                            onClick={() => move(o, 'completed')}>Handed over</Button>
                  )}
                </span>
              </div>
            </section>
          ))}
        </div>
      )}
    </Page>
  )
}
