'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard, Contribution } from '@/types'
import { format, differenceInCalendarDays, isToday } from 'date-fns'
import StampCard from '@/components/susu/stamp-card'
import Rotation from '@/components/susu/rotation'
import { useDeadline } from '@/components/susu/deadline'
import { ghs as n0 } from '@/lib/money'
import PayPrompt from '@/components/susu/pay-prompt'
const n2 = (v: any) => Number(v ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Dashboard() {
  const [d, setD]       = useState<MemberDashboard | null>(null)
  const [loading, setL] = useState(true)
  const [paying, setP]  = useState<string | null>(null)
  const [pending, setPending] = useState<any>(null)
  const [tab, setTab]   = useState(0)

  async function load() {
    const { data } = await callFunction<MemberDashboard>('member-profile', { token: getMemberToken()! })
    setD(data); setL(false)
  }
  useEffect(() => { load() }, [])

  async function pay(c: Contribution) {
    setP(c.id)
    const { data, error } = await callFunction<any>('payments-initialize',
      { method: 'POST', body: { contribution_id: c.id }, token: getMemberToken()! })
    setP(null)
    if (error) return alert(error)
    if (data?.dev_mode) return load()
    // Moolre: the member approves on their phone, so wait here rather than leave
    if (data?.status === 'prompted' || data?.status === 'otp_required') {
      setPending({ ...data, amount: data.amount ?? c.amount }); return
    }
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  const plan  = d?.plans?.[tab]
  const group = plan?.susu_groups
  const dl    = useDeadline(group?.payment_deadline?.slice(0, 5) ?? '18:00')

  if (loading) return <div className="grid place-items-center h-[70vh]">Loading…</div>
  if (!d)      return <div className="p-10 text-center t-meta">Could not load your account.</div>

  const { member, plans, summary, pendingContributions, recentPayments, penalties } = d
  const dueToday = pendingContributions.find(c => isToday(new Date(c.due_date)))

  const mine = recentPayments
    .filter(c => c.susu_groups?.id === group?.id)
    .concat(pendingContributions.filter(c => (c.susu_groups as any)?.id === group?.id))
    .filter((c, i, a) => a.findIndex(x => x.id === c.id) === i)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))

  const collected = group?.start_date && group?.cycle_days
    ? Math.max(0, Math.floor(differenceInCalendarDays(new Date(), new Date(group.start_date)) / group.cycle_days))
    : 0
  // The registration fee is the operator's commission — never part of what a member collects.
  const cashout = Number(plan?.payout_amount ?? group?.cashout_amount ?? 0)
  const toTurn  = plan?.payout_date ? differenceInCalendarDays(new Date(plan.payout_date), new Date()) : null

  return (
    <div className="max-w-[420px] mx-auto px-5 pt-6 animate-fade-in">

      <header className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-full bg-ink grid place-items-center shrink-0">
          <span className="text-white font-bold text-[15px]">{member.full_name[0]}</span>
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-bold truncate">{member.full_name}</p>
          <p className="t-meta">{member.member_id}</p>
        </div>
      </header>

      {penalties.length > 0 && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red/20 rounded-[12px] p-3.5 mb-4">
          <p className="text-[12.5px] text-red">
            <span className="font-bold">GHS {n2(summary.totalPenalties)} in penalties.</span> This will be deducted from your collection.
          </p>
        </div>
      )}

      {plans.length > 1 && (
        <div className="seg mb-4">
          {plans.map((p, i) => (
            <button key={p.id} onClick={() => setTab(i)} className={`seg-item ${i === tab ? 'seg-on' : ''}`}>
              {p.susu_groups?.name}
            </button>
          ))}
        </div>
      )}

      {plan && group ? (
        <>
          {/* Collection card — the hero */}
          <div className="panel p-5 bg-ink border-ink mb-3">
            <p className="text-[12px] font-semibold text-white/60">You collect</p>
            <p className="text-[34px] font-extrabold tracking-[-.03em] text-white leading-none mt-1.5 tnum">
              <span className="text-[16px] align-[.4em] mr-1 text-white">GHS</span>{n0(cashout)}
            </p>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/15">
              <div>
                <p className="text-[11px] text-white/60 font-medium">Your date</p>
                <p className="text-[14px] font-bold text-white mt-0.5">
                  {plan.payout_date ? format(new Date(plan.payout_date), 'd MMM yyyy') : 'Not set'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-white/60 font-medium">Slot</p>
                <p className="text-[14px] font-bold text-white mt-0.5">{plan.payout_position} of {group.max_members}</p>
              </div>
              {toTurn !== null && toTurn > 0 && (
                <div className="text-right">
                  <p className="text-[11px] text-white/60 font-medium">Countdown</p>
                  <p className="text-[14px] font-bold text-white mt-0.5">{toTurn} days</p>
                </div>
              )}
            </div>
          </div>

          {/* Due today */}
          {dueToday && (
            <div className="panel p-4 mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="t-label">Due today</p>
                <p className="t-figure mt-1">
                  <span className="text-[13px] align-[.4em] mr-0.5 text-ink-2">GHS</span>{n2(dueToday.amount)}
                </p>
                <p className={`text-[11.5px] font-medium mt-1 flex items-center gap-1 ${dl.urgent ? 'text-red' : 'text-ink-2'}`}>
                  {dl.label}
                </p>
              </div>
              <button onClick={() => pay(dueToday)} disabled={paying === dueToday.id} className="act-gold shrink-0">
                {paying === dueToday.id ? '…' : 'Pay Now'}
              </button>
            </div>
          )}

          {/* Progress */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="panel p-4">
              <p className="t-label">Paid so far</p>
              <p className="text-[19px] font-extrabold tnum mt-1">GHS {n0(summary.totalPaidAll)}</p>
            </div>
            <div className="panel p-4">
              <p className="t-label">Still to pay</p>
              <p className="text-[19px] font-extrabold tnum mt-1">GHS {n0(summary.totalPendingAll)}</p>
            </div>
          </div>

          {/* Cycle grid */}
          <div className="panel p-5 mb-3">
            <StampCard contributions={mine} cycleDays={group.cycle_days} onPayDay={pay} payingId={paying} />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <Link href="/m/portal/payments" className="act-primary">Pay ahead</Link>
            <Link href="/m/portal/payments" className="act-quiet">History</Link>
          </div>

          {/* Rotation */}
          <div className="panel p-5 mb-3">
            <p className="t-h2 mb-2">The rotation</p>
            <p className="t-meta mb-3">Who collects, and when.</p>
            <Rotation total={group.max_members} position={plan.payout_position}
              cycleDays={group.cycle_days} startDate={group.start_date} collected={collected} />
          </div>
        </>
      ) : (
        <div className="panel p-8 text-center">
          <p className="t-h2">No plan yet</p>
          <p className="t-meta mt-1.5">Your collector will add you to a group.</p>
        </div>
      )}

      {/* Recent */}
      <div className="panel p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="t-h2">Recent payments</p>
          <Link href="/m/portal/payments" className="t-meta font-semibold flex items-center gap-0.5 hover:text-ink transition-colors">
            See all </Link>
        </div>
        {recentPayments.filter(p => p.status === 'paid').length === 0 ? (
          <p className="t-meta py-3">No payments yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {recentPayments.filter(p => p.status === 'paid').slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-[13.5px] font-semibold">{c.susu_groups?.name}</p>
                  <p className="t-meta">{c.paid_at ? format(new Date(c.paid_at), 'd MMM, HH:mm') : format(new Date(c.due_date), 'd MMM')}</p>
                </div>
                <p className="text-[14px] font-bold text-ink tnum">GHS {n2(c.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      {pending && (
        <PayPrompt
          reference={pending.reference}
          amount={Number(pending.amount ?? 0)}
          phone={member?.mobile_money_number ?? member?.phone}
          initial={pending.status}
          message={pending.message}
          onDone={() => { setPending(null); load() }}
          onClose={() => setPending(null)}
        />
      )}

    </div>
  )
}
