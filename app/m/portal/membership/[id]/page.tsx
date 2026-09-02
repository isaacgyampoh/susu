'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { ChevronRight, Wallet } from 'lucide-react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MembershipView, PortalState } from '@/types/portal'
import { ghs2 } from '@/lib/money'
import PaySheet from '@/components/susu/pay-sheet'
import PayPrompt from '@/components/susu/pay-prompt'
import { AppBar } from '@/components/susu/app-bar'
import {
  FinancialAmount, FinancialSection, DetailRow, DetailRows,
} from '@/components/susu/financial'
import { Button, EmptyState, Progress, Skeleton, cx } from '@/components/ui'

/**
 * ONE GROUP, AS THE MEMBER WHO IS IN IT.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Everything here belongs to THIS membership. The obligations, the payments,
 * the credit and the cash-out are its own — none of it is shared with the
 * member's other groups and none of it is aggregated across them. A member
 * holding three slots in one group has three of these screens, because the
 * three slots collect on different dates for different amounts.
 *
 * The data comes from the same single portal query the home screen uses, so
 * this page adds no round trip and cannot disagree with the row that was
 * tapped to reach it.
 *
 * ── COMPOSITION ─────────────────────────────────────────────────────────
 *
 * This used to be a page header, an ink card and four more cards, with four
 * tinted notices stacked between them — most of the colour on the screen spent
 * before the member reached anything they could act on. It is now the shared
 * financial language: one figure with the weight, facts under rules, and the
 * status lines folded into a single band.
 *
 * The pay action is pinned to the bottom of the viewport rather than sitting at
 * the end of a long scroll. It is the one thing a member comes here to do, and
 * on a phone it should be under their thumb, not four screens down.
 */
export default function MembershipDetail() {
  const { id } = useParams<{ id: string }>()
  const [state, setState]       = useState<PortalState | null>(null)
  const [loading, setLoading]   = useState(true)
  const [paySheet, setPaySheet] = useState<MembershipView | null>(null)
  const [pending, setPending]   = useState<any>(null)

  const load = useCallback(async () => {
    const { data } = await callFunction<PortalState>('member-profile', { token: getMemberToken()! })
    setState(data); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return (
    <div>
      <AppBar title="Group" back={{ href: '/m/portal/dashboard', label: 'Back to home' }} />
      <div className="portal-w pt-6 space-y-4" role="status" aria-label="Loading this group">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-44 rounded-xl !mt-8" />
      </div>
    </div>
  )

  const m = state?.memberships.find(x => x.membership_id === id)
  if (!state || !m) return (
    <div>
      <AppBar title="Group" back={{ href: '/m/portal/dashboard', label: 'Back to home' }} />
      <div className="portal-w pt-10">
        <EmptyState
          icon={Wallet}
          title="Group not found"
          body="This group is not one of yours, or it is no longer active."
        />
      </div>
    </div>
  )

  // Payments that touched THIS membership, showing what they covered here.
  const payments = state.payments
    .map(p => ({ ...p, items: p.items.filter(i => i.membership_id === id) }))
    .filter(p => p.items.length > 0)

  const pct    = m.total_expected > 0 ? (m.total_paid / m.total_expected) * 100 : 0
  const owes   = m.due_today > 0.005
  const noPlan = m.coverage === 'no-schedule'

  const partNext = m.next_obligation
    && m.next_obligation.amount_paid > 0.005
    && m.next_obligation.remaining > 0.005

  const notes: { tone: 'bad' | 'warn' | 'good'; head: string; body: string }[] = []
  if (m.overdue > 0.005) notes.push({
    tone: 'bad', head: `GHS ${ghs2(m.overdue)} overdue`,
    body: 'Anything still owing on your collection date is deducted from what you receive.',
  })
  if (partNext) notes.push({
    tone: 'warn', head: 'Your next contribution is part paid',
    body: `You have paid GHS ${ghs2(m.next_obligation!.amount_paid)} of GHS ${ghs2(m.next_obligation!.amount)}. GHS ${ghs2(m.next_obligation!.remaining)} remains to complete it.`,
  })
  if (m.days_covered_ahead > 0) notes.push({
    tone: 'good', head: `${m.days_covered_ahead} day${m.days_covered_ahead === 1 ? '' : 's'} paid ahead`,
    body: 'You are covered in this group without paying again until then.',
  })
  if (m.advance_credit > 0.005) notes.push({
    tone: 'good', head: `GHS ${ghs2(m.advance_credit)} credit on this group`,
    body: 'Applied automatically to your next contribution here. It is never used for another group.',
  })

  return (
    <div className="animate-fade-in">
      <AppBar title="Group" back={{ href: '/m/portal/dashboard', label: 'Back to home' }} />

      {/* Space for the pinned action, so the last row is never trapped under it. */}
      <div className="portal-w pt-6 pb-28">

        <header>
          <h1 className="font-display text-xl font-semibold text-ink tracking-[-.02em]">
            {m.group_name}
          </h1>
          <p className="text-sm text-ink-2 mt-1 tnum">
            GHS {ghs2(m.contribution_amount)} {m.frequency} · Slot {m.payout_position}
            {m.slot_fraction !== 1 && ` · ${m.slot_fraction === 0.5 ? 'half' : 'quarter'} slot`}
          </p>

          <p className="t-eyebrow mt-7 mb-2">Due today on this group</p>
          <FinancialAmount value={m.due_today} />
          {m.next_obligation && (
            <p className="text-sm text-ink-2 mt-2">
              Next contribution GHS {ghs2(m.next_obligation.remaining)} on{' '}
              {format(new Date(m.next_obligation.due_date), 'EEEE d MMMM')}
            </p>
          )}
        </header>

        {/* One band, one line per fact — not four full-width tinted blocks. */}
        {notes.length > 0 && (
          <section aria-label="This group's status"
            className="mt-6 border border-line rounded-xl bg-surface divide-y divide-line-2">
            {notes.map(n => (
              <div key={n.head} className="flex gap-3 p-4">
                <span aria-hidden="true" className={cx(
                  'mt-[7px] w-1.5 h-1.5 rounded-full shrink-0',
                  n.tone === 'bad' ? 'bg-danger' : n.tone === 'warn' ? 'bg-warning' : 'bg-success',
                )} />
                <div className="min-w-0">
                  <p className={cx('text-base font-medium',
                    n.tone === 'bad' ? 'text-danger' : n.tone === 'warn' ? 'text-warning' : 'text-ink')}>
                    {n.head}
                  </p>
                  <p className="text-xs text-ink-2 mt-1 leading-relaxed">{n.body}</p>
                </div>
              </div>
            ))}
          </section>
        )}

        <FinancialSection title="Where you stand">
          <Progress value={pct} tone={m.overdue > 0.005 ? 'warning' : 'accent'}
            label="Contributions paid" />
          <p className="text-xs text-ink-3 mt-2 tnum">
            {m.obligations_settled} of {m.obligations} days paid
          </p>
          <DetailRows>
            <DetailRow label="Paid so far"          value={`GHS ${ghs2(m.total_paid)}`} />
            <DetailRow label="Still to pay"         value={`GHS ${ghs2(m.total_outstanding)}`} />
            <DetailRow label="Total over the cycle" value={`GHS ${ghs2(m.total_expected)}`} />
            <DetailRow label="Paid in advance"      value={`GHS ${ghs2(m.paid_in_advance)}`} />
          </DetailRows>
        </FinancialSection>

        <FinancialSection title="Your collection">
          <DetailRows>
            <DetailRow label="You collect"
              value={m.payout_amount != null ? `GHS ${ghs2(m.payout_amount)}` : 'Not set yet'} />
            <DetailRow label="Collection date"
              value={m.payout_date ? format(new Date(m.payout_date), 'd MMMM yyyy') : 'Not set yet'} />
            <DetailRow label="Position in rotation" value={`Slot ${m.payout_position}`} />
            <DetailRow label="Received" value={m.payout_received ? 'Yes' : 'Not yet'} />
          </DetailRows>
          {/* Never guessed. An unset date says so. */}
          {(!m.payout_date || m.payout_amount == null) && (
            <p className="text-xs text-warning mt-3 leading-relaxed">
              Your collector has not set this yet. Message them from your profile —
              the system will not guess a date or an amount.
            </p>
          )}
        </FinancialSection>

        <FinancialSection
          title="Payments to this group"
          note={payments.length > 0 ? `${payments.length}` : undefined}
        >
          {payments.length === 0 ? (
            <p className="text-sm text-ink-3">No payments recorded for this group yet.</p>
          ) : (
            <div className="divide-y divide-line-2">
              {payments.map(p => {
                // What this payment put into THIS group. A payment spanning
                // several groups shows only its share here, and says so.
                const here = p.items.reduce((s, i) => s + i.amount, 0)
                return (
                  <Link
                    key={p.reference}
                    href={`/m/portal/payments/${encodeURIComponent(p.reference)}`}
                    className="flex items-center gap-3 py-3 min-h-[56px] transition-colors
                               hover:bg-surface-2 active:bg-surface-3
                               -mx-[1.125rem] px-[1.125rem] md:-mx-7 md:px-7
                               focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-inset focus-visible:ring-ink/30"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink tnum">GHS {ghs2(here)}</p>
                      <p className="text-xs text-ink-2 mt-0.5">
                        {p.items.length} day{p.items.length === 1 ? '' : 's'}
                        {here !== p.total && ' · part of a larger payment'}
                      </p>
                      <p className="text-xs text-ink-3 mt-0.5 tnum">
                        {p.at ? format(new Date(p.at), 'd MMM yyyy · HH:mm') : ''}
                      </p>
                    </div>
                    <ChevronRight size={15} strokeWidth={2} aria-hidden="true"
                      className="text-ink-3 shrink-0" />
                  </Link>
                )
              })}
            </div>
          )}
        </FinancialSection>
      </div>

      {/* Pinned above the tab bar: the one action this screen exists for. */}
      <div className="fixed inset-x-0 z-30 bottom-[calc(var(--tabbar)+env(safe-area-inset-bottom))]
                      bg-surface/92 backdrop-blur-xl border-t border-line">
        <div className="portal-w py-3">
          <Button variant="accent" size="lg" full onClick={() => setPaySheet(m)} disabled={noPlan}>
            {noPlan ? 'This group has not started yet'
              : owes ? `Pay GHS ${ghs2(m.due_today)}`
              : 'Pay ahead on this group'}
          </Button>
        </div>
      </div>

      {paySheet && (
        <PaySheet
          membership={paySheet}
          defaultNumber={state.member.mobile_money_number ?? state.member.phone}
          defaultNetwork={state.member.mobile_money_provider ?? 'MTN'}
          hasOtherMemberships={state.memberships.length > 1}
          onClose={() => setPaySheet(null)}
          onPrompted={p => { setPaySheet(null); setPending(p) }}
          onBusy={() => {}}
        />
      )}
      {pending && (
        <PayPrompt
          reference={pending.reference} amount={Number(pending.amount ?? 0)}
          phone={state.member.mobile_money_number ?? state.member.phone}
          initial={pending.status} message={pending.message} ussd={pending.ussd}
          onDone={() => { setPending(null); load() }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
