'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard, Contribution } from '@/types'
import { format, differenceInCalendarDays, isToday } from 'date-fns'
import StampCard from '@/components/susu/stamp-card'
import Rotation from '@/components/susu/rotation'
import { useDeadline } from '@/components/susu/deadline'
import { Loader2, AlertTriangle, ChevronRight } from 'lucide-react'

const ghs = (n: any) => Number(n ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ghs0 = (n: any) => Number(n ?? 0).toLocaleString('en-GH', { maximumFractionDigits: 0 })

export default function DashboardPage() {
  const [data, setData]     = useState<MemberDashboard | null>(null)
  const [loading, setLoad]  = useState(true)
  const [paying, setPaying] = useState<string | null>(null)
  const [tab, setTab]       = useState(0)

  async function load() {
    const { data } = await callFunction<MemberDashboard>('member-profile', { token: getMemberToken()! })
    setData(data); setLoad(false)
  }
  useEffect(() => { load() }, [])

  async function pay(c: Contribution) {
    setPaying(c.id)
    const { data, error } = await callFunction<any>('payments-initialize',
      { method: 'POST', body: { contribution_id: c.id }, token: getMemberToken()! })
    setPaying(null)
    if (error) return alert(error)
    if (data?.dev_mode) return load()
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  const plan  = data?.plans?.[tab]
  const group = plan?.susu_groups
  const dl    = useDeadline(group?.payment_deadline?.slice(0, 5) ?? '18:00')

  if (loading) return <div className="grid place-items-center min-h-[70vh]"><Loader2 className="animate-spin text-gold" size={26} /></div>
  if (!data)   return <div className="px-5 py-20 text-center text-dim-field">Couldn't load your card.</div>

  const { member, plans, summary, pendingContributions, recentPayments, penalties } = data
  const dueToday = pendingContributions.find(c => isToday(new Date(c.due_date)))

  // Contributions for the open card
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
    <div className="max-w-[430px] mx-auto px-[18px] pt-2 pb-28 animate-fade-in">

      <header className="flex items-center justify-between py-3">
        <div>
          <p className="text-[13px] font-semibold">{member.full_name}</p>
          <p className="font-mono text-[11px] text-dim-field mt-0.5">{member.member_id}</p>
        </div>
        {plans.length > 1 && (
          <div className="flex gap-1 bg-field-2 rounded-[3px] p-1">
            {plans.map((p, i) => (
              <button key={p.id} onClick={() => setTab(i)}
                className={`px-3 py-1.5 rounded-[2px] stencil-sm transition-colors ${i === tab ? 'bg-gold text-ink' : 'text-dim-field'}`}>
                {p.susu_groups?.name?.split(' ')[0]}
              </button>
            ))}
          </div>
        )}
      </header>

      {penalties.length > 0 && (
        <div className="flex items-start gap-2.5 bg-stamp/15 border border-stamp/30 rounded-[3px] p-3.5 mb-3">
          <AlertTriangle size={15} className="text-stamp mt-0.5 shrink-0" />
          <p className="text-[12px] text-card/90">
            <span className="font-bold">GHS {ghs(summary.totalPenalties)} in penalties.</span>{' '}
            Taken off your collection. Message your admin to settle.
          </p>
        </div>
      )}

      {/* ── THE CARD ── */}
      {plan && group ? (
        <div className="card-stock p-5">
          <div className="flex justify-between items-start pb-3.5 border-b-2 border-ink">
            <div>
              <p className="stencil">Susu Card</p>
              <h1 className="text-[19px] font-extrabold tracking-[-.02em] mt-0.5">{group.name}</h1>
              <p className="text-[11px] font-semibold text-dim mt-0.5">
                GHS {ghs0(group.contribution_amount)} {group.contribution_frequency} · {group.max_members} members · {group.cycle_days} days
              </p>
            </div>
            <div className="text-right shrink-0 pl-3">
              <p className="text-[38px] font-black leading-[.85] tracking-[-.04em] tnum">
                {String(plan.payout_position).padStart(2, '0')}
              </p>
              <p className="stencil-sm text-dim mt-1">Your slot</p>
            </div>
          </div>

          <div className="mt-4">
            <StampCard contributions={mine} cycleDays={group.cycle_days} onPayDay={pay} payingId={paying} />
          </div>

          <div className="flex justify-between items-end mt-4 pt-3.5 border-t-2 border-ink">
            <div>
              <p className="stencil-sm text-dim">Your turn</p>
              <p className="text-[15px] font-extrabold mt-0.5">
                {plan.payout_date ? format(new Date(plan.payout_date), 'EEE d MMM') : 'Not set'}
              </p>
              {toTurn !== null && toTurn > 0 && (
                <p className="text-[11px] font-semibold text-dim">in {toTurn} days</p>
              )}
            </div>
            <div className="text-right">
              <p className="stencil-sm text-dim">You collect</p>
              <p className="text-[27px] font-black tracking-[-.035em] leading-none tnum mt-0.5">
                <span className="text-[13px] font-extrabold align-[.35em] mr-px">GHS</span>{ghs0(cashout)}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="card-stock p-8 text-center">
          <p className="stencil text-dim">No card yet</p>
          <p className="text-[14px] font-semibold mt-2">Your admin will add you to a group.</p>
        </div>
      )}

      {/* ── Due today ── */}
      {dueToday && (
        <div className="bg-gold text-ink rounded-[4px] p-4 mt-3 flex items-center justify-between gap-4">
          <div>
            <p className="stencil-sm opacity-65">Due today</p>
            <p className="text-[23px] font-black tracking-[-.03em] leading-none mt-1 tnum">GHS {ghs(dueToday.amount)}</p>
            <p className={`text-[10px] font-bold mt-1.5 ${dl.urgent ? 'text-stamp' : 'opacity-70'}`}>
              Before {group?.payment_deadline?.slice(0,5) ?? '18:00'} · {dl.label}
            </p>
          </div>
          <button onClick={() => pay(dueToday)} disabled={paying === dueToday.id} className="btn-ink shrink-0">
            {paying === dueToday.id ? <Loader2 size={15} className="animate-spin" /> : 'Pay'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-3">
        <Link href="/member/payments" className="btn-gold">Pay ahead</Link>
        <Link href="/member/payments" className="btn-line">History</Link>
      </div>

      {/* ── The rotation ── */}
      {plan && group && (
        <section className="mt-7">
          <p className="stencil text-dim-field mb-2.5">The rotation — who collects when</p>
          <Rotation total={group.max_members} position={plan.payout_position}
            cycleDays={group.cycle_days} startDate={group.start_date} collected={collected} />
        </section>
      )}

      {/* ── Ledger ── */}
      <section className="mt-7">
        <div className="flex items-center justify-between mb-2.5">
          <p className="stencil text-dim-field">Recent</p>
          <Link href="/member/payments" className="text-[11px] font-bold text-dim-field flex items-center gap-0.5">
            All <ChevronRight size={12} />
          </Link>
        </div>
        {recentPayments.filter(p => p.status === 'paid').length === 0 ? (
          <p className="text-dim-field text-[13px] py-3">Nothing paid yet.</p>
        ) : (
          <div className="bg-field-2 rounded-[4px] p-1">
            {recentPayments.filter(p => p.status === 'paid').slice(0, 6).map((c, i) => (
              <div key={c.id} className={`flex items-center gap-3 px-3 py-2.5 ${i > 0 ? 'border-t border-white/5' : ''}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-stamp shrink-0" />
                <span className="text-[13px] font-semibold flex-1 truncate">{c.susu_groups?.name}</span>
                <span className="text-[11px] opacity-50 font-mono">
                  {c.paid_at ? format(new Date(c.paid_at), 'd MMM') : format(new Date(c.due_date), 'd MMM')}
                </span>
                <span className="text-[13px] font-bold tnum">{ghs(c.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
