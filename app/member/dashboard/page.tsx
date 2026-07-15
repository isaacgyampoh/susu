'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard, Contribution } from '@/types'
import { format, differenceInCalendarDays, isToday } from 'date-fns'
import StampCard from '@/components/susu/stamp-card'
import Rotation from '@/components/susu/rotation'
import { useDeadline } from '@/components/susu/deadline'
import { Loader2 } from 'lucide-react'

const n2 = (v: any) => Number(v ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n0 = (v: any) => Number(v ?? 0).toLocaleString('en-GH', { maximumFractionDigits: 0 })

export default function Dashboard() {
  const [d, setD]         = useState<MemberDashboard | null>(null)
  const [loading, setL]   = useState(true)
  const [paying, setP]    = useState<string | null>(null)
  const [tab, setTab]     = useState(0)

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
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  const plan  = d?.plans?.[tab]
  const group = plan?.susu_groups
  const dl    = useDeadline(group?.payment_deadline?.slice(0, 5) ?? '18:00')

  if (loading) return <div className="grid place-items-center h-[60vh]"><Loader2 className="animate-spin text-ink-3" size={22} /></div>
  if (!d)      return <div className="p-10 text-center t-meta">Could not load your card.</div>

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
  const cashout = Number(plan?.payout_amount ?? group?.cashout_amount ?? 0) + Number(group?.registration_fee ?? 0)
  const toTurn  = plan?.payout_date ? differenceInCalendarDays(new Date(plan.payout_date), new Date()) : null

  return (
    <div className="max-w-[440px] mx-auto px-5 py-7 pb-16 animate-fade-in">

      <p className="t-label">{member.member_id}</p>
      <h1 className="t-display mt-1.5">{member.full_name.split(' ')[0]}</h1>

      {penalties.length > 0 && (
        <p className="text-[13px] text-alert font-medium mt-4">
          GHS {n2(summary.totalPenalties)} in penalties will be deducted from your collection.
        </p>
      )}

      {plans.length > 1 && (
        <div className="flex gap-4 mt-6 border-b border-line">
          {plans.map((p, i) => (
            <button key={p.id} onClick={() => setTab(i)}
              className={`text-[13px] pb-2.5 border-b-2 -mb-px transition-colors ${
                i === tab ? 'font-bold text-ink border-ink' : 'font-medium text-ink-2 border-transparent'
              }`}>
              {p.susu_groups?.name}
            </button>
          ))}
        </div>
      )}

      {plan && group ? (
        <>
          {/* Turn + collection — the two numbers that matter */}
          <section className="grid grid-cols-2 gap-5 py-8 border-b border-line mt-6">
            <div>
              <p className="t-label">Your turn</p>
              <p className="text-[22px] font-extrabold tracking-[-.02em] mt-1.5">
                {plan.payout_date ? format(new Date(plan.payout_date), 'd MMM') : '—'}
              </p>
              <p className="t-meta">{toTurn !== null && toTurn > 0 ? `in ${toTurn} days` : plan.payout_date ? 'today' : 'not set'}</p>
            </div>
            <div>
              <p className="t-label">You collect</p>
              <p className="text-[22px] font-extrabold tracking-[-.02em] tnum mt-1.5">
                <span className="text-[12px] align-[.4em] mr-0.5 text-ink-2">GHS</span>{n0(cashout)}
              </p>
              <p className="t-meta">slot {plan.payout_position} of {group.max_members}</p>
            </div>
          </section>

          {/* Due today */}
          {dueToday && (
            <section className="flex items-center justify-between gap-4 py-6 border-b border-line">
              <div>
                <p className="t-label">Due today</p>
                <p className="t-figure mt-1.5">
                  <span className="text-[13px] align-[.4em] mr-0.5 text-ink-2">GHS</span>{n2(dueToday.amount)}
                </p>
                <p className={`t-meta mt-1 ${dl.urgent ? '!text-alert font-semibold' : ''}`}>
                  Before {group.payment_deadline?.slice(0, 5) ?? '18:00'} — {dl.label}
                </p>
              </div>
              <button onClick={() => pay(dueToday)} disabled={paying === dueToday.id} className="act-accent shrink-0">
                {paying === dueToday.id ? <Loader2 size={15} className="animate-spin" /> : 'Pay now'}
              </button>
            </section>
          )}

          {/* The card */}
          <section className="py-8 border-b border-line">
            <StampCard contributions={mine} cycleDays={group.cycle_days} onPayDay={pay} payingId={paying} />
          </section>

          <div className="flex gap-2 py-6 border-b border-line">
            <Link href="/member/payments" className="act-primary flex-1">Pay ahead</Link>
            <Link href="/member/payments" className="act-quiet flex-1">History</Link>
          </div>

          {/* Rotation */}
          <section className="py-8 border-b border-line">
            <h2 className="t-label !text-ink mb-4">The rotation</h2>
            <Rotation total={group.max_members} position={plan.payout_position}
              cycleDays={group.cycle_days} startDate={group.start_date} collected={collected} />
          </section>
        </>
      ) : (
        <p className="t-meta py-10">Your collector will add you to a group.</p>
      )}

      {/* Ledger */}
      <section className="py-8">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="t-label !text-ink">Recent</h2>
          <Link href="/member/payments" className="t-meta hover:text-ink transition-colors">All</Link>
        </div>
        {recentPayments.filter(p => p.status === 'paid').length === 0 ? (
          <p className="t-meta">Nothing paid yet.</p>
        ) : (
          <table className="w-full">
            <tbody className="divide-y divide-line border-y border-line">
              {recentPayments.filter(p => p.status === 'paid').slice(0, 6).map(c => (
                <tr key={c.id}>
                  <td className="py-3 pr-3 text-[13px] font-medium">{c.susu_groups?.name}</td>
                  <td className="py-3 pr-3 t-meta whitespace-nowrap">
                    {c.paid_at ? format(new Date(c.paid_at), 'd MMM') : format(new Date(c.due_date), 'd MMM')}
                  </td>
                  <td className="py-3 text-right text-[13px] font-bold tnum">{n2(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
