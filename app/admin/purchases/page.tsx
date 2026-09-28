'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { ghs } from '@/lib/money'
import {
  Page, PageHeader, Button, EmptyState, Skeleton, SearchBar, Modal, Field,
  Metric, MetricRow, TableWrap, THead, TH, TBody, TR, TD, cx, useToast,
} from '@/components/ui'

/**
 * EVERY PURCHASE, AND WHAT IT NEEDS.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Ordered by what needs the operator: goods ready to hand over first, then
 * anything overdue, then the rest. A list sorted by date makes somebody scan
 * for the row that needs them, and the one they miss is a customer who paid in
 * full and never heard back.
 *
 * ── NOTHING HERE EDITS MONEY ────────────────────────────────────────────
 * Fulfilment is the only writable field. A wrong payment is corrected by
 * reversal on the payments screen, which leaves both the original and the
 * correction in the record; typing over a balance leaves neither.
 */
interface Row {
  id: string; reference: string; customer: string; phone: string
  member_code: string; member_id: string
  product: string; plan: string
  total: number; paid: number; balance: number; progress: number
  status: string; fulfilment_status: string
  overdue_count: number; started_on: string
}
interface Payload {
  totals: { matching: number; collected: number; outstanding: number; ready: number; overdue: number }
  purchases: Row[]
}

const STATUSES = [
  ['', 'All'], ['pending', 'Not started'], ['active', 'Paying'],
  ['fully_paid', 'Paid in full'], ['cancelled', 'Cancelled'],
] as const

/** A plain count. `Metric` formats as currency, which a number of parcels is not. */
function Count({ label, value, sub, tone }: {
  label: string; value: number; sub?: string; tone?: 'good' | 'warn'
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

export default function AdminPurchasesPage() {
  const toast = useToast()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setL] = useState(true)
  const [err, setErr]   = useState('')
  const [q, setQ]       = useState('')
  const [status, setStatus] = useState('')
  const [acting, setActing] = useState('')
  const [payFor, setPayFor] = useState<Row | null>(null)
  const [paying, setPaying] = useState(false)

  const load = useCallback(async () => {
    setL(true)
    const qs = new URLSearchParams()
    if (q) qs.set('q', q)
    if (status) qs.set('status', status)
    const { data, error } = await callFunction<Payload>(
      `admin-purchases?${qs}`, { token: getAdminToken()! })
    setL(false)
    setErr(error ?? '')
    setData(data ?? null)
  }, [q, status])

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t) }, [load, q])

  async function mark(id: string, next: string, label: string) {
    setActing(id)
    const { error } = await callFunction(`admin-purchases?id=${id}`, {
      method: 'PATCH', token: getAdminToken()!, body: { fulfilment_status: next },
    })
    setActing('')
    if (error) { toast.error({ title: 'Could not update', body: error }); return }
    toast.success({ title: `Marked ${label}` })
    load()
  }

  /*
   * Recording money that arrived at the shop. This is the collector's most
   * frequent action and the only way a balance ever moves — there is no field
   * anywhere that lets an outstanding figure be retyped.
   */
  async function recordPayment(form: FormData, r: Row) {
    setPaying(true)
    const { error } = await callFunction('admin-installments?payment=1', {
      method: 'POST', token: getAdminToken()!,
      body: {
        purchase_id: r.id,
        amount: Number(form.get('amount')),
        method: form.get('method'),
        reference: form.get('reference') || null,
        paid_on: form.get('paid_on') || undefined,
        note: form.get('note') || null,
      },
    })
    setPaying(false)
    if (error) { toast.error({ title: 'Could not record that payment', body: error }); return }
    toast.success({
      title: 'Payment recorded',
      body: `${r.customer} has been texted the new balance.`,
    })
    setPayFor(null); load()
  }

  const t = data?.totals
  const rows = data?.purchases ?? []

  return (
    <Page>
      <PageHeader title="Purchases" sub="Everything customers are paying off" />

      {t && (
        <MetricRow>
          <Metric label="Collected"   value={t.collected} primary
                  sub={`${t.matching} purchase${t.matching === 1 ? '' : 's'}`} />
          <Metric label="Outstanding" value={t.outstanding}
                  tone={t.outstanding > 0.005 ? 'warn' : undefined} />
          {/* Counts, not money. Metric renders everything through <Money>, so
              passing a count here would have shown "GHS 3.00" ready to hand
              over. These two are plain figures. */}
          <Count label="Ready to hand over" value={t.ready} tone={t.ready > 0 ? 'good' : undefined}
                 sub={t.ready > 0 ? 'paid in full, not yet collected' : 'nothing waiting'} />
          <Count label="With overdue payments" value={t.overdue}
                 tone={t.overdue > 0 ? 'warn' : undefined} />
        </MetricRow>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-6 mb-3">
        <div className="w-full sm:w-[320px]">
          <SearchBar value={q} onChange={setQ} placeholder="Customer, phone, product or reference…" />
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
        <div className="space-y-2"><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-16 rounded-xl" /></div>
      ) : err ? (
        <EmptyState title="Could not load purchases" body={err}
                    action={<Button onClick={load}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState title={q || status ? 'Nothing matches' : 'No purchases yet'}
                    body={q || status
                      ? 'Try a different search or filter.'
                      : 'Purchases appear here as customers buy products.'} />
      ) : (
        <TableWrap>
          <THead>
            <TH>Customer</TH><TH>Product</TH><TH align="right">Paid</TH>
            <TH align="right">Balance</TH><TH>Status</TH><TH>Collection</TH>
          </THead>
          <TBody>
            {rows.map(r => (
              <TR key={r.id}>
                <TD>
                  <Link href={`/admin/members/${r.member_id}`}
                        className="font-medium text-ink hover:underline underline-offset-2">
                    {r.customer}
                  </Link>
                  <span className="block text-2xs text-ink-3 tnum">{r.phone}</span>
                </TD>
                <TD>
                  <span className="text-ink">{r.product}</span>
                  <span className="block text-2xs text-ink-3">{r.plan} · {r.reference}</span>
                </TD>
                <TD align="right">
                  <span className="tnum">GHS {ghs(r.paid)}</span>
                  <span className="block text-2xs text-ink-3 tnum">{r.progress}% of GHS {ghs(r.total)}</span>
                </TD>
                <TD align="right">
                  <span className={cx('tnum', r.balance > 0.005 ? 'text-ink' : 'text-accent')}>
                    GHS {ghs(r.balance)}
                  </span>
                  {r.overdue_count > 0 && (
                    <span className="block text-2xs text-hot tnum">
                      {r.overdue_count} overdue
                    </span>
                  )}
                </TD>
                <TD>
                  <span className={cx('text-xs font-medium',
                    r.status === 'fully_paid' ? 'text-accent' : 'text-ink-2')}>
                    {r.status === 'fully_paid' ? 'Paid in full'
                      : r.status === 'active' ? 'Paying'
                      : r.status === 'pending' ? 'Not started' : r.status}
                  </span>
                </TD>
                <TD>
                  {/* Only offered once the money is actually in. The endpoint
                      refuses it regardless, but a button that is going to be
                      refused should not be there in the first place. */}
                  {r.status === 'fully_paid' && r.fulfilment_status === 'ready' ? (
                    <Button size="sm" disabled={acting === r.id}
                            onClick={() => mark(r.id, 'collected', 'collected')}>
                      {acting === r.id ? '…' : 'Mark collected'}
                    </Button>
                  ) : r.balance > 0.005 && r.status !== 'cancelled' && r.status !== 'refunded' ? (
                    <Button size="sm" variant="outline" onClick={() => setPayFor(r)}>
                      Record payment
                    </Button>
                  ) : (
                    <span className="text-xs text-ink-3">
                      {r.fulfilment_status === 'not_ready' ? '—'
                        : r.fulfilment_status.replace(/_/g, ' ')}
                    </span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </TableWrap>
      )}
      <Modal open={!!payFor} onClose={() => setPayFor(null)}
             title={payFor ? `Payment from ${payFor.customer}` : 'Record payment'}>
        {payFor && (
          <form onSubmit={e => { e.preventDefault(); recordPayment(new FormData(e.currentTarget), payFor) }}
                className="space-y-3">
            <p className="text-sm text-ink-2 leading-relaxed">
              {payFor.product} · GHS {ghs(payFor.balance)} still owing.
            </p>
            <Field label="Amount received (GHS)" required
                   hint="More than the balance is refused rather than absorbed.">
              {({ id }) => <input id={id} name="amount" type="number" step="0.01" required
                className="in" max={payFor.balance} autoFocus />}
            </Field>
            <Field label="How they paid" required>
              {({ id }) => (
                <select id={id} name="method" className="in" defaultValue="cash">
                  <option value="cash">Cash</option>
                  <option value="momo">Mobile money</option>
                  <option value="bank">Bank transfer</option>
                  <option value="other">Other</option>
                </select>
              )}
            </Field>
            <Field label="Reference" hint="The MoMo or bank reference, if there is one.">
              {({ id }) => <input id={id} name="reference" className="in" />}
            </Field>
            <Field label="Date received">
              {({ id }) => <input id={id} name="paid_on" type="date" className="in"
                defaultValue={new Date().toISOString().slice(0, 10)} />}
            </Field>
            <Field label="Note">
              {({ id }) => <input id={id} name="note" className="in" />}
            </Field>
            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={paying}>
                {paying ? 'Recording…' : 'Record payment'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setPayFor(null)}>Cancel</Button>
            </div>
          </form>
        )}
      </Modal>
    </Page>
  )
}
