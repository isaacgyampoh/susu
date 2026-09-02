'use client'
import { useCallback, useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { CheckCircle2, Clock, FileText, Printer } from 'lucide-react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import { ghs2 } from '@/lib/money'
import {
  Badge, Button, Card, DetailList, DetailRow, EmptyState, LoadingBlock,
  Notice, Segmented, Select, cx, useToast,
} from '@/components/ui'

/**
 * Member statement.
 *
 * Every figure comes from `get_member_statement()`. This component renders and
 * prints; it computes nothing. The period is validated and bounded server-side,
 * so a client cannot widen the range, and the membership filter is checked for
 * ownership before it is honoured.
 *
 * Each membership reports whether its own accounting balances:
 *
 *     opening + fell due − settled − covered in advance = closing
 *
 * A statement that does not balance says so on its face rather than presenting
 * a rounded figure as though it reconciled.
 */

type Period = 'this' | 'last' | 'three' | 'all'

interface Line {
  due_date: string; amount: number; penalty: number; amount_paid: number
  remaining: number; status: string; settled_on: string | null; method: string | null
}
interface MembershipStatement {
  membership_id: string; group_name: string; contribution: number; frequency: string
  cash_out_date: string | null; payout_amount: number | null; payout_received: boolean
  opening: { outstanding: number; credit: number }
  movements: {
    fell_due: number; days_fell_due: number; settled: number; days_settled: number
    covered_in_advance: number; days_covered_in_advance: number; payments_applied: number
  }
  closing: { outstanding: number; credit: number; paid_in_advance: number; partially_applied: number }
  lifetime: { total_expected: number; total_paid: number }
  reconciles: boolean
  entries: Line[]
  payments: { reference: string; at: string; applied: number; days: number }[]
  credit_movements: { at: string; amount: number; type: string; note: string }[]
}
interface Statement {
  member: { member_code: string; full_name: string; phone: string }
  period: { from: string; to: string; days: number }
  generated_at: string
  attribution_complete: boolean
  attribution_note: string | null
  memberships: MembershipStatement[]
}

function range(p: Period): { from: string; to: string } {
  const now = new Date()
  const iso = (d: Date) => format(d, 'yyyy-MM-dd')
  if (p === 'this')  return { from: iso(startOfMonth(now)), to: iso(now) }
  if (p === 'last')  return { from: iso(startOfMonth(subMonths(now, 1))), to: iso(endOfMonth(subMonths(now, 1))) }
  if (p === 'three') return { from: iso(startOfMonth(subMonths(now, 2))), to: iso(now) }
  return { from: iso(subMonths(now, 12)), to: iso(now) }
}

export default function StatementPage() {
  const toast = useToast()
  const [period, setPeriod] = useState<Period>('this')
  const [membership, setMembership] = useState<string>('all')
  const [data, setData] = useState<Statement | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { from, to } = range(period)
    const q = new URLSearchParams({ from, to })
    if (membership !== 'all') q.set('membership_id', membership)
    const { data: d, error } = await callFunction<Statement>(`member-statement?${q}`, { token: getMemberToken()! })
    if (error) toast.error({ title: 'Could not load your statement', body: error })
    else setData(d)
    setLoading(false)
  }, [period, membership, toast])

  useEffect(() => { load() }, [load])

  if (loading && !data) return <LoadingBlock label="Preparing your statement" className="h-[60vh]" />
  if (!data) return (
    <div className="portal-w pt-10">
      <EmptyState icon={FileText} title="No statement available" body="Try a different period." />
    </div>
  )

  const shown = membership === 'all'
    ? data.memberships
    : data.memberships.filter(m => m.membership_id === membership)

  return (
    <div className="portal-w pt-6 space-y-4 animate-fade-in">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Statement</h1>
        <p className="text-sm text-ink-2 mt-1">
          {data.member.full_name} · <span className="font-mono">{data.member.member_code}</span>
        </p>
        <p className="text-xs text-ink-3 mt-0.5 tnum">
          {format(new Date(data.period.from), 'd MMM yyyy')} – {format(new Date(data.period.to), 'd MMM yyyy')}
          {' · generated '}{format(new Date(data.generated_at), 'd MMM yyyy, HH:mm')}
        </p>
      </header>

      <div className="flex flex-wrap gap-2 print:hidden">
        <Segmented
          ariaLabel="Statement period"
          value={period} onChange={setPeriod}
          items={[
            { value: 'this',  label: 'This month' },
            { value: 'last',  label: 'Last month' },
            { value: 'three', label: '3 months' },
            { value: 'all',   label: '12 months' },
          ]}
        />
        {data.memberships.length > 1 && (
          <Select value={membership} onChange={e => setMembership(e.target.value)} className="max-w-[220px]">
            <option value="all">All groups</option>
            {data.memberships.map(m => (
              <option key={m.membership_id} value={m.membership_id}>{m.group_name}</option>
            ))}
          </Select>
        )}
        <Button variant="outline" icon={Printer} onClick={() => window.print()}>Print</Button>
      </div>

      {!data.attribution_complete && data.attribution_note && (
        <Notice tone="warn" title="Limited payment detail for this period">
          {data.attribution_note}
        </Notice>
      )}

      {shown.length === 0 ? (
        <Card pad="none"><EmptyState icon={FileText} title="Nothing in this period" compact /></Card>
      ) : shown.map(m => (
        <Card key={m.membership_id} pad="lg">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="t-h2 truncate">{m.group_name}</h2>
              <p className="text-xs text-ink-3 mt-0.5 tnum">GHS {ghs2(m.contribution)} {m.frequency}</p>
            </div>
            {m.reconciles
              ? <Badge tone="good"><CheckCircle2 size={11} strokeWidth={2.6} aria-hidden="true" />Balanced</Badge>
              : <Badge tone="warn"><Clock size={11} strokeWidth={2.6} aria-hidden="true" />Does not balance</Badge>}
          </div>

          {!m.reconciles && (
            <Notice tone="warn" className="mt-3">
              These figures do not balance for this period. That is shown rather than
              hidden — please raise it with your collector.
            </Notice>
          )}

          {/* The accounting identity, stated openly rather than summarised. */}
          <DetailList className="mt-4">
            <DetailRow label="Owing at the start">GHS {ghs2(m.opening.outstanding)}</DetailRow>
            <DetailRow label={`Fell due (${m.movements.days_fell_due} days)`}>
              + GHS {ghs2(m.movements.fell_due)}
            </DetailRow>
            <DetailRow label={`Settled (${m.movements.days_settled} days)`}>
              − GHS {ghs2(m.movements.settled)}
            </DetailRow>
            {m.movements.covered_in_advance > 0.005 && (
              <DetailRow label={`Already covered in advance (${m.movements.days_covered_in_advance} days)`}>
                − GHS {ghs2(m.movements.covered_in_advance)}
              </DetailRow>
            )}
            <DetailRow label="Owing at the end">
              <strong>GHS {ghs2(m.closing.outstanding)}</strong>
            </DetailRow>
          </DetailList>

          {(m.closing.credit > 0.005 || m.closing.paid_in_advance > 0.005 || m.closing.partially_applied > 0.005) && (
            <div className="mt-4 rounded-md bg-surface-2 border border-line p-3.5 space-y-1.5">
              {m.closing.credit > 0.005 && (
                <p className="text-xs text-ink-2">
                  <strong className="text-ink">GHS {ghs2(m.closing.credit)} credit</strong> held on this
                  group. Used only for this group&rsquo;s contributions.
                </p>
              )}
              {m.closing.paid_in_advance > 0.005 && (
                <p className="text-xs text-ink-2">
                  <strong className="text-ink">GHS {ghs2(m.closing.paid_in_advance)}</strong> paid towards
                  days after this period.
                </p>
              )}
              {m.closing.partially_applied > 0.005 && (
                <p className="text-xs text-ink-2">
                  <strong className="text-ink">GHS {ghs2(m.closing.partially_applied)}</strong> already
                  applied to days still open.
                </p>
              )}
            </div>
          )}

          {m.payments.length > 0 && (
            <div className="mt-5">
              <p className="t-eyebrow mb-2">Payments in this period</p>
              <div className="divide-y divide-line-2 border-y border-line-2">
                {m.payments.map(p => (
                  <div key={p.reference} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{format(new Date(p.at), 'd MMM yyyy')}</p>
                      <p className="text-2xs text-ink-3 font-mono truncate">{p.reference}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-ink tnum">GHS {ghs2(p.applied)}</p>
                      <p className="text-2xs text-ink-3">{p.days} day{p.days === 1 ? '' : 's'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {m.entries.length > 0 && (
            <details className="mt-5">
              <summary className="t-eyebrow cursor-pointer select-none">
                Day by day · {m.entries.length}
              </summary>
              <div className="mt-2 divide-y divide-line-2 border-y border-line-2 max-h-[420px] overflow-y-auto">
                {m.entries.map(e => (
                  <div key={e.due_date} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-xs text-ink-2">{format(new Date(e.due_date), 'EEE d MMM')}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className={cx('text-xs tnum',
                        e.status === 'paid' ? 'text-ink' : e.remaining > 0.005 ? 'text-warning' : 'text-ink-2')}>
                        {e.status === 'paid'
                          ? `GHS ${ghs2(e.amount)}`
                          : `GHS ${ghs2(e.amount_paid)} of ${ghs2(e.amount)}`}
                      </span>
                      {e.status === 'paid'
                        ? <CheckCircle2 size={13} strokeWidth={2.4} className="text-success" aria-hidden="true" />
                        : <Clock size={13} strokeWidth={2.4} className="text-warning" aria-hidden="true" />}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <DetailList className="mt-5">
            <DetailRow label="Cash-out date">
              {m.cash_out_date ? format(new Date(m.cash_out_date), 'd MMMM yyyy') : 'Not yet assigned'}
            </DetailRow>
            <DetailRow label="Payout amount">
              {m.payout_amount != null ? `GHS ${ghs2(m.payout_amount)}` : 'Not yet set'}
            </DetailRow>
            <DetailRow label="Paid into this group, all time">
              GHS {ghs2(m.lifetime.total_paid)}
            </DetailRow>
          </DetailList>
        </Card>
      ))}
    </div>
  )
}
