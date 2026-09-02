'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { CheckCircle2, ChevronRight, Receipt, Wallet } from 'lucide-react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MembershipView, PortalState } from '@/types/portal'
import PayPrompt from '@/components/susu/pay-prompt'
import PaySheet from '@/components/susu/pay-sheet'
import MembershipCard from '@/components/susu/membership-card'
import { ghs2 } from '@/lib/money'
import {
  Badge, Card, EmptyState, LoadingBlock, Money, Notice, Segmented, useToast,
} from '@/components/ui'
import { AppBar } from '@/components/susu/app-bar'

/**
 * Payments — every group, not whichever one happened to fit on a page.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS REPLACES
 *
 * This screen used to load `contributions-list?page=1`: twenty contribution
 * rows, ordered by `due_date DESC`. A member's groups do not take turns in that
 * ordering — whichever group has the furthest-future due dates fills all twenty
 * slots, and every other group vanishes.
 *
 * Measured on the real member holding eighteen groups and 2,421 obligations:
 * page one contained ONE group. They could see one group and pay into one
 * group. It looked like a hard-coded filter and was in fact pagination.
 *
 * The screen is now membership-first. `get_member_portal_state()` returns every
 * active membership with its full financial position in ONE round trip — 30
 * memberships in 18ms — so there is no page to fall off the end of.
 *
 * WHAT THIS SCREEN DOES NOT DO
 *
 * It computes no money. Every figure is rendered from the portal state, which
 * the database produced. The payment itself goes through `PaySheet`, which
 * previews against `preview_settlement()` and pays against the membership — so
 * the group being paid is chosen server-side from a membership the caller is
 * proven to own, never from anything this page holds.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Filter = 'all' | 'owing' | 'covered'

export default function Payments() {
  const toast = useToast()
  const [state, setState]   = useState<PortalState | null>(null)
  const [loading, setL]     = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [paying, setPaying] = useState<string | null>(null)
  const [paySheet, setPaySheet] = useState<MembershipView | null>(null)
  const [pending, setPending]   = useState<any>(null)

  const load = useCallback(async () => {
    const { data, error } = await callFunction<PortalState>('member-profile', { token: getMemberToken()! })
    if (error) toast.error({ title: 'Could not load your payments', body: error })
    else setState(data)
    setL(false)
  }, [toast])

  useEffect(() => { load() }, [load])

  const memberships = useMemo(() => state?.memberships ?? [], [state])
  const shown = useMemo(() => {
    if (filter === 'owing')   return memberships.filter(m => m.due_today > 0.005 || m.overdue > 0.005)
    if (filter === 'covered') return memberships.filter(m => m.due_today <= 0.005 && m.overdue <= 0.005)
    return memberships
  }, [memberships, filter])

  if (loading) return <LoadingBlock label="Loading your groups" className="h-[60vh]" />
  if (!state) return (
    <div className="portal-w pt-10">
      <Notice tone="warn" title="We could not load your payments">
        Check your connection and try again.
      </Notice>
    </div>
  )

  const { member, totals, payments } = state
  const owing = memberships.filter(m => m.due_today > 0.005 || m.overdue > 0.005).length

  return (
    <div className="animate-fade-in">
      <AppBar title="Payments" />
      <div className="portal-w pt-5 space-y-4">
      <header>
        <span className="sr-only">Payments</span>
        <p className="text-sm text-ink-2 mt-1">
          {memberships.length === 1
            ? 'Your group, what it needs, and what you have paid.'
            : `All ${memberships.length} of your groups. Each one is paid separately.`}
        </p>
      </header>

      {/* Today across every group — the three figures separately, because one
          cannot be worked out from the others. All from the database. */}
      <Card tone="ink" pad="lg">
        <p className="text-xs font-medium text-inverse/60">
          {totals.remaining_today > 0.005 ? 'Still to pay today' : 'Nothing due today'}
        </p>
        <Money value={totals.remaining_today} exact size="xl" className="text-inverse mt-1.5" />
        {totals.paid_today > 0.005 && (
          <p className="text-xs text-inverse/70 mt-1.5 tnum">
            GHS {ghs2(totals.paid_today)} of GHS {ghs2(totals.obligation_today)} already paid today
          </p>
        )}
        <p className="text-2xs text-inverse/50 mt-3 pt-3 border-t border-inverse/15">
          {owing === 0
            ? 'Every group is up to date.'
            : `${owing} of ${memberships.length} ${owing === 1 ? 'group needs' : 'groups need'} a payment.`}
        </p>
      </Card>

      {memberships.length > 1 && (
        <Segmented
          ariaLabel="Filter groups"
          value={filter} onChange={setFilter}
          items={[
            { value: 'all',     label: `All · ${memberships.length}` },
            { value: 'owing',   label: `Needs paying · ${owing}` },
            { value: 'covered', label: `Up to date · ${memberships.length - owing}` },
          ]}
        />
      )}

      {/* ── My groups ─────────────────────────────────────────────────── */}
      {shown.length === 0 ? (
        <Card pad="none">
          <EmptyState
            icon={filter === 'owing' ? CheckCircle2 : Wallet}
            title={filter === 'owing' ? 'Nothing owing' : filter === 'covered' ? 'Nothing settled yet' : 'No groups yet'}
            body={filter === 'all'
              ? 'When you are approved into a group it will appear here.'
              : undefined}
            compact
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {shown.map(m => (
            <MembershipCard
              key={m.membership_id} m={m}
              onPay={setPaySheet}
              paying={paying === m.membership_id}
            />
          ))}
        </div>
      )}

      {/* ── Payment history ───────────────────────────────────────────── */}
      <section className="pt-2">
        <h2 className="t-eyebrow mb-2">Payment history</h2>
        {payments.length === 0 ? (
          <Card pad="none">
            <EmptyState icon={Receipt} title="No payments yet"
              body="Your payments will appear here, showing exactly which days each one covered." compact />
          </Card>
        ) : (
          /*
            Compact rows that open a full screen, not cards that unfold every
            allocation in place. A payment covering fifteen days made a card
            fifteen lines tall, so scanning "what have I paid recently" meant
            scrolling past detail nobody asked for yet. The row answers how much
            and when; the detail screen answers what it paid for.
          */
          <div className="border border-line rounded-xl bg-surface divide-y divide-line-2
                          px-[1.125rem] md:px-7">
            {payments.map(p => {
              const groups = [...new Set(p.items.map(i => i.group))]
              return (
                <Link
                  key={p.reference}
                  href={`/m/portal/payments/${encodeURIComponent(p.reference)}`}
                  className="flex items-center gap-3 py-3.5 min-h-[56px] transition-colors
                             hover:bg-surface-2 active:bg-surface-3
                             -mx-[1.125rem] px-[1.125rem] md:-mx-7 md:px-7
                             focus-visible:outline-none focus-visible:ring-2
                             focus-visible:ring-inset focus-visible:ring-ink/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-ink tnum">GHS {ghs2(p.total)}</p>
                    <p className="text-xs text-ink-2 mt-0.5 truncate">
                      {p.items.length} day{p.items.length === 1 ? '' : 's'}
                      {groups.length === 1
                        ? ` · ${groups[0]}`
                        : groups.length > 1 ? ` · ${groups.length} groups` : ''}
                    </p>
                    <p className="text-xs text-ink-3 mt-0.5 tnum">
                      {format(new Date(p.at), 'd MMM yyyy · HH:mm')}
                    </p>
                  </div>
                  <ChevronRight size={15} strokeWidth={2} aria-hidden="true"
                    className="text-ink-3 shrink-0" />
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Paying is membership-scoped: the sheet is opened FOR one membership,
          and the server re-checks ownership before it creates anything. */}
      {paySheet && (
        <PaySheet
          membership={paySheet}
          defaultNumber={member.mobile_money_number}
          defaultNetwork={member.mobile_money_provider}
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
          onDone={() => { setPending(null); load() }}
          onClose={() => setPending(null)}
        />
      )}
      </div>
    </div>
  )
}
