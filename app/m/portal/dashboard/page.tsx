'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Layers, RefreshCw, Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MembershipView, PortalState } from '@/types/portal'
import { ghs, ghs2 } from '@/lib/money'
import MembershipCard from '@/components/susu/membership-card'
import PayPrompt from '@/components/susu/pay-prompt'
import PaySheet from '@/components/susu/pay-sheet'
import {
  Avatar, Button, Card, EmptyState, IconButton, Money, Notice, Skeleton,
  useToast, cx,
} from '@/components/ui'

/**
 * The member dashboard.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Rebuilt in Phase 04 around the fact that a member belongs to MANY groups.
 * Two thirds of this platform's members hold more than one membership; one
 * holds thirty across eighteen groups.
 *
 * The previous version rendered `plans[tab]` — one membership at a time behind
 * a chip selector — so a member in five groups saw one group's figures and had
 * to remember to check the rest. Every membership is now on screen, each with
 * its own obligation, advance and cash-out.
 *
 * This component performs NO financial arithmetic. Every figure, including the
 * cross-membership totals, is computed by get_member_portal_state() in the
 * database. The old dashboard summed money in a React `reduce`, which is how
 * the same number came to be calculated in four different places.
 */
export default function Dashboard() {
  const toast = useToast()
  const [state, setState] = useState<PortalState | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [paySheet, setPaySheet] = useState<MembershipView | null>(null)
  const [paying, setPaying] = useState<string | null>(null)
  const [pending, setPending] = useState<any>(null)

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    const { data, error } = await callFunction<PortalState>('member-profile', { token: getMemberToken()! })
    if (error) {
      setFailed(error)
      if (quiet) toast.error({ title: 'Could not refresh', body: error })
    } else {
      setState(data); setFailed('')
    }
    setLoading(false); setRefreshing(false)
  }, [toast])

  useEffect(() => { load() }, [load])

  if (loading) return <DashboardSkeleton />

  if (!state || failed) return (
    <div className="portal-w pt-10">
      <EmptyState
        icon={Wallet}
        title="Could not load your account"
        body={failed || 'Check your connection and try again. Nothing here changes what has already been recorded.'}
        action={<Button icon={RefreshCw} onClick={() => { setLoading(true); load() }}>Try again</Button>}
      />
    </div>
  )

  const { member, memberships, totals, payments, penalties } = state
  const owing = memberships.filter(m => m.due_today > 0.005)
  const settled = memberships.filter(m => m.due_today <= 0.005 && m.coverage !== 'no-schedule')

  return (
    <div className="portal-w pt-6 space-y-4 animate-fade-in">

      <header className="flex items-center gap-3">
        <Avatar name={member.full_name} size="lg" tone="ink" />
        <div className="min-w-0 flex-1">
          <p className="text-md font-semibold text-ink truncate">{member.full_name}</p>
          <p className="text-xs text-ink-3 font-mono">{member.member_code}</p>
        </div>
        <IconButton
          icon={RefreshCw} label="Refresh" variant="ghost"
          onClick={() => load(true)}
          className={cx(refreshing && 'pointer-events-none [&_svg]:animate-spin')}
        />
      </header>

      {/*
        Today, in three figures rather than one.
        A member holding several groups needs to see what today asks of them,
        what they have already put in, and what is left — "due today" alone is
        the third of those, and cannot be used to work out the other two.
        All three come from `get_member_portal_state()`; nothing here adds up
        rows in the browser.
      */}
      <Card tone="ink" pad="lg">
        <p className="text-xs font-medium text-inverse/60">
          {totals.remaining_today > 0.005 ? 'Still to pay today' : 'Today, across all your groups'}
        </p>
        <Money value={totals.remaining_today} exact size="xl" className="text-inverse mt-1.5" />

        {totals.paid_today > 0.005 && (
          <p className="text-xs text-inverse/70 mt-1.5 tnum">
            GHS {ghs2(totals.paid_today)} of GHS {ghs2(totals.obligation_today)} already paid today
          </p>
        )}

        <dl className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-inverse/15">
          <Stat label="Groups" value={String(totals.active_memberships)} />
          <Stat label="Paid so far" value={`GHS ${ghs(totals.paid_all_time)}`} />
          <Stat label="Still to pay" value={`GHS ${ghs(totals.outstanding)}`} />
        </dl>
      </Card>

      {totals.overdue > 0.005 && (
        <Notice tone="bad" title={`GHS ${ghs2(totals.overdue)} overdue`}>
          Across {memberships.filter(m => m.overdue > 0.005).length} group
          {memberships.filter(m => m.overdue > 0.005).length === 1 ? '' : 's'}. Anything still
          owing on a collection date is deducted from what you receive.
        </Notice>
      )}

      {penalties.length > 0 && (
        <Notice tone="warn" title="Late payment penalties">
          GHS {ghs2(penalties.reduce((s, p) => s + Number(p.amount), 0))} outstanding.
        </Notice>
      )}

      {totals.advance_credit > 0.005 && (
        <Notice tone="good" title={`GHS ${ghs2(totals.advance_credit)} advance credit`}>
          Held against specific groups. Credit in one group is only ever used for
          that group&rsquo;s contributions.
        </Notice>
      )}

      {memberships.length === 0 ? (
        <Card pad="none">
          <EmptyState
            icon={Layers}
            title="No groups yet"
            body="Your collector will add you to a group. Once they do, everything you owe and collect appears here."
            compact
          />
        </Card>
      ) : (
        <>
          {owing.length > 0 && (
            <section>
              <h2 className="t-eyebrow mb-2">
                Needs paying today · {owing.length} of {memberships.length}
              </h2>
              <div className="space-y-3">
                {owing.map(m => (
                  <MembershipCard key={m.membership_id} m={m}
                    onPay={setPaySheet} paying={paying === m.membership_id} />
                ))}
              </div>
            </section>
          )}

          {settled.length > 0 && (
            <section>
              <h2 className="t-eyebrow mb-2 mt-5">
                {owing.length > 0 ? 'Nothing owing today' : 'Your groups'} · {settled.length}
              </h2>
              <div className="space-y-3">
                {settled.map(m => (
                  <MembershipCard key={m.membership_id} m={m}
                    onPay={setPaySheet} paying={paying === m.membership_id} />
                ))}
              </div>
            </section>
          )}

          {memberships.filter(m => m.coverage === 'no-schedule').length > 0 && (
            <section>
              <h2 className="t-eyebrow mb-2 mt-5">Not started yet</h2>
              <div className="space-y-3">
                {memberships.filter(m => m.coverage === 'no-schedule').map(m => (
                  <MembershipCard key={m.membership_id} m={m}
                    onPay={setPaySheet} paying={paying === m.membership_id} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Recent payments, each showing what it actually covered — a single
          MoMo debit can settle several days across several groups. */}
      {payments.length > 0 && (
        <Card pad="lg">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="t-h2">Recent payments</p>
            <Link href="/m/portal/payments"
              className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-2 hover:text-ink transition-colors">
              See all <ArrowRight size={13} strokeWidth={2.4} aria-hidden="true" />
            </Link>
          </div>
          <div className="space-y-2.5">
            {payments.slice(0, 4).map(p => {
              const byGroup = new Map<string, { amount: number; days: number }>()
              for (const it of p.items) {
                const g = byGroup.get(it.group) ?? { amount: 0, days: 0 }
                g.amount += it.amount; g.days += 1
                byGroup.set(it.group, g)
              }
              return (
                <div key={p.reference} className="rounded-md border border-line p-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <Money value={p.total} exact size="sm" />
                    <p className="text-xs text-ink-3">
                      {p.at ? format(new Date(p.at), 'd MMM, HH:mm') : ''}
                    </p>
                  </div>
                  <div className="space-y-1">
                    {Array.from(byGroup.entries()).map(([g, v]) => (
                      <div key={g} className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-ink-2 truncate">{g}</span>
                        <span className="text-ink font-medium tnum shrink-0">
                          GHS {ghs2(v.amount)} · {v.days} day{v.days === 1 ? '' : 's'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {paySheet && (
        <PaySheet
          membership={paySheet}
          defaultNumber={member.mobile_money_number ?? member.phone}
          defaultNetwork={member.mobile_money_provider ?? 'MTN'}
          hasOtherMemberships={memberships.length > 1}
          onClose={() => setPaySheet(null)}
          onPrompted={p => { setPaySheet(null); setPending(p) }}
          onBusy={setPaying}
        />
      )}

      {pending && (
        <PayPrompt
          reference={pending.reference}
          amount={Number(pending.amount ?? 0)}
          phone={member.mobile_money_number ?? member.phone}
          initial={pending.status}
          message={pending.message}
          ussd={pending.ussd}
          onDone={() => { setPending(null); load(true) }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-inverse/55 font-medium">{label}</dt>
      <dd className="text-sm font-semibold text-inverse mt-1 tnum truncate">{value}</dd>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="portal-w pt-6 space-y-4" role="status" aria-label="Loading your account">
      <div className="flex items-center gap-3">
        <Skeleton className="w-11 h-11 rounded-lg" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      </div>
      <Skeleton className="h-40 rounded-lg" />
      <Skeleton className="h-64 rounded-lg" />
      <Skeleton className="h-64 rounded-lg" />
    </div>
  )
}
