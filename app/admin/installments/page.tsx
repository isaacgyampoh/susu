'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CreditCard, Plus } from 'lucide-react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { ghs } from '@/lib/money'
import {
  Page, PageHeader, Button, EmptyState, Skeleton, Modal, Field,
  Metric, MetricRow, cx, useToast,
} from '@/components/ui'

/**
 * INSTALMENTS.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Two things happen on this screen, and they are the two things the business
 * actually does: somebody asks to pay gradually, and somebody hands over
 * money. Requests sit at the top because an unanswered one is a customer
 * waiting by their phone.
 *
 * ── NOTHING HERE EDITS A BALANCE ────────────────────────────────────────
 * Money moves by recording a payment, which writes a transaction, an
 * allocation and an audit row. There is no field that lets an outstanding
 * figure be retyped — a balance that can be typed over is one nobody can
 * defend when a customer disputes it six months later.
 */
interface Request {
  id: string; reference: string; status: string
  full_name: string; phone: string; whatsapp: string | null
  email: string | null; address: string | null
  product_id: string | null; plan_id: string | null
  product: string; plan: string | null; quantity: number
  cash_price: number; total_payable: number | null
  deposit_amount: number; duration_count: number | null
  frequency: string | null; note: string | null
  purchase_id: string | null; created_at: string
}
interface Overview {
  requests_pending: number; agreements_active: number; agreements_done: number
  customers: number; expected: number; collected: number; outstanding: number
  overdue_count: number; overdue_amount: number; awaiting_fulfilment: number
  due_next_7_days: number; orders_awaiting: number; orders_revenue: number
}

/** `Metric` formats through <Money>; a count of people is not money. */
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

export default function InstallmentsPage() {
  const toast = useToast()
  const [ov, setOv] = useState<Overview | null>(null)
  const [pending, setPending] = useState<Request[]>([])
  const [products, setProducts] = useState<{ id: string; name: string; cash_price: number }[]>([])
  const [loading, setL] = useState(true)
  const [err, setErr] = useState('')
  const [agreeFor, setAgreeFor] = useState<Request | 'walkin' | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setL(true)
    const [{ data, error }, { data: prod }] = await Promise.all([
      callFunction<{ overview: Overview; pending: Request[] }>(
        'admin-installments', { token: getAdminToken()! }),
      callFunction<{ products: { id: string; name: string; cash_price: number }[] }>(
        'admin-products', { token: getAdminToken()! }),
    ])
    setL(false)
    setErr(error ?? '')
    setOv(data?.overview ?? null)
    setPending(data?.pending ?? [])
    setProducts(prod?.products ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  async function createAgreement(form: FormData, req: Request | null) {
    setBusy(true)
    const { error } = await callFunction('admin-installments?agreement=1', {
      method: 'POST', token: getAdminToken()!,
      body: {
        full_name: form.get('full_name'), phone: form.get('phone'),
        product_id: form.get('product_id'),
        total_payable: Number(form.get('total_payable')),
        deposit: Number(form.get('deposit') || 0),
        duration: Number(form.get('duration')),
        frequency: form.get('frequency'),
        start_date: form.get('start_date') || undefined,
        request_id: req?.id ?? null,
        plan_id: req?.plan_id ?? null,
        note: form.get('note') || null,
      },
    })
    setBusy(false)
    if (error) { toast.error({ title: 'Could not create the agreement', body: error }); return }
    toast.success({
      title: 'Agreement created',
      body: 'The customer has been texted their first payment date.',
    })
    setAgreeFor(null); load()
  }

  async function decide(r: Request, status: string) {
    const { error } = await callFunction(`admin-installments?request=${r.id}`, {
      method: 'PATCH', token: getAdminToken()!, body: { status },
    })
    if (error) { toast.error({ title: 'Could not update', body: error }); return }
    toast.success({ title: `Request ${status}` })
    load()
  }

  return (
    <Page>
      <PageHeader
        title="Instalments"
        sub="Requests from the website, and agreements you manage"
        actions={
          <Button icon={Plus} onClick={() => setAgreeFor('walkin')}>
            New agreement
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
      ) : err ? (
        <EmptyState icon={CreditCard} title="Could not load instalments" body={err}
                    action={<Button onClick={load}>Try again</Button>} />
      ) : (
        <>
          {ov && (
            <>
              <MetricRow>
                <Metric label="Collected" value={ov.collected} primary
                        sub={`of GHS ${ghs(ov.expected)} agreed`} />
                <Metric label="Outstanding" value={ov.outstanding}
                        tone={ov.outstanding > 0.005 ? 'warn' : undefined} />
                <Metric label="Overdue" value={ov.overdue_amount}
                        tone={ov.overdue_amount > 0.005 ? 'bad' : undefined}
                        sub={ov.overdue_count > 0
                          ? `${ov.overdue_count} customer${ov.overdue_count === 1 ? '' : 's'}`
                          : 'nobody behind'} />
                <Metric label="Due in 7 days" value={ov.due_next_7_days} />
              </MetricRow>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-line">
                <Count label="Requests waiting" value={ov.requests_pending}
                       tone={ov.requests_pending > 0 ? 'warn' : undefined}
                       sub={ov.requests_pending > 0 ? 'someone is waiting' : 'none'} />
                <Count label="Active agreements" value={ov.agreements_active} />
                <Count label="Ready to collect" value={ov.awaiting_fulfilment}
                       tone={ov.awaiting_fulfilment > 0 ? 'good' : undefined} />
                <Count label="Customers" value={ov.customers} />
              </div>
            </>
          )}

          {/* Requests first: an unanswered one is a person waiting. */}
          <section aria-labelledby="reqs" className="mt-8">
            <h2 id="reqs" className="t-eyebrow mb-3">
              Requests from the website
              {pending.length > 0 && <span className="text-ink-3 font-normal"> · {pending.length}</span>}
            </h2>

            {pending.length === 0 ? (
              <p className="text-sm text-ink-3 leading-relaxed">
                Nothing waiting. Requests appear here the moment somebody asks to
                pay for something gradually.
              </p>
            ) : (
              <div className="space-y-3">
                {pending.map(r => (
                  <div key={r.id} className="rounded-xl border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-base font-semibold text-ink">
                          {r.full_name}
                        </p>
                        <p className="text-xs text-ink-2 mt-0.5 tnum">
                          <a href={`tel:${r.phone}`} className="hover:text-ink underline underline-offset-2">
                            {r.phone}
                          </a>
                          {r.address && ` · ${r.address}`}
                        </p>
                      </div>
                      <p className="text-2xs text-ink-3 tnum shrink-0">{r.reference}</p>
                    </div>

                    <p className="text-sm text-ink mt-2.5">
                      {r.product}
                      {r.quantity > 1 && ` × ${r.quantity}`}
                      {r.plan && <span className="text-ink-2"> · asked for {r.plan}</span>}
                    </p>
                    <p className="text-xs text-ink-2 mt-1 tnum">
                      Cash price GHS {ghs(r.cash_price)}
                      {r.total_payable != null && ` · plan total GHS ${ghs(r.total_payable)}`}
                      {r.deposit_amount > 0 && ` · deposit GHS ${ghs(r.deposit_amount)}`}
                    </p>
                    {r.note && (
                      <p className="text-xs text-ink-3 mt-2 leading-relaxed">
                        &ldquo;{r.note}&rdquo;
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2 mt-3">
                      <Button size="sm" onClick={() => setAgreeFor(r)}>
                        Agree terms &amp; create
                      </Button>
                      <Button size="sm" variant="dangerLine" onClick={() => decide(r, 'declined')}>
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <p className="text-xs text-ink-3 mt-8 leading-relaxed">
            Agreements and payments live under{' '}
            <Link href="/admin/purchases" className="text-ink font-medium underline underline-offset-2">
              Purchases
            </Link>. Record a payment there when somebody pays you.
          </p>
        </>
      )}

      {/* Agreement — from a request, or for somebody who walked in */}
      <Modal open={!!agreeFor} onClose={() => setAgreeFor(null)}
             title={agreeFor === 'walkin' ? 'New instalment agreement'
                    : `Agreement for ${agreeFor?.full_name ?? ''}`}>
        {agreeFor && (
          <form
            onSubmit={e => {
              e.preventDefault()
              createAgreement(new FormData(e.currentTarget),
                              agreeFor === 'walkin' ? null : agreeFor)
            }}
            className="space-y-3"
          >
            <Field label="Customer name" required>
              {({ id }) => <input id={id} name="full_name" required className="in"
                defaultValue={agreeFor === 'walkin' ? '' : agreeFor.full_name} />}
            </Field>
            <Field label="Phone" required
                   hint="Their number identifies them. The same number is the same customer.">
              {({ id }) => <input id={id} name="phone" required className="in"
                defaultValue={agreeFor === 'walkin' ? '' : agreeFor.phone} />}
            </Field>
            <Field label="Product" required>
              {({ id }) => (
                <select id={id} name="product_id" required className="in"
                        defaultValue={agreeFor === 'walkin' ? '' : (agreeFor.product_id ?? '')}>
                  <option value="">Choose…</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} — GHS {ghs(p.cash_price)}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Total payable (GHS)" required
                   hint="What they will pay in total, including any premium for paying over time.">
              {({ id }) => <input id={id} name="total_payable" type="number" step="0.01" required
                className="in" defaultValue={agreeFor === 'walkin' ? '' : (agreeFor.total_payable ?? '')} />}
            </Field>
            <Field label="Deposit taken today (GHS)"
                   hint="Deducted from the total before the schedule is worked out.">
              {({ id }) => <input id={id} name="deposit" type="number" step="0.01" className="in"
                defaultValue={agreeFor === 'walkin' ? '0' : String(agreeFor.deposit_amount ?? 0)} />}
            </Field>
            <Field label="Number of payments" required>
              {({ id }) => <input id={id} name="duration" type="number" required className="in"
                defaultValue={agreeFor === 'walkin' ? '' : (agreeFor.duration_count ?? '')} />}
            </Field>
            <Field label="How often">
              {({ id }) => (
                <select id={id} name="frequency" className="in"
                        defaultValue={agreeFor === 'walkin' ? 'monthly' : (agreeFor.frequency ?? 'monthly')}>
                  <option value="monthly">Monthly</option>
                  <option value="biweekly">Every two weeks</option>
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                </select>
              )}
            </Field>
            <Field label="First payment due">
              {({ id }) => <input id={id} name="start_date" type="date" className="in"
                defaultValue={new Date().toISOString().slice(0, 10)} />}
            </Field>
            <Field label="Note">
              {({ id }) => <textarea id={id} name="note" rows={2} className="in h-auto py-2"
                placeholder="Anything agreed that is not in the figures" />}
            </Field>

            <p className="text-xs text-ink-3 leading-relaxed">
              These terms are saved with the agreement. Changing the product&rsquo;s
              price later will not change what this customer owes.
            </p>

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create agreement'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setAgreeFor(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Page>
  )
}
