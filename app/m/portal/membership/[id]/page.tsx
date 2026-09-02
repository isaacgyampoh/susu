'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { format } from 'date-fns'
import { CheckCircle2, Clock, Wallet } from 'lucide-react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MembershipView, PortalState } from '@/types/portal'
import { ghs2 } from '@/lib/money'
import PaySheet from '@/components/susu/pay-sheet'
import PayPrompt from '@/components/susu/pay-prompt'
import {
  Badge, Button, Card, DetailList, DetailRow, EmptyState, LoadingBlock,
  Money, Notice, PageHeader, Progress, cx,
} from '@/components/ui'

/**
 * One membership, in full.
 *
 * Everything here belongs to THIS membership. The obligations, the payments,
 * the credit and the cash-out are its own — none of it is shared with the
 * member's other groups, and none of it is aggregated across them.
 *
 * The data comes from the same single portal query the dashboard uses, so this
 * page adds no round trips and cannot disagree with the card the member tapped.
 */
export default function MembershipDetail() {
  const { id } = useParams<{ id: string }>()
  const [state, setState] = useState<PortalState | null>(null)
  const [loading, setLoading] = useState(true)
  const [paySheet, setPaySheet] = useState<MembershipView | null>(null)
  const [pending, setPending] = useState<any>(null)

  const load = useCallback(async () => {
    const { data } = await callFunction<PortalState>('member-profile', { token: getMemberToken()! })
    setState(data); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <LoadingBlock label="Loading this group" className="h-[60vh]" />

  const m = state?.memberships.find(x => x.membership_id === id)
  if (!state || !m) return (
    <div className="portal-w pt-10">
      <EmptyState
        icon={Wallet}
        title="Group not found"
        body="This group is not one of yours, or it is no longer active."
      />
    </div>
  )

  // Payments that touched THIS membership, with what they covered here.
  const payments = state.payments
    .map(p => ({ ...p, items: p.items.filter(i => i.membership_id === id) }))
    .filter(p => p.items.length > 0)

  const pct = m.total_expected > 0 ? (m.total_paid / m.total_expected) * 100 : 0
  const owes = m.due_today > 0.005

  return (
    <div className="portal-w pt-6 space-y-4 animate-fade-in">
      <PageHeader
        back={{ href: '/m/portal/dashboard', label: 'All groups' }}
        title={m.group_name}
        sub={`GHS ${ghs2(m.contribution_amount)} ${m.frequency} · Slot ${m.payout_position} of your rotation`}
      />

      <Card tone="ink" pad="lg">
        <p className="text-xs font-medium text-inverse/60">
          {owes ? 'Due today on this group' : 'Nothing owing today'}
        </p>
        <Money value={m.due_today} exact size="xl" className="text-inverse mt-1.5" />
        {m.next_obligation && (
          <p className="text-xs text-inverse/60 mt-3">
            Next contribution GHS {ghs2(m.next_obligation.remaining)} on{' '}
            {format(new Date(m.next_obligation.due_date), 'EEEE d MMM')}
          </p>
        )}
      </Card>

      {m.next_obligation && m.next_obligation.amount_paid > 0.005 && m.next_obligation.remaining > 0.005 && (
        <Notice tone="warn" title="Your next contribution is part paid">
          You have paid GHS {ghs2(m.next_obligation.amount_paid)} of
          GHS {ghs2(m.next_obligation.amount)}.
          GHS {ghs2(m.next_obligation.remaining)} remains to complete it.
        </Notice>
      )}

      {m.days_covered_ahead > 0 && (
        <Notice tone="good" title={`${m.days_covered_ahead} day${m.days_covered_ahead === 1 ? '' : 's'} paid ahead`}>
          You are covered in this group without paying again until then.
        </Notice>
      )}

      {m.advance_credit > 0.005 && (
        <Notice tone="good" title={`GHS ${ghs2(m.advance_credit)} credit on this group`}>
          Applied automatically to your next contribution here. It is never used
          for another group.
        </Notice>
      )}

      {m.overdue > 0.005 && (
        <Notice tone="bad" title={`GHS ${ghs2(m.overdue)} overdue`}>
          Anything still owing on your collection date is deducted from what you receive.
        </Notice>
      )}

      <Card pad="lg">
        <p className="t-h2 mb-3">Where you stand</p>
        <Progress value={pct} tone={m.overdue > 0.005 ? 'warning' : 'accent'}
          label="Contributions paid" />
        <p className="text-xs text-ink-3 mt-2 tnum">
          {m.obligations_settled} of {m.obligations} days paid
        </p>
        <DetailList className="mt-4">
          <DetailRow label="Paid so far">GHS {ghs2(m.total_paid)}</DetailRow>
          <DetailRow label="Still to pay">GHS {ghs2(m.total_outstanding)}</DetailRow>
          <DetailRow label="Total over the cycle">GHS {ghs2(m.total_expected)}</DetailRow>
          <DetailRow label="Paid in advance">GHS {ghs2(m.paid_in_advance)}</DetailRow>
          <DetailRow label="Slot size">
            {m.slot_fraction === 1 ? 'Full slot' : m.slot_fraction === 0.5 ? 'Half slot' : 'Quarter slot'}
          </DetailRow>
        </DetailList>
      </Card>

      <Card pad="lg">
        <p className="t-h2 mb-3">Your collection</p>
        <DetailList>
          <DetailRow label="You collect">
            {m.payout_amount != null ? `GHS ${ghs2(m.payout_amount)}` : 'Not set yet'}
          </DetailRow>
          <DetailRow label="Collection date">
            {m.payout_date ? format(new Date(m.payout_date), 'd MMMM yyyy') : 'Not set yet'}
          </DetailRow>
          <DetailRow label="Position in rotation">Slot {m.payout_position}</DetailRow>
          <DetailRow label="Received">{m.payout_received ? 'Yes' : 'Not yet'}</DetailRow>
        </DetailList>
        {(!m.payout_date || m.payout_amount == null) && (
          <p className="text-xs text-warning mt-3 leading-relaxed">
            Your collector has not set this yet. Message them from your profile —
            the system will not guess a date or an amount.
          </p>
        )}
      </Card>

      <Card pad="lg">
        <p className="t-h2 mb-1">Payments to this group</p>
        <p className="t-meta mb-3">What each payment covered here.</p>
        {payments.length === 0 ? (
          <p className="text-sm text-ink-3 py-3">No payments recorded for this group yet.</p>
        ) : (
          <div className="space-y-2.5">
            {payments.map(p => {
              const here = p.items.reduce((s, i) => s + i.amount, 0)
              return (
                <div key={p.reference} className="rounded-md border border-line p-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <Money value={here} exact size="sm" />
                    <p className="text-xs text-ink-3">
                      {p.at ? format(new Date(p.at), 'd MMM yyyy, HH:mm') : ''}
                    </p>
                  </div>
                  <div className="space-y-1">
                    {p.items.map(i => (
                      <div key={i.due_date + i.amount} className="flex items-center justify-between gap-3 text-xs">
                        <span className="flex items-center gap-1.5 text-ink-2">
                          {i.kind === 'full'
                            ? <CheckCircle2 size={12} strokeWidth={2.4} className="text-success" aria-hidden="true" />
                            : <Clock size={12} strokeWidth={2.4} className="text-warning" aria-hidden="true" />}
                          {format(new Date(i.due_date), 'd MMM')}
                        </span>
                        <span className={cx('tnum font-medium', i.kind === 'full' ? 'text-ink' : 'text-warning')}>
                          GHS {ghs2(i.amount)}{i.kind === 'part' && ' (part)'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {here !== p.total && (
                    <p className="text-2xs text-ink-3 mt-2">
                      Part of a GHS {ghs2(p.total)} payment that also covered other groups.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <div className="pb-2">
        <Button variant="accent" size="lg" full onClick={() => setPaySheet(m)}
          disabled={m.coverage === 'no-schedule'}>
          {owes ? `Pay GHS ${ghs2(m.due_today)}` : 'Pay ahead on this group'}
        </Button>
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
