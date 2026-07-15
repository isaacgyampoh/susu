'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard, Contribution } from '@/types'
import { format, differenceInCalendarDays, isToday } from 'date-fns'
import RotationRing from '@/components/susu/rotation-ring'
import { useDeadline } from '@/components/susu/deadline'
import {
  Loader2, Zap, ArrowUpRight, AlertTriangle, Check,
  ChevronRight, Clock, Wallet, History
} from 'lucide-react'

const ghs = (n: any) =>
  Number(n ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function MemberDashboardPage() {
  const [data, setData]         = useState<MemberDashboard | null>(null)
  const [loading, setLoading]   = useState(true)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [activePlan, setActivePlan] = useState(0)

  async function load() {
    const token = getMemberToken()
    const { data } = await callFunction<MemberDashboard>('member-profile', { token: token! })
    setData(data)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function pay(c: Contribution) {
    const token = getMemberToken()
    setPayingId(c.id)
    const { data, error } = await callFunction<{ authorization_url?: string; dev_mode?: boolean }>(
      'payments-initialize', { method: 'POST', body: { contribution_id: c.id }, token: token! }
    )
    setPayingId(null)
    if (error) { alert(error); return }
    if (data?.dev_mode) { load(); return }
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  const plan     = data?.plans?.[activePlan]
  const group    = plan?.susu_groups
  const deadline = useDeadline(group?.payment_deadline?.slice(0, 5) ?? '18:00')

  if (loading) return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <Loader2 className="animate-spin text-forest" size={30} />
    </div>
  )
  if (!data) return (
    <div className="px-5 py-20 text-center">
      <p className="text-muted">Couldn't load your account. Pull down to retry.</p>
    </div>
  )

  const { member, plans, summary, pendingContributions, recentPayments, penalties } = data
  const firstName = member.full_name.split(' ')[0]
  const dueToday  = pendingContributions.find(c => isToday(new Date(c.due_date)))
  const daysToTurn = plan?.payout_date
    ? differenceInCalendarDays(new Date(plan.payout_date), new Date())
    : null

  // How far the rotation has travelled — turns already collected in this group
  const collected = plan?.payout_date && group?.start_date && group?.cycle_days
    ? Math.max(0, Math.floor(
        differenceInCalendarDays(new Date(), new Date(group.start_date)) / group.cycle_days
      ))
    : 0

  const cashout = (plan?.payout_amount ?? group?.cashout_amount ?? 0)
  const regBack = Number(group?.registration_fee ?? 0)

  return (
    <div className="px-5 pt-2 pb-28 max-w-lg mx-auto animate-fade-in">

      {/* ── Header ── */}
      <header className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-forest grid place-items-center">
            <span className="text-white font-bold text-sm">{firstName[0]}</span>
          </div>
          <div>
            <p className="text-[13px] text-muted leading-none">Hello, {firstName}</p>
            <p className="text-[11px] text-muted/70 font-mono mt-1">{member.member_id}</p>
          </div>
        </div>
        <Link href="/member/payments" className="w-10 h-10 rounded-full bg-white border border-hairline grid place-items-center">
          <History size={17} className="text-ink" />
        </Link>
      </header>

      {/* ── Hero: your turn ── */}
      {plan ? (
        <section className="pt-4 pb-7">
          <h1 className="display text-[42px]">
            Your turn is
            <br />
            <span className="text-forest">
              {daysToTurn === null ? 'not set yet'
                : daysToTurn <= 0   ? 'today'
                : `in ${daysToTurn} days`}
            </span>
          </h1>
          <p className="text-muted text-[15px] mt-3">
            {plan.payout_date
              ? `You collect on ${format(new Date(plan.payout_date), 'EEEE, d MMMM')}`
              : 'Your date is set when the group starts'}
          </p>
        </section>
      ) : (
        <section className="pt-4 pb-7">
          <h1 className="display text-[38px]">No active plan</h1>
          <p className="text-muted text-[15px] mt-3">Your admin will add you to a group shortly.</p>
        </section>
      )}

      {/* ── Alerts ── */}
      {(penalties.length > 0) && (
        <div className="sheet-flat border-red-200 bg-red-50/60 p-4 mb-4 flex items-start gap-3">
          <AlertTriangle size={17} className="text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-red-900 text-sm">GHS {ghs(summary.totalPenalties)} in penalties</p>
            <p className="text-red-700/80 text-[13px] mt-0.5">These are taken off your cashout. Message your admin to settle them.</p>
          </div>
        </div>
      )}

      {/* ── SIGNATURE: the rotation ── */}
      {plan && group && (
        <>
          {/* Plan switcher — only when it earns its place */}
          {plans.length > 1 && (
            <div className="seg mb-5">
              {plans.map((p, i) => (
                <button key={p.id} onClick={() => setActivePlan(i)}
                  className={`seg-item ${i === activePlan ? 'seg-item-on' : ''}`}>
                  {p.susu_groups?.name?.split(' ')[0] ?? `Plan ${i+1}`}
                </button>
              ))}
            </div>
          )}

          <section className="sheet p-7 mb-4">
            <div className="flex flex-col items-center">
              <RotationRing
                total={group.max_members}
                position={plan.payout_position}
                collected={collected}
                size={216}
              >
                <p className="text-[11px] font-semibold text-muted tracking-[0.14em] uppercase">You collect</p>
                <p className="display text-[30px] text-ink tnum mt-1.5">
                  <span className="text-[17px] font-bold align-top mr-0.5">GHS</span>
                  {ghs(Number(cashout) + regBack).split('.')[0]}
                </p>
                <p className="text-[12px] text-muted mt-1.5">
                  Slot {plan.payout_position} of {group.max_members}
                </p>
              </RotationRing>

              {/* Ring legend — decodes the signature */}
              <div className="flex items-center gap-4 mt-5 text-[11px] text-muted">
                <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-forest" />Collected</span>
                <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-gold" />You</span>
                <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-hairline" />Waiting</span>
              </div>

              {regBack > 0 && (
                <p className="text-[12px] text-muted mt-4 text-center">
                  GHS {ghs(cashout)} pot + GHS {ghs(regBack)} registration fee returned
                </p>
              )}
            </div>

            {/* Progress through the cycle */}
            <div className="mt-6 pt-6 border-t border-hairline">
              <div className="flex justify-between text-[13px] mb-2">
                <span className="text-muted">Contributions paid</span>
                <span className="font-semibold tnum">
                  {plan.balance?.contributions_paid ?? 0} of {plan.balance?.contributions_total ?? 0}
                </span>
              </div>
              <div className="h-2 bg-canvas rounded-full overflow-hidden">
                <div className="h-full bg-forest rounded-full transition-all duration-700"
                     style={{ width: `${Math.round(((plan.balance?.contributions_paid ?? 0) / Math.max(plan.balance?.contributions_total ?? 1, 1)) * 100)}%` }} />
              </div>
            </div>
          </section>
        </>
      )}

      {/* ── Today's payment ── */}
      {dueToday && (
        <section className="sheet p-5 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">Due today</p>
              <p className="display text-[28px] tnum mt-0.5">
                <span className="text-[15px] font-bold align-top mr-0.5">GHS</span>
                {ghs(dueToday.amount)}
              </p>
              <p className={`text-[12px] mt-1.5 font-medium ${deadline.urgent ? 'text-red-600' : 'text-muted'}`}>
                <Clock size={11} className="inline mr-1 -mt-0.5" />{deadline.label}
              </p>
            </div>
            <button onClick={() => pay(dueToday)} disabled={payingId === dueToday.id}
              className="pill-gold shrink-0">
              {payingId === dueToday.id ? <Loader2 size={16} className="animate-spin" /> : <>Pay now <ArrowUpRight size={16} /></>}
            </button>
          </div>
        </section>
      )}

      {/* ── Actions ── */}
      <div className="flex gap-3 mb-6">
        <Link href="/member/payments" className="pill-ink flex-1">
          <Zap size={16} /> Pay ahead
        </Link>
        <Link href="/member/payments" className="pill-quiet flex-1">
          <Wallet size={16} /> History
        </Link>
      </div>

      {/* ── Insight cards ── */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="sheet p-5">
          <div className="w-8 h-8 rounded-full bg-emerald-50 grid place-items-center mb-3">
            <Check size={15} className="text-emerald-600" />
          </div>
          <p className="display text-[22px] tnum">GHS {ghs(summary.totalPaidAll).split('.')[0]}</p>
          <p className="text-[12px] text-muted mt-0.5">Paid so far</p>
        </div>
        <div className="sheet p-5">
          <div className="w-8 h-8 rounded-full bg-amber-50 grid place-items-center mb-3">
            <Clock size={15} className="text-amber-600" />
          </div>
          <p className="display text-[22px] tnum">GHS {ghs(summary.totalPendingAll).split('.')[0]}</p>
          <p className="text-[12px] text-muted mt-0.5">Still to pay</p>
        </div>
      </div>

      {/* ── Recent ── */}
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="font-bold text-[15px]">Recent payments</h2>
          <Link href="/member/payments" className="text-[13px] text-muted font-medium flex items-center gap-0.5">
            See all <ChevronRight size={14} />
          </Link>
        </div>

        {recentPayments.filter(p => p.status === 'paid').length === 0 ? (
          <div className="sheet p-8 text-center">
            <p className="text-muted text-sm">Your payments will show up here</p>
          </div>
        ) : (
          <div className="sheet divide-y divide-hairline overflow-hidden">
            {recentPayments.filter(p => p.status === 'paid').slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center gap-3.5 p-4">
                <div className="w-9 h-9 rounded-full bg-emerald-50 grid place-items-center shrink-0">
                  <Check size={15} className="text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[14px] truncate">{c.susu_groups?.name}</p>
                  <p className="text-[12px] text-muted">
                    {c.paid_at ? format(new Date(c.paid_at), 'd MMM · HH:mm') : format(new Date(c.due_date), 'd MMM')}
                  </p>
                </div>
                <p className="font-bold text-[14px] tnum text-emerald-700 shrink-0">+{ghs(c.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
