'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { ghs2 } from '@/lib/money'
import {
  Page, PageHeader, Button, Modal, ModalActions, Field, Input, Select,
  Status, Badge, Money, Skeleton, EmptyState, Notice, Pagination,
  TableWrap, THead, TH, TBody, TR, TD,
  Metric, MetricRow, SearchBar, FilterChips, StatusTabs, MobileRecord,
  DetailPanel, DetailSection, Facts, Timeline,
} from '@/components/ui'

/*
 * PAYMENTS — the reference workspace for the admin console.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Everything on this screen is answered by `get_payments_workspace` and
 * `get_payment_detail` behind `admin-payments`, which requires an admin token
 * before it reads anything. Nothing financial is computed here: the browser
 * formats figures and never derives them. In particular the totals strip comes
 * from the same filtered query as the rows, so the summary can never describe
 * a different population than the list beneath it.
 *
 * The screen it replaces filtered its page in JavaScript AFTER the server had
 * paginated, so "manual payments" showed however many of the newest fifty
 * happened to be manual, under a pager built from the unfiltered count.
 *
 * ── GROUP CONTEXT ───────────────────────────────────────────────────────
 *
 * A member can be in several groups, so a payment's group is not a property of
 * the member — it is a property of what the payment SETTLED. Group and
 * membership are read from the allocation ledger. A pending payment has
 * settled nothing and therefore has no group, and this screen says exactly
 * that instead of borrowing one.
 */

const SIZE = 25
const STATUSES = [
  { value: 'all',     label: 'All' },
  { value: 'success', label: 'Successful' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed',  label: 'Failed' },
]

type Row = {
  id: string; reference: string; amount: number; status: string; type: string
  channel: 'online' | 'manual'; order_id: string | null; created_at: string
  member: { id: string; name: string; code: string; phone: string } | null
  allocated: number; days: number; groups: string[]
  reversed_days: number
  first_due: string | null; last_due: string | null; confirmed_at: string | null
}

const fmtDay = (d?: string | null) =>
  d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GH', { day: 'numeric', month: 'short' }) : '—'
const fmtWhen = (t?: string | null) =>
  t ? new Date(t).toLocaleString('en-GH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtFull = (t?: string | null) =>
  t ? new Date(t).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

/** How long a payment has been waiting, in words an operator can act on. */
function waitingFor(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 36e5)
  if (h < 1)  return 'under an hour'
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'}`
}

/* Money coverage: what a payment settled, described rather than totalled.
   "Allocated: GHS 450" is not something an administrator can act on. */
function Coverage({ r }: { r: Row }) {
  if (r.status !== 'success') {
    return <span className="text-ink-3">Not yet allocated</span>
  }
  if (r.days === 0) {
    return <span className="text-ink-3">No allocations</span>
  }
  const span = r.first_due === r.last_due
    ? fmtDay(r.first_due)
    : `${fmtDay(r.first_due)} → ${fmtDay(r.last_due)}`
  return (
    <span className="text-ink-2">
      <span className="tnum text-ink">{r.days}</span> day{r.days === 1 ? '' : 's'}
      <span className="text-ink-3"> · {span}</span>
    </span>
  )
}

export default function PaymentsWorkspace() {
  const [rows, setRows]       = useState<Row[]>([])
  const [summary, setSummary] = useState<Record<string, number> | null>(null)
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed]   = useState(false)

  const [status, setStatus]   = useState('all')
  const [q, setQ]             = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [channel, setChannel] = useState('all')
  const [from, setFrom]       = useState('')
  const [to, setTo]           = useState('')
  const [min, setMin]         = useState('')
  const [max, setMax]         = useState('')
  const [sheet, setSheet]     = useState(false)

  const [openId, setOpenId]   = useState<string | null>(null)
  const [detail, setDetail]   = useState<any>(null)
  const [detailBusy, setDetailBusy] = useState(false)

  // Typing should not fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    const p = new URLSearchParams({ status, channel, page: String(page), size: String(SIZE) })
    if (debouncedQ) p.set('q', debouncedQ)
    if (from) p.set('from', from)
    if (to)   p.set('to', to)
    if (min)  p.set('min', min)
    if (max)  p.set('max', max)

    const { data, error } = await callFunction<any>(`admin-payments?${p}`, { token: getAdminToken()! })
    setLoading(false)
    if (error || !data) { setFailed(true); return }
    setRows(data.rows ?? [])
    setTotal(data.total ?? 0)
    setSummary(data.summary ?? null)
  }, [status, channel, page, debouncedQ, from, to, min, max])

  useEffect(() => { load() }, [load])

  const openPayment = useCallback(async (id: string) => {
    setOpenId(id); setDetail(null); setDetailBusy(true)
    const { data } = await callFunction<any>(`admin-payments?id=${id}`, { token: getAdminToken()! })
    setDetailBusy(false)
    setDetail(data ?? null)
  }, [])

  const chips = useMemo(() => {
    const c: { key: string; label: string; onRemove: () => void }[] = []
    if (channel !== 'all') c.push({ key: 'ch', label: channel === 'online' ? 'In-app' : 'Manual', onRemove: () => { setChannel('all'); setPage(1) } })
    if (from) c.push({ key: 'f', label: `From ${from}`, onRemove: () => { setFrom(''); setPage(1) } })
    if (to)   c.push({ key: 't', label: `To ${to}`,     onRemove: () => { setTo(''); setPage(1) } })
    if (min)  c.push({ key: 'mn', label: `Min GHS ${min}`, onRemove: () => { setMin(''); setPage(1) } })
    if (max)  c.push({ key: 'mx', label: `Max GHS ${max}`, onRemove: () => { setMax(''); setPage(1) } })
    return c
  }, [channel, from, to, min, max])

  const clearAll = () => { setChannel('all'); setFrom(''); setTo(''); setMin(''); setMax(''); setPage(1) }
  const filtering = chips.length > 0 || debouncedQ !== '' || status !== 'all'

  return (
    <Page>
      <PageHeader
        title="Payments"
        sub="Monitor collections, payment status and contribution allocations."
        actions={
          <>
            <div className="hidden sm:block w-[300px]">
              <SearchBar value={q} onChange={setQ} placeholder="Member, phone, reference…" />
            </div>
            <Button variant="outline" onClick={() => setSheet(true)}>
              Filters{chips.length > 0 && <span className="ml-1.5 tnum text-ink-3">{chips.length}</span>}
            </Button>
          </>
        }
      />

      <div className="sm:hidden mb-4">
        <SearchBar value={q} onChange={setQ} placeholder="Member, phone, reference…" />
      </div>

      {/* Totals for the CURRENT filter, from the same query as the rows. */}
      <MetricRow>
        <Metric label="Collected" value={summary?.collected} primary tone="good"
          sub={summary ? `${summary.n_success} successful` : undefined} />
        <Metric label="Pending" value={summary?.pending}
          sub={summary ? `${summary.n_pending} awaiting confirmation` : undefined} />
        <Metric label="Failed" value={summary?.failed}
          sub={summary ? `${summary.n_failed} payments` : undefined} />
        <div className="min-w-0">
          <p className="t-eyebrow mb-1.5">Matching</p>
          <p className="text-xl font-semibold tnum text-ink">{total.toLocaleString()}</p>
          <p className="text-xs text-ink-3 mt-1.5">payment{total === 1 ? '' : 's'}</p>
        </div>
      </MetricRow>

      <div className="flex flex-wrap items-center gap-3 mt-5 mb-4">
        <StatusTabs
          value={status}
          onChange={v => { setStatus(v); setPage(1) }}
          options={STATUSES.map(s => ({
            ...s,
            count: !summary ? undefined
              : s.value === 'all' ? summary.count
              : s.value === 'success' ? summary.n_success
              : s.value === 'pending' ? summary.n_pending
              : summary.n_failed,
          }))}
        />
      </div>

      {chips.length > 0 && <div className="mb-4"><FilterChips chips={chips} onClear={clearAll} /></div>}

      {failed ? (
        <Notice tone="bad" title="We couldn't load payments.">
          <p>This is usually temporary. Nothing has been changed.</p>
          <Button variant="outline" className="mt-3" onClick={load}>Try again</Button>
        </Notice>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading payments">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[68px] rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtering ? 'No payments match these filters' : 'No payments yet'}
          body={filtering
            ? 'Try widening the date range, or clear the filters to see everything.'
            : 'Payments will appear here as members contribute, in-app or collected by an admin.'}
          action={filtering ? <Button variant="outline" onClick={() => { clearAll(); setStatus('all'); setQ('') }}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          {/* ── Desktop ──────────────────────────────────────────────── */}
          <div className="hidden lg:block border border-line rounded-xl overflow-hidden bg-surface">
            <TableWrap>
              <THead>
                <TH>Payment</TH><TH>Member</TH><TH>Group</TH>
                <TH align="right">Amount</TH><TH>Status</TH><TH>Covers</TH><TH>Created</TH>
              </THead>
              <TBody>
                {rows.map(r => (
                  <TR key={r.id} onClick={() => openPayment(r.id)}>
                    <TD>
                      <span className="font-mono text-xs text-ink-2">{r.reference.slice(0, 22)}</span>
                      <span className="block text-2xs text-ink-3 mt-0.5">
                        {r.channel === 'online' ? 'NaloPay' : 'Collected by admin'}
                        {r.type === 'registration_fee' && ' · Registration fee'}
                      </span>
                    </TD>
                    <TD>
                      <span className="text-ink">{r.member?.name ?? '—'}</span>
                      {r.member?.phone && <span className="block text-2xs text-ink-3 tnum">{r.member.phone}</span>}
                    </TD>
                    <TD>
                      {r.groups.length === 0
                        ? <span className="text-ink-3">—</span>
                        : r.groups.length === 1
                          ? <span className="text-ink-2">{r.groups[0]}</span>
                          : <span className="text-ink-2">{r.groups[0]} <span className="text-ink-3">+{r.groups.length - 1}</span></span>}
                    </TD>
                    <TD align="right"><span className="tnum font-medium text-ink">{ghs2(r.amount)}</span></TD>
                    <TD>{r.status === 'success' && r.reversed_days > 0 && r.days === 0
      ? <Status value="reversed" /> : <Status value={r.status} />}</TD>
                    <TD><Coverage r={r} /></TD>
                    <TD><span className="text-xs text-ink-3 whitespace-nowrap">{fmtWhen(r.created_at)}</span></TD>
                  </TR>
                ))}
              </TBody>
            </TableWrap>
            <Pagination page={page} pageSize={SIZE} total={total} onPage={setPage} />
          </div>

          {/* ── Mobile / tablet ──────────────────────────────────────── */}
          <div className="lg:hidden border border-line rounded-xl overflow-hidden bg-surface divide-y divide-line">
            {rows.map(r => (
              <MobileRecord
                key={r.id}
                onClick={() => openPayment(r.id)}
                lead={<Money value={r.amount} exact size="md" />}
                status={r.status === 'success' && r.reversed_days > 0 && r.days === 0
          ? <Status value="reversed" /> : <Status value={r.status} />}
                title={r.member?.name ?? 'Unknown member'}
                subtitle={r.groups[0] ?? (r.status === 'pending' ? 'Awaiting confirmation' : 'No group allocated')}
                meta={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Coverage r={r} />
                    <span aria-hidden="true">·</span>
                    <span className="tnum">{fmtWhen(r.created_at)}</span>
                  </span>
                }
              />
            ))}
            <Pagination page={page} pageSize={SIZE} total={total} onPage={setPage} />
          </div>
        </>
      )}

      {/* ── Filters, as a bottom sheet on phones ───────────────────────── */}
      <Modal open={sheet} onClose={() => setSheet(false)} title="Filter payments"
        footer={
          <ModalActions>
            <Button variant="outline" onClick={() => { clearAll(); setSheet(false) }}>Clear all</Button>
            <Button onClick={() => { setPage(1); setSheet(false) }}>Apply</Button>
          </ModalActions>
        }>
        <div className="space-y-4">
          <Field label="How it was paid">
            {ids => (
              <Select {...ids} value={channel} onChange={e => setChannel(e.target.value)}>
                <option value="all">Any</option>
                <option value="online">In-app (NaloPay)</option>
                <option value="manual">Collected by admin</option>
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">{ids => <Input {...ids} type="date" value={from} onChange={e => setFrom(e.target.value)} />}</Field>
            <Field label="To">{ids => <Input {...ids} type="date" value={to} onChange={e => setTo(e.target.value)} />}</Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min amount">{ids => <Input {...ids} type="number" inputMode="decimal" placeholder="0.00" value={min} onChange={e => setMin(e.target.value)} />}</Field>
            <Field label="Max amount">{ids => <Input {...ids} type="number" inputMode="decimal" placeholder="0.00" value={max} onChange={e => setMax(e.target.value)} />}</Field>
          </div>
        </div>
      </Modal>

      {/* ── One payment, in full ───────────────────────────────────────── */}
      <DetailPanel
        open={!!openId}
        onClose={() => { setOpenId(null); setDetail(null) }}
        title={detail ? <Money value={detail.payment.amount} exact size="lg" /> : 'Payment'}
        subtitle={detail ? detail.payment.reference : undefined}
      >
        {detailBusy || !detail ? (
          <div className="space-y-4"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
        ) : (
          <PaymentDetail d={detail} />
        )}
      </DetailPanel>
    </Page>
  )
}

/* ── Detail body ─────────────────────────────────────────────────────────── */
function PaymentDetail({ d }: { d: any }) {
  const p = d.payment
  const t = d.totals ?? {}
  const allocs: any[] = d.allocations ?? []
  const credit = Number(d.credit_banked ?? 0)
  const live   = allocs.filter(a => !a.reversed_at)
  const partial = live.filter(a => Number(a.remaining) > 0)

  // Distinct groups, with slot counts, so three slots in one group reads as
  // "3 slots" rather than the same group name printed three times.
  const byGroup = new Map<string, number>()
  for (const m of d.memberships ?? []) byGroup.set(m.group_name, (byGroup.get(m.group_name) ?? 0) + 1)

  const steps = (d.timeline ?? []).map((s: any) => ({
    label: s.label, at: fmtFull(s.at),
    note: s.count ? `${s.count} day${s.count === 1 ? '' : 's'}` : undefined,
  }))
  const stopped =
    p.status === 'pending' ? 'Waiting for NaloPay to confirm'
    : p.status === 'failed' ? 'Stopped here — the payment did not complete'
    : undefined

  return (
    <>
      <DetailSection title="Payment">
        <div className="flex items-center gap-2 mb-3">
          <Status value={p.status} />
          {p.type === 'registration_fee' && <Badge tone="info">Registration fee</Badge>}
          {p.scope === 'slot' && <Badge tone="neutral">This group only</Badge>}
        </div>
        <Facts rows={[
          ['Amount',    <span key="a" className="tnum font-medium">GHS {ghs2(p.amount)}</span>],
          ['Method',    p.channel === 'online' ? 'In-app payment' : 'Collected by an administrator'],
          ['Provider',  p.provider ?? <span className="text-ink-3">None — collected outside the app</span>],
          ['Provider ref', p.order_id ? <span className="font-mono text-xs">{p.order_id}</span> : null],
          ['Our ref',   <span key="r" className="font-mono text-xs break-all">{p.reference}</span>],
          ['Created',   fmtFull(p.created_at)],
        ]} />
      </DetailSection>

      {d.member && (
        <DetailSection title="Member">
          <Facts rows={[
            ['Name',   d.member.name],
            ['Phone',  <span key="p" className="tnum">{d.member.phone}</span>],
            ['Member', <span key="c" className="font-mono text-xs">{d.member.code}</span>],
          ]} />
        </DetailSection>
      )}

      <DetailSection title="Group" note={byGroup.size > 1 ? `${byGroup.size} groups` : undefined}>
        {byGroup.size === 0 ? (
          <p className="text-sm text-ink-3">
            This payment has not settled against any group yet, so it has no group context.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {[...byGroup].map(([name, slots]) => (
              <li key={name} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink min-w-0 truncate">{name}</span>
                {slots > 1 && <span className="text-xs text-ink-3 shrink-0 tnum">{slots} slots</span>}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      {/* The section that matters: exactly what the money covered. */}
      <DetailSection
        title="Allocation"
        note={live.length > 0 ? `${live.length} contribution day${live.length === 1 ? '' : 's'} covered` : undefined}
      >
        {allocs.length === 0 ? (
          <p className="text-sm text-ink-3">
            {p.status === 'pending'
              ? 'Nothing has been allocated. The money is not counted as received until NaloPay confirms it.'
              : p.status === 'failed'
                ? 'Nothing was allocated. A failed payment never reaches a contribution.'
                : 'No allocations were recorded for this payment.'}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-line-2 border-y border-line-2">
              {allocs.map((a, i) => {
                const remaining = Number(a.remaining)
                return (
                  <li key={i} className={cxRow(a)}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-ink tnum">{fmtFull(a.due_date + 'T12:00:00Z').split(',')[0]}</span>
                      <span className="text-sm tnum font-medium text-ink">GHS {ghs2(a.amount)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 mt-0.5">
                      <span className="text-xs text-ink-3">
                        of GHS {ghs2(a.obligation)} due
                        {a.reversed_at && ' · reversed'}
                      </span>
                      {remaining > 0
                        ? <span className="text-xs text-warning tnum">GHS {ghs2(remaining)} remaining</span>
                        : <span className="text-xs text-ink-3">settled</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="flex items-baseline justify-between gap-3 mt-3">
              <span className="text-sm text-ink-2">Total allocated</span>
              <span className="tnum font-semibold text-ink">GHS {ghs2(t.allocated)}</span>
            </div>
            {partial.length > 0 && (
              <p className="text-xs text-warning mt-2">
                {partial.length} day{partial.length === 1 ? '' : 's'} only partly covered.
              </p>
            )}
          </>
        )}
      </DetailSection>

      {credit > 0 && (
        <DetailSection title="Contribution credit">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-ink-2 max-w-[340px]">
              Left over after settling the days above. It is held against this
              membership and spends automatically on the next day due.
            </p>
            <span className="tnum font-semibold text-ink shrink-0">GHS {ghs2(credit)}</span>
          </div>
        </DetailSection>
      )}

      <DetailSection title="Timeline">
        <Timeline steps={steps} incomplete={stopped} />
      </DetailSection>
    </>
  )
}

const cxRow = (a: any) => `py-2.5 ${a.reversed_at ? 'opacity-55' : ''}`
