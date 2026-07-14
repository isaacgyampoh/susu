'use client'
import { useEffect, useState } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard, Contribution } from '@/types'
import { format, differenceInCalendarDays, isPast, isToday } from 'date-fns'
import { Loader2, Calendar, TrendingUp, AlertTriangle, CheckCircle, Clock, Coins, Bell, ChevronRight, AlertCircle } from 'lucide-react'
import Link from 'next/link'

function DeadlineCountdown({ deadline }: { deadline: string }) {
  const [timeLeft, setTimeLeft] = useState('')
  const [isUrgent, setIsUrgent] = useState(false)

  useEffect(() => {
    function calc() {
      const now    = new Date()
      const [h, m] = (deadline ?? '18:00').split(':')
      const cutoff = new Date()
      cutoff.setHours(parseInt(h), parseInt(m), 0, 0)
      const diff = cutoff.getTime() - now.getTime()
      if (diff <= 0) { setTimeLeft('DEADLINE PASSED'); setIsUrgent(true); return }
      const hours   = Math.floor(diff / 3600000)
      const minutes = Math.floor((diff % 3600000) / 60000)
      setTimeLeft(`${hours}h ${minutes}m until 6PM deadline`)
      setIsUrgent(diff < 3600000) // urgent if <1hr
    }
    calc()
    const t = setInterval(calc, 60000)
    return () => clearInterval(t)
  }, [deadline])

  return (
    <span className={`text-xs font-medium ${isUrgent ? 'text-red-600' : 'text-amber-600'}`}>
      ⏰ {timeLeft}
    </span>
  )
}

export default function MemberDashboard() {
  const [data, setData]       = useState<MemberDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [payingId, setPayingId] = useState<string | null>(null)

  useEffect(() => {
    const token = getMemberToken()
    callFunction<MemberDashboard>('member-profile', { token: token! })
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
  }, [])

  async function handlePay(contribution: Contribution) {
    const token = getMemberToken()
    setPayingId(contribution.id)
    const { data, error } = await callFunction<{ authorization_url?: string; reference?: string; dev_mode?: boolean; message?: string }>(
      'payments-initialize', { method: 'POST', body: { contribution_id: contribution.id }, token: token! }
    )
    setPayingId(null)
    if (error) { alert(error); return }
    if (data?.dev_mode) {
        setData(null)
        const token = getMemberToken()
        callFunction<MemberDashboard>("member-profile", { token: token! }).then(({ data }) => setData(data))
      } else {
        window.location.href = data!.authorization_url!
      }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-brand-green" size={36} />
    </div>
  )

  if (!data) return <div className="p-8 text-center text-gray-500">Could not load dashboard. Please refresh.</div>

  const { member, plans, summary, pendingContributions, recentPayments, payouts, penalties, announcements } = data
  const todayContribs = pendingContributions.filter(c => isToday(new Date(c.due_date)))
  const overdueContribs = pendingContributions.filter(c => isPast(new Date(c.due_date)) && !isToday(new Date(c.due_date)))

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-12 animate-fade-in">

      {/* Welcome */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-green">
            {new Date().getHours() < 12 ? 'Good morning' : 'Good afternoon'}, {member.full_name.split(' ')[0]} 👋
          </h1>
          <p className="text-gray-500 text-sm mt-1">Member ID: <span className="font-semibold text-brand-green">{member.member_id}</span></p>
        </div>
      </div>

      {/* Penalty warning */}
      {penalties.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl">
          <AlertTriangle size={20} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-red-800">Outstanding Penalties</p>
            <p className="text-red-700 text-sm mt-0.5">
              You have GHS {summary.totalPenalties.toFixed(2)} in unpaid penalties from late payments. Contact admin to resolve.
            </p>
          </div>
        </div>
      )}

      {/* Overdue warning */}
      {overdueContribs.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl">
          <AlertCircle size={20} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-red-800">{overdueContribs.length} Overdue Payment{overdueContribs.length > 1 ? 's' : ''}</p>
            <p className="text-red-700 text-sm">You have missed payments. Contact your admin immediately — defaulting forfeits your slot.</p>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Paid',    value: `GHS ${summary.totalPaidAll.toFixed(2)}`,   color: 'text-emerald-600', bg: 'bg-emerald-50',  icon: CheckCircle },
          { label: 'Balance Due',   value: `GHS ${summary.totalPendingAll.toFixed(2)}`, color: 'text-amber-600',   bg: 'bg-amber-50',    icon: Clock       },
          { label: 'Active Plans',  value: String(summary.activePlans),                 color: 'text-blue-600',    bg: 'bg-blue-50',     icon: Coins       },
          { label: 'Next Payout',   value: summary.nextPayoutDate ? format(new Date(summary.nextPayoutDate), 'dd MMM') : '—', color: 'text-brand-green', bg: 'bg-brand-green-light', icon: Calendar },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className="card p-4">
            <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-2`}>
              <Icon size={18} className={color} />
            </div>
            <div className="font-bold text-gray-900 text-lg leading-tight">{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Next payout spotlight */}
      {summary.nextPayoutDate && summary.nextPayoutAmount && (
        <div className="card p-5 bg-gradient-to-r from-brand-green to-brand-green-mid text-white flex items-center justify-between">
          <div>
            <p className="text-green-200 text-sm font-medium">🎉 Your next cashout — {summary.nextPayoutGroup}</p>
            <p className="text-3xl font-extrabold text-brand-gold mt-1">GHS {Number(summary.nextPayoutAmount).toLocaleString()}</p>
            <p className="text-green-200 text-sm mt-1 flex items-center gap-1.5">
              <Calendar size={14} /> {format(new Date(summary.nextPayoutDate), 'EEEE, MMMM d, yyyy')}
            </p>
            <p className="text-green-300 text-xs mt-1">
              {differenceInCalendarDays(new Date(summary.nextPayoutDate), new Date())} days away
            </p>
          </div>
          <TrendingUp size={48} className="text-white/20 hidden sm:block" />
        </div>
      )}

      {/* Active Plans — one card per group */}
      {plans.length > 0 && (
        <div>
          <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Coins size={18} className="text-brand-green" /> My Active Plans</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {plans.map((plan) => {
              const group    = plan.susu_groups!
              const balance  = plan.balance
              const pct      = balance ? Math.round((balance.contributions_paid / Math.max(balance.contributions_total, 1)) * 100) : 0
              const cashout  = plan.payout_amount ?? group.cashout_amount

              return (
                <div key={plan.id} className="card p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-brand-green">{group.name}</h3>
                      <p className="text-xs text-gray-500">Position #{plan.payout_position} · GHS {group.contribution_amount}/{group.contribution_frequency}</p>
                    </div>
                    <span className="badge-green">Active</span>
                  </div>

                  {/* Progress */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Progress</span>
                      <span>{balance?.contributions_paid ?? 0}/{balance?.contributions_total ?? 0} payments · {pct}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-gold rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Total paid</span><span className="font-medium text-emerald-600">GHS {Number(balance?.total_paid ?? 0).toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Remaining</span><span className="font-medium text-amber-600">GHS {Number(balance?.total_remaining ?? 0).toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Your cashout</span><span className="font-bold text-brand-gold">GHS {cashout ? Number(cashout).toLocaleString() : '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Payout date</span><span className="font-medium text-brand-green">{plan.payout_date ? format(new Date(plan.payout_date), 'MMM d, yyyy') : 'Pending'}</span></div>
                  </div>

                  {/* Next contribution for this plan */}
                  {plan.nextContribution && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-gray-500">Next payment due</p>
                          <p className="text-sm font-semibold text-gray-800">{format(new Date(plan.nextContribution.due_date), 'MMM d, yyyy')}</p>
                          {isToday(new Date(plan.nextContribution.due_date)) && (
                            <DeadlineCountdown deadline={group.payment_deadline ?? '18:00'} />
                          )}
                        </div>
                        <button
                          onClick={() => handlePay(plan.nextContribution!)}
                          disabled={payingId === plan.nextContribution.id}
                          className="btn-primary text-xs px-4 py-2"
                        >
                          {payingId === plan.nextContribution.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : `Pay GHS ${plan.nextContribution.amount}`
                          }
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Pending/overdue payments */}
        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Clock size={18} className="text-amber-500" /> All Pending Payments
          </h2>
          {pendingContributions.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">No pending payments 🎉</p>
          ) : (
            <div className="space-y-2">
              {pendingContributions.slice(0, 6).map((c) => (
                <div key={c.id} className={`flex items-center justify-between p-3 rounded-xl ${c.status === 'overdue' ? 'bg-red-50 border border-red-100' : c.is_flagged ? 'bg-amber-50 border border-amber-100' : 'bg-gray-50'}`}>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{c.susu_groups?.name}</p>
                    <p className="text-xs text-gray-500">
                      {format(new Date(c.due_date), 'MMM d, yyyy')}
                      {c.is_flagged && <span className="ml-1 text-red-600 font-semibold">· FLAGGED</span>}
                      {c.penalty_due && c.penalty_due > 0
                        ? <span className="ml-1 text-red-600"> + GHS {c.penalty_due} penalty</span>
                        : null
                      }
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900 text-sm">GHS {Number(c.amount).toFixed(2)}</span>
                    <button onClick={() => handlePay(c)} disabled={payingId === c.id} className="btn-primary text-xs px-3 py-1.5">
                      {payingId === c.id ? <Loader2 size={12} className="animate-spin" /> : 'Pay'}
                    </button>
                  </div>
                </div>
              ))}
              {pendingContributions.length > 6 && (
                <Link href="/member/payments" className="block text-center text-sm text-brand-green font-medium mt-2 hover:underline">
                  View all {pendingContributions.length} pending payments <ChevronRight size={14} className="inline" />
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Recent payments */}
        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <CheckCircle size={18} className="text-emerald-500" /> Recent Payments
          </h2>
          {recentPayments.filter(p => p.status === 'paid').length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">No payments yet</p>
          ) : (
            <div className="space-y-2">
              {recentPayments.filter(p => p.status === 'paid').slice(0, 6).map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm text-gray-700">{c.susu_groups?.name}</p>
                    <p className="text-xs text-gray-400">{c.paid_at ? format(new Date(c.paid_at), 'MMM d · HH:mm') : format(new Date(c.due_date), 'MMM d')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">GHS {Number(c.amount).toFixed(2)}</span>
                    <span className="badge-green">Paid</span>
                  </div>
                </div>
              ))}
              <Link href="/member/payments" className="block text-center text-sm text-brand-green font-medium mt-2 hover:underline">
                View full history <ChevronRight size={14} className="inline" />
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Bell size={18} className="text-blue-500" /> Announcements</h2>
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="p-4 border border-blue-100 bg-blue-50 rounded-xl">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-blue-900 text-sm">{a.title}</h3>
                  <span className="text-xs text-blue-400 shrink-0">{format(new Date(a.created_at), 'MMM d')}</span>
                </div>
                <p className="text-sm text-blue-700 mt-1">{a.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
