'use client'
import { useCallback, useEffect, useState } from 'react'
import { CalendarPlus, CheckCircle2, ChevronRight } from 'lucide-react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { Contribution } from '@/types'
import { format } from 'date-fns'
import PayPrompt from '@/components/susu/pay-prompt'
import PayNumberSheet from '@/components/susu/pay-number-sheet'
import { ghs2 } from '@/lib/money'
import {
  Badge, Button, Card, EmptyState, LoadingBlock, Modal, ModalActions, Money,
  Segmented, Tabs, useToast, cx,
} from '@/components/ui'

const PRESETS = [7, 14, 30]
type Filter = 'all' | 'pending' | 'paid'

export default function Payments() {
  const toast = useToast()
  const [rows, setRows]   = useState<Contribution[]>([])
  const [loading, setL]   = useState(true)
  const [filter, setF]    = useState<Filter>('all')
  const [paying, setP]    = useState<string | null>(null)
  const [pending, setPending]   = useState<any>(null)
  const [numSheet, setNumSheet] = useState<Contribution | null>(null)

  // Pay-ahead sheet
  const [sheet, setSheet]    = useState(false)
  const [days, setDays]      = useState(7)
  const [prev, setPrev]      = useState<any>(null)
  const [loadingPrev, setLP] = useState(false)
  const [bulkBusy, setBB]    = useState(false)

  const groupCount = new Set(
    rows.map(r => (r as any).group_id ?? (r as any).susu_groups?.name).filter(Boolean),
  ).size

  const load = useCallback(async () => {
    setL(true)
    const q = filter === 'all' ? 'page=1' : `status=${filter}&page=1`
    const { data, error } = await callFunction<{ contributions: Contribution[] }>(
      `contributions-list?${q}`, { token: getMemberToken()! },
    )
    if (error) toast.error({ title: 'Could not load payments', body: error })
    setRows(data?.contributions ?? []); setL(false)
  }, [filter, toast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!sheet) return
    setLP(true)
    callFunction<any>(`payments-bulk?days=${days}`, { token: getMemberToken()! })
      .then(({ data }) => setPrev(data))
      .finally(() => setLP(false))
  }, [sheet, days])

  async function doPayOne(c: Contribution, payNumber?: string, payNetwork?: string, payAmount?: number, thisGroupOnly?: boolean) {
    setNumSheet(null)
    setP(c.id)
    const { data, error } = await callFunction<any>('payments-initialize', {
      method: 'POST', token: getMemberToken()!,
      body: {
        contribution_id: c.id, pay_number: payNumber, pay_network: payNetwork,
        pay_amount: payAmount, this_group_only: thisGroupOnly,
      },
    })
    setP(null)
    if (error) { toast.error({ title: 'Payment could not start', body: error }); return }
    if (data?.dev_mode) { toast.success('Payment recorded.'); return load() }
    if (data?.status === 'prompted' || data?.status === 'otp_required') {
      setPending({ ...data, amount: data.amount ?? c.amount }); return
    }
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  async function payBulk() {
    setBB(true)
    const { data, error } = await callFunction<any>('payments-bulk', {
      method: 'POST', body: { days }, token: getMemberToken()!,
    })
    setBB(false)
    if (error) { toast.error({ title: 'Could not start the payment', body: error }); return }
    if (data?.dev_mode) { setSheet(false); toast.success('Payment recorded.'); return load() }
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  const unpaid = rows.filter(r => r.status !== 'paid').length

  return (
    <div className="max-w-md mx-auto px-5 pt-6 animate-fade-in">
      <h1 className="text-2xl font-semibold text-ink">Payments</h1>
      <p className="text-sm text-ink-2 mt-1">Pay day by day, or clear a stretch in one MoMo payment.</p>

      {unpaid > 0 && (
        <button
          type="button" onClick={() => setSheet(true)}
          className="w-full mt-5 flex items-center gap-3.5 p-4 rounded-lg bg-surface border border-line
                     text-left transition-colors hover:border-ink/20 active:bg-surface-2"
        >
          <span className="w-10 h-10 rounded-md bg-accent-soft grid place-items-center shrink-0">
            <CalendarPlus size={18} strokeWidth={2.1} className="text-accent" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-ink">Pay ahead</span>
            <span className="block text-xs text-ink-2 mt-0.5">
              Cover several days at once — one prompt, one PIN
            </span>
          </span>
          <ChevronRight size={17} strokeWidth={2.2} className="text-ink-3 shrink-0" aria-hidden="true" />
        </button>
      )}

      <Tabs
        className="mt-6"
        ariaLabel="Filter payments"
        value={filter} onChange={setF}
        items={[
          { value: 'all',     label: 'All' },
          { value: 'pending', label: 'Due' },
          { value: 'paid',    label: 'Paid' },
        ]}
      />

      {loading ? (
        <LoadingBlock label="Loading your payments" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={filter === 'paid' ? 'Nothing paid yet' : "You're all caught up"}
          body={filter === 'paid'
            ? 'Payments appear here as soon as they settle.'
            : 'Nothing is owing right now. Your next contribution will show up on its due date.'}
        />
      ) : (
        <ul className="divide-y divide-line-2">
          {rows.map(c => {
            const paid = c.status === 'paid'
            const late = c.status === 'overdue' || c.is_flagged
            const penalty = Number(c.penalty_due ?? 0)
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <p className="text-base font-medium text-ink truncate">{c.susu_groups?.name}</p>
                  <p className="text-xs text-ink-3 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {format(new Date(c.due_date), 'd MMM yyyy')}
                    {late && <Badge tone="bad">Late</Badge>}
                    {penalty > 0 && (
                      <span className="text-danger font-medium tnum">+{ghs2(penalty)} penalty</span>
                    )}
                  </p>
                </div>
                {paid ? (
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink tnum shrink-0">
                    <CheckCircle2 size={15} strokeWidth={2.3} className="text-success" aria-hidden="true" />
                    {ghs2(c.amount)}
                  </span>
                ) : (
                  <Button
                    variant="accent" size="sm" className="shrink-0"
                    loading={paying === c.id}
                    onClick={() => setNumSheet(c)}
                  >
                    Pay {ghs2(c.amount)}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* ---- Pay ahead ---- */}
      <Modal
        open={sheet} onClose={() => setSheet(false)} busy={bulkBusy}
        title="Pay ahead"
        description="One MoMo payment, several days covered."
        footer={prev?.count > 0 ? (
          <Button variant="accent" size="lg" full loading={bulkBusy} onClick={payBulk}>
            Pay GHS {ghs2(prev.total)}
          </Button>
        ) : undefined}
      >
        <Segmented
          className="w-full"
          ariaLabel="Days to pay ahead"
          value={String(days)} onChange={v => setDays(Number(v))}
          items={PRESETS.map(d => ({ value: String(d), label: `${d} days` }))}
        />

        <div className="mt-5">
          <div className="flex justify-between items-baseline mb-2">
            <label htmlFor="days" className="text-xs text-ink-2">Or choose exactly</label>
            <span className="text-sm font-semibold text-ink tnum">{days} days</span>
          </div>
          <input
            id="days" type="range" min={1} max={60} value={days}
            onChange={e => setDays(parseInt(e.target.value))}
            className="w-full accent-accent h-6 cursor-pointer"
          />
        </div>

        {loadingPrev ? (
          <LoadingBlock label="Working out the total" className="py-10" />
        ) : prev?.count > 0 ? (
          <div className="mt-5 rounded-md border border-line divide-y divide-line-2">
            <Row label={`${prev.count} contribution${prev.count === 1 ? '' : 's'}`} value={ghs2(prev.subtotal)} />
            {prev.penalties > 0 && <Row label="Penalties" value={ghs2(prev.penalties)} tone="danger" />}
            <div className="px-3.5 py-2.5">
              <p className="text-xs text-ink-3">
                {prev.from && format(new Date(prev.from), 'd MMM')} – {prev.to && format(new Date(prev.to), 'd MMM yyyy')}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 px-3.5 py-3 bg-surface-2">
              <span className="text-xs font-semibold text-ink">Total</span>
              <Money value={prev.total} exact size="md" />
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-3 py-10 text-center">Nothing left to pay.</p>
        )}
      </Modal>

      {numSheet && (
        <PayNumberSheet
          amount={Number(numSheet.amount ?? 0)}
          hasOtherGroups={groupCount > 1}
          groupName={(numSheet as any).susu_groups?.name}
          slotLabel={(numSheet as any).group_memberships?.payout_position
            ? `Slot ${(numSheet as any).group_memberships.payout_position}` : undefined}
          dueDate={(numSheet as any).due_date}
          onConfirm={(num, net, amt, only) => doPayOne(numSheet, num, net, amt, only)}
          onClose={() => setNumSheet(null)}
        />
      )}

      {pending && (
        <PayPrompt
          reference={pending.reference}
          amount={Number(pending.amount ?? 0)}
          initial={pending.status}
          message={pending.message}
          ussd={pending.ussd}
          onDone={() => { setPending(null); load() }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <span className={cx('text-sm', tone === 'danger' ? 'text-danger' : 'text-ink-2')}>{label}</span>
      <span className={cx('text-sm font-medium tnum', tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</span>
    </div>
  )
}
