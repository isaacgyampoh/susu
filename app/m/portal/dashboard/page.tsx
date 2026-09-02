'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CreditCard, Layers, FileText, RefreshCw, Users, Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MembershipView, PortalState } from '@/types/portal'
import { ghs, ghs2 } from '@/lib/money'
import GroupList from '@/components/susu/group-list'
import PaySheet from '@/components/susu/pay-sheet'
import PayPrompt from '@/components/susu/pay-prompt'
import {
  Avatar, Button, Card, EmptyState, IconButton, Money, Skeleton,
  useToast, cx,
} from '@/components/ui'
import { AppBar, AccountHero } from '@/components/susu/app-bar'

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
  const [pending, setPending] = useState<any>(null)
  const [paySheet, setPaySheet] = useState<MembershipView | null>(null)

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

  // Local to the greeting only. Nothing financial is derived in the browser.
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = member.full_name.split(' ')[0]

  // Groups with something still owing TODAY. Ordered by the largest first, so
  // the biggest obligation is the one under the member's thumb.
  const dueToday = memberships
    .filter(m => m.due_today > 0.005)
    .sort((a, b) => b.due_today - a.due_today)

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

      {/*
        WHAT YOU OWE TODAY, FIRST.

        This is the reason a member opens the app: not their lifetime total, not
        their overdue history — what has to be paid before the day is out. It
        sits directly under the headline figure and above everything else,
        because anything above it is something they have to scroll past to do
        the one thing they came for.

        One row per group that is due, each opening the pay sheet for THAT
        membership. Amounts are per-membership and never pooled: a member owing
        in three groups owes three separate things, and paying one does not
        touch the others.
      */}
      {dueToday.length > 0 ? (
        <div className="portal-w -mt-5 relative z-10">
          <section aria-labelledby="due" className="rounded-xl border border-line bg-surface shadow-sm">
            {/* The headline above already states today's total; repeating it
                here would just be the same number twice. This says how the
                total breaks down instead. */}
            <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2">
              <h2 id="due" className="t-eyebrow">Due today</h2>
              <span className="text-xs text-ink-3 tnum">
                {dueToday.length} group{dueToday.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="divide-y divide-line-2">
              {dueToday.map(m => (
                <button
                  key={m.membership_id}
                  type="button"
                  onClick={() => setPaySheet(m)}
                  className="w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left
                             transition-colors hover:bg-surface-2 active:bg-surface-3
                             focus-visible:outline-none focus-visible:ring-2
                             focus-visible:ring-inset focus-visible:ring-ink/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-medium text-ink truncate">{m.group_name}</p>
                    <p className="text-xs text-ink-2 mt-0.5 tnum">
                      Slot {m.payout_position}
                      {m.paid_today > 0.005 &&
                        ` · GHS ${ghs2(m.paid_today)} of GHS ${ghs2(m.due_today + m.paid_today)} paid`}
                    </p>
                  </div>
                  <span className="text-base font-semibold text-ink tnum shrink-0">
                    GHS {ghs2(m.due_today)}
                  </span>
                  <span aria-hidden="true"
                    className="shrink-0 text-xs font-medium text-inverse bg-ink rounded-lg px-3 py-1.5">
                    Pay
                  </span>
                </button>
              ))}
            </div>
            {/* Tapping a group lets a member pay MORE than today's amount; the
                sheet shows which future days that would cover before they
                approve anything. */}
            <p className="px-4 pb-3.5 pt-2.5 text-xs text-ink-3 leading-relaxed">
              Tap a group to pay. You can pay more than today&rsquo;s amount and
              see exactly which days it covers before you confirm.
            </p>
          </section>
        </div>
      ) : (
        <div className="portal-w -mt-5 relative z-10">
          <Link
            href="/m/portal/payments"
            className="flex items-center justify-between gap-3 h-[54px] px-4
                       rounded-xl bg-ink text-inverse shadow-sm
                       transition-transform active:scale-[.995]
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40
                       focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <span className="flex items-center gap-2.5">
              <CreditCard size={18} strokeWidth={1.9} aria-hidden="true" />
              <span className="text-base font-medium">Nothing due today — pay ahead</span>
            </span>
            <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" className="opacity-70" />
          </Link>
        </div>
      )}

      <div className="portal-w pt-5 space-y-4">

      {/*
        One "Attention" section, not three tinted boxes stacked down the screen.
        Three full-width coloured blocks were most of the colour on this page and
        pushed the groups — the reason the member opened the app — below the
        fold. Each line is a fact with its figure; tone is carried by the number
        and a marker, which is enough to separate owed from in-credit.
      */}
      {(totals.overdue > 0.005 || penalties.length > 0 || totals.advance_credit > 0.005) && (
        <section aria-labelledby="attn">
          <h2 id="attn" className="t-eyebrow mb-2">Attention</h2>
          <div className="border border-line rounded-xl bg-surface divide-y divide-line-2">
            {totals.overdue > 0.005 && (
              <StatusLine
                tone="bad"
                amount={`GHS ${ghs2(totals.overdue)}`}
                label="overdue"
                detail={`Across ${memberships.filter(m => m.overdue > 0.005).length} group${
                  memberships.filter(m => m.overdue > 0.005).length === 1 ? '' : 's'}. Anything still owing on a collection date is deducted from what you receive.`}
              />
            )}
            {penalties.length > 0 && (
              <StatusLine
                tone="warn"
                amount={`GHS ${ghs2(penalties.reduce((t, x) => t + Number(x.amount), 0))}`}
                label="late payment penalties"
                detail="Charged on contributions settled after their due date."
              />
            )}
            {totals.advance_credit > 0.005 && (
              <StatusLine
                tone="good"
                amount={`GHS ${ghs2(totals.advance_credit)}`}
                label="paid in advance"
                detail="Held against specific groups. Credit in one group is only ever spent on that group's contributions."
              />
            )}
          </div>
        </section>
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
        <section aria-labelledby="grps">
          {/*
            One list, grouped by group — not a card per slot. A member holding
            33 slots got 33 cards, each with a progress bar and four stat
            quadrants: roughly fifteen screens of scrolling in which the thing
            they came for is buried in repetition. Tapping a slot opens its own
            full screen, which is where the detail belongs.
          */}
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h2 id="grps" className="t-eyebrow">Your groups</h2>
            <span className="text-xs text-ink-3 tnum">
              {memberships.length} slot{memberships.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="border border-line rounded-xl bg-surface px-[1.125rem] md:px-7">
            <GroupList memberships={memberships} />
          </div>
        </section>
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
          onBusy={() => {}}
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


/** One fact: a marker, the figure, what it is, and why it matters. */
function StatusLine({
  tone, amount, label, detail,
}: { tone: 'bad' | 'warn' | 'good'; amount: string; label: string; detail: string }) {
  return (
    <div className="flex gap-3 p-4">
      <span aria-hidden="true" className={cx(
        'mt-[7px] w-1.5 h-1.5 rounded-full shrink-0',
        tone === 'bad' ? 'bg-danger' : tone === 'warn' ? 'bg-warning' : 'bg-success',
      )} />
      <div className="min-w-0">
        <p className="text-base text-ink">
          <span className={cx('font-semibold tnum',
            tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-success')}>
            {amount}
          </span>{' '}{label}
        </p>
        <p className="text-xs text-ink-2 mt-1 leading-relaxed">{detail}</p>
      </div>
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
      <div className="portal-w -mt-5 relative z-10"><Skeleton className="h-[54px] rounded-xl" /></div>
      <div className="portal-w pt-5 space-y-3">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  )
}
