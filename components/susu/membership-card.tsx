'use client'
import Link from 'next/link'
import { CalendarClock, CheckCircle2, Clock, AlertTriangle, Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { ghs, ghs2 } from '@/lib/money'
import type { Coverage, MembershipView } from '@/types/portal'
import { Badge, Button, Card, Money, Progress, cx, type Tone } from '@/components/ui'

/**
 * One membership, rendered in full.
 *
 * The portal shows a card per membership rather than one group behind a
 * selector. A member holding five groups has five of these on screen at once,
 * each with its own obligation, its own advance, and its own cash-out — which
 * is the whole point: the memberships are financially independent and the
 * screen has to make that obvious.
 *
 * Every figure here is rendered, never computed. The database decided what is
 * owed, what is covered and what remains; this component's only job is to say
 * it clearly.
 */

const COVERAGE: Record<Coverage, { label: string; tone: Tone; icon: typeof CheckCircle2 }> = {
  'paid':              { label: 'Paid',              tone: 'good',    icon: CheckCircle2 },
  'paid-today':        { label: 'Paid today',        tone: 'good',    icon: CheckCircle2 },
  'paid-in-advance':   { label: 'Paid in advance',   tone: 'good',    icon: CalendarClock },
  'partially-covered': { label: 'Part paid',         tone: 'warn',    icon: Clock },
  'due-today':         { label: 'Due today',         tone: 'warn',    icon: Clock },
  'overdue':           { label: 'Overdue',           tone: 'bad',     icon: AlertTriangle },
  'upcoming':          { label: 'Upcoming',          tone: 'neutral', icon: CalendarClock },
  'no-schedule':       { label: 'Not started',       tone: 'off',     icon: CalendarClock },
}

export default function MembershipCard({
  m, onPay, paying,
}: {
  m: MembershipView
  onPay: (m: MembershipView) => void
  paying: boolean
}) {
  const cov = COVERAGE[m.coverage] ?? COVERAGE['upcoming']
  const Icon = cov.icon
  const owes = m.due_today > 0.005
  const pct = m.total_expected > 0 ? (m.total_paid / m.total_expected) * 100 : 0

  return (
    <Card pad="none" className="overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-md font-semibold text-ink truncate">{m.group_name}</p>
            <p className="text-xs text-ink-3 mt-0.5 tnum">
              GHS {ghs(m.contribution_amount)} {m.frequency}
              {m.slot_fraction < 1 && ` · ${m.slot_fraction === 0.25 ? '¼' : '½'} slot`}
              {' · '}Slot {m.payout_position}
            </p>
          </div>
          <Badge tone={cov.tone} className="shrink-0">
            <Icon size={11} strokeWidth={2.6} aria-hidden="true" />
            {cov.label}
          </Badge>
        </div>

        {/* The four numbers a member actually needs, per group. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-4">
          <Figure label="Due today" value={m.due_today} emphasis={owes} />
          <Figure label="Paid today" value={m.paid_today} />
          <Figure label="Paid so far" value={m.total_paid} />
          <Figure label="Still to pay" value={m.total_outstanding} />
        </dl>

        {m.total_expected > 0 && (
          <>
            <Progress value={pct} tone={m.overdue > 0.005 ? 'warning' : 'accent'}
              className="mt-4" label={`${m.group_name} progress`} />
            <p className="text-2xs text-ink-3 mt-1.5 tnum">
              {m.obligations_settled} of {m.obligations} days paid
            </p>
          </>
        )}
      </div>

      {/* Advance and arrears — only shown when they exist, so the card stays
          quiet for a member who is simply up to date. */}
      {(m.days_covered_ahead > 0 || m.advance_credit > 0.005 || m.overdue > 0.005) && (
        <div className="px-4 py-3 border-t border-line-2 bg-surface-2 space-y-1.5">
          {m.days_covered_ahead > 0 && (
            <Line tone="good">
              <strong>{m.days_covered_ahead} day{m.days_covered_ahead === 1 ? '' : 's'} paid ahead.</strong>
              {' '}You are covered through {m.next_obligation
                ? format(new Date(m.next_obligation.due_date), 'd MMM')
                : 'your next contribution'}.
            </Line>
          )}
          {m.advance_credit > 0.005 && (
            <Line tone="good">
              <strong>GHS {ghs2(m.advance_credit)} credit</strong> on this group. It goes
              towards your next contribution here — not to any other group.
            </Line>
          )}
          {m.overdue > 0.005 && (
            <Line tone="bad">
              <strong>GHS {ghs2(m.overdue)} overdue.</strong> This is deducted from your
              collection if it is still owing on your payout date.
            </Line>
          )}
        </div>
      )}

      {/* The next obligation, stated exactly — including a part-paid one, which
          must never read as "paid". */}
      {m.next_obligation && (
        <div className="px-4 py-3 border-t border-line-2">
          <p className="t-eyebrow">Next contribution</p>
          <div className="flex items-baseline justify-between gap-3 mt-1">
            <p className="text-sm text-ink">
              {format(new Date(m.next_obligation.due_date), 'EEEE d MMM')}
            </p>
            <p className="text-sm font-semibold text-ink tnum">
              GHS {ghs2(m.next_obligation.remaining)}
            </p>
          </div>
          {m.next_obligation.amount_paid > 0.005 && m.next_obligation.remaining > 0.005 && (
            <p className="text-xs text-warning mt-1.5 leading-relaxed">
              You have paid GHS {ghs2(m.next_obligation.amount_paid)} of
              GHS {ghs2(m.next_obligation.amount)} toward this day.
              GHS {ghs2(m.next_obligation.remaining)} remains to complete it.
            </p>
          )}
        </div>
      )}

      {/* Cash-out. Never invented — an unset date says so. */}
      <div className="px-4 py-3 border-t border-line-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="t-eyebrow">You collect</p>
          {m.payout_amount != null ? (
            <Money value={m.payout_amount} size="sm" className="mt-0.5" />
          ) : (
            <p className="text-sm text-ink-3 mt-0.5">Not set</p>
          )}
        </div>
        <div className="text-right min-w-0">
          <p className="t-eyebrow">Collection date</p>
          {m.payout_date ? (
            <p className="text-sm font-medium text-ink mt-0.5">
              {format(new Date(m.payout_date), 'd MMM yyyy')}
            </p>
          ) : (
            <p className="text-xs text-warning mt-0.5">
              Not set — ask your collector
            </p>
          )}
        </div>
      </div>

      <div className="p-3 border-t border-line grid grid-cols-2 gap-2">
        <Link href={`/m/portal/membership/${m.membership_id}`} className="btn-line btn-sm">
          View group
        </Link>
        <Button
          variant={owes ? 'accent' : 'outline'} size="sm"
          loading={paying}
          onClick={() => onPay(m)}
          disabled={m.coverage === 'no-schedule'}
          icon={owes ? undefined : Wallet}
        >
          {owes ? `Pay ${ghs2(m.due_today)}` : 'Pay ahead'}
        </Button>
      </div>
    </Card>
  )
}

function Figure({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="t-eyebrow">{label}</dt>
      <dd className={cx(
        'mt-0.5 tnum font-semibold',
        emphasis ? 'text-base text-ink' : 'text-sm text-ink-2',
      )}>
        GHS {ghs2(value)}
      </dd>
    </div>
  )
}

function Line({ tone, children }: { tone: 'good' | 'bad'; children: React.ReactNode }) {
  return (
    <p className={cx('text-xs leading-relaxed', tone === 'good' ? 'text-ink-2' : 'text-danger')}>
      {children}
    </p>
  )
}
