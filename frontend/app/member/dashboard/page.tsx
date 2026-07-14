'use client'
import { useEffect, useState } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard, Contribution } from '@/types'
import { format } from 'date-fns'
import { Loader2, Calendar, TrendingUp, AlertCircle, CheckCircle, Coins, Bell, Clock } from 'lucide-react'

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
    const { data, error } = await callFunction<{ authorization_url: string }>(
      'payments-initialize',
      { method: 'POST', body: { contribution_id: contribution.id }, token: token! }
    )
    setPayingId(null)
    if (error) { alert(error); return }
    window.location.href = data!.authorization_url
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-brand-green" size={36} />
    </div>
  )

  if (!data) return <div className="p-8 text-center text-gray-500">Could not load your dashboard. Please try again.</div>

  const { member, summary, pendingContributions, recentPayments, payouts, announcements, memberships } = data

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-12 animate-fade-in">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-extrabold text-brand-green">
          Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {member.full_name.split(' ')[0]} 👋
        </h1>
        <p className="text-gray-500 text-sm mt-1">Member ID: <span className="font-semibold text-brand-green">{member.member_id}</span></p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Paid',    value: `GHS ${summary.totalPaid.toFixed(2)}`,   icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Balance Due',   value: `GHS ${summary.totalPending.toFixed(2)}`, icon: AlertCircle, color: 'text-amber-600',   bg: 'bg-amber-50'   },
          { label: 'Active Groups', value: String(summary.activeGroups),            icon: Coins,       color: 'text-blue-600',    bg: 'bg-blue-50'    },
          { label: 'Next Payout',   value: summary.nextPayoutDate ? format(new Date(summary.nextPayoutDate), 'dd MMM') : 'N/A', icon: Calendar, color: 'text-brand-green', bg: 'bg-brand-green-light' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="card p-4">
            <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-2`}>
              <Icon size={18} className={color} />
            </div>
            <div className="font-bold text-gray-900 text-lg leading-tight">{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Payout countdown card */}
      {summary.nextPayoutDate && summary.nextPayoutAmount && (
        <div className="card p-5 bg-gradient-to-r from-brand-green to-brand-green-mid text-white flex items-center justify-between">
          <div>
            <p className="text-green-200 text-sm font-medium">Your next payout</p>
            <p className="text-3xl font-extrabold text-brand-gold mt-1">GHS {Number(summary.nextPayoutAmount).toLocaleString()}</p>
            <p className="text-green-200 text-sm mt-1 flex items-center gap-1.5">
              <Calendar size={14} /> {format(new Date(summary.nextPayoutDate), 'EEEE, MMMM d, yyyy')}
            </p>
          </div>
          <TrendingUp size={48} className="text-white/20 hidden sm:block" />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Pending contributions */}
        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Clock size={18} className="text-amber-500" /> Pending Payments
          </h2>
          {pendingContributions.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">No pending payments 🎉</p>
          ) : (
            <div className="space-y-3">
              {pendingContributions.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{c.susu_groups?.name}</p>
                    <p className="text-xs text-gray-500">{format(new Date(c.due_date), 'MMM d, yyyy')} · <span className={c.status === 'overdue' ? 'text-red-600 font-semibold' : ''}>{c.status}</span></p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900">GHS {Number(c.amount).toFixed(2)}</span>
                    <button
                      onClick={() => handlePay(c)}
                      disabled={payingId === c.id}
                      className="btn-primary text-xs px-3 py-1.5"
                    >
                      {payingId === c.id ? <Loader2 size={12} className="animate-spin" /> : 'Pay'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent payment history */}
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
                    <p className="text-xs text-gray-400">{c.paid_at ? format(new Date(c.paid_at), 'MMM d, yyyy HH:mm') : format(new Date(c.due_date), 'MMM d, yyyy')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">GHS {Number(c.amount).toFixed(2)}</span>
                    <span className="badge-green">Paid</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active memberships */}
      {memberships.length > 0 && (
        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-4">Active Susu Plans</h2>
          <div className="space-y-3">
            {memberships.map((m) => (
              <div key={m.id} className="p-4 bg-brand-green-light rounded-xl flex items-center justify-between">
                <div>
                  <p className="font-semibold text-brand-green">{m.susu_groups?.name}</p>
                  <p className="text-sm text-gray-500">Position #{m.payout_position} · {m.susu_groups?.contribution_frequency} GHS {m.susu_groups?.contribution_amount}</p>
                </div>
                <div className="text-right">
                  {m.payout_date && <p className="text-xs text-gray-500">Payout: {format(new Date(m.payout_date), 'MMM d, yyyy')}</p>}
                  {m.payout_amount && <p className="font-bold text-brand-gold">GHS {Number(m.payout_amount).toLocaleString()}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Bell size={18} className="text-blue-500" /> Announcements
          </h2>
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
