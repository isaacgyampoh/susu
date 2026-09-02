'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CreditCard, Layers, FileText, RefreshCw, Users, Wallet } from 'lucide-react'
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
import { AppBar, AccountHero, QuickActions } from '@/components/susu/app-bar'

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
 *
 * ── THE COMPOSITION IS THE CHANGE ───────────────────────────────────────
 *
 * The data here was already right; the shape was a webpage. An avatar row, a
 * dark card, then a stack of cards inside a padded column — which reads as a
 * page of modules rather than as an account.
 *
 * It now opens the way a banking app opens: a dark band running to the top
 * edge of the device, carrying the greeting and ONE figure with the weight,
 * with today's numbers beneath a rule in support of it. Then a row of
 * destinations, then the groups. The band runs edge to edge and the status bar
 * sits inside it, which is most of what separates an application from a site.
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

  // Local to the greeting only. Nothing financial is derived in the browser.
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = member.full_name.split(' ')[0]

  return (
    <div className="animate-fade-in">

      <AppBar
        variant="hero"
        right={
          <span className="flex items-center gap-1">
            <IconButton
              icon={RefreshCw} label="Refresh" variant="ghost"
              onClick={() => load(true)}
              className={cx('text-white/70 hover:text-white hover:bg-white/10',
                            refreshing && 'pointer-events-none [&_svg]:animate-spin')}
            />
            <Link href="/m/portal/profile" aria-label="Your profile"
              className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
              <Avatar name={member.full_name} size="sm" />
            </Link>
          </span>
        }
      >
        <AccountHero
          greeting={greeting}
          name={firstName}
          label={totals.remaining_today > 0.005 ? 'Still to pay today' : 'Paid so far'}
          figure={
            <>
              <span className="text-lg font-medium opacity-55 mr-1.5">GHS</span>
              {totals.remaining_today > 0.005 ? ghs2(totals.remaining_today) : ghs2(totals.paid_all_time)}
            </>
          }
          note={
            totals.remaining_today > 0.005
              ? (totals.paid_today > 0.005
                  ? `GHS ${ghs2(totals.paid_today)} of GHS ${ghs2(totals.obligation_today)} already paid today`
                  : `Across ${totals.active_memberships} group${totals.active_memberships === 1 ? '' : 's'}`)
              : `Across ${totals.active_memberships} group${totals.active_memberships === 1 ? '' : 's'} since you joined`
          }
          stats={[
            { label: 'Groups',     value: String(totals.active_memberships) },
            { label: 'Still owed', value: `GHS ${ghs(totals.outstanding)}`,
              tone: totals.outstanding > 0.005 ? 'warn' : undefined },
            { label: 'In advance', value: `GHS ${ghs(totals.advance_credit)}`,
              tone: totals.advance_credit > 0.005 ? 'good' : undefined },
          ]}
        />
      </AppBar>

      <QuickActions actions={[
        { href: '/m/portal/payments',  label: 'Pay',       icon: CreditCard },
        { href: '/m/portal/groups',    label: 'Groups',    icon: Users },
        { href: '/m/portal/statement', label: 'Statement', icon: FileText },
        { href: '/m/portal/profile',   label: 'Profile',   icon: Wallet },
      ]} />

      <div className="portal-w pt-5 space-y-4">

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

      </div>

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


function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading your account">
      {/* Mirrors the real composition, so nothing jumps when data lands. */}
      <div className="bg-[#0C0E12] pt-[max(1.25rem,calc(env(safe-area-inset-top)+0.75rem))] pb-7">
        <div className="portal-w space-y-3">
          <Skeleton className="h-5 w-36 bg-white/10" />
          <Skeleton className="h-3 w-24 bg-white/10 !mt-7" />
          <Skeleton className="h-9 w-52 bg-white/10" />
          <div className="grid grid-cols-3 gap-4 !mt-7 pt-5 border-t border-white/10">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-8 bg-white/10" />)}
          </div>
        </div>
      </div>
      <div className="h-[64px] border-y border-line bg-surface" />
      <div className="portal-w pt-5 space-y-3">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  )
}
