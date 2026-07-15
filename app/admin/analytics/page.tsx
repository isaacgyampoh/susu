'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { format } from 'date-fns'
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, Wallet, Users, Target } from 'lucide-react'

type Analytics = {
  collected_today: number; collected_this_week: number; collected_this_month: number
  due_today: number; paid_today_count: number; due_today_count: number
  collection_rate_today: number; total_outstanding: number; total_overdue: number
  active_members: number; defaulted_members: number
  payouts_due_7d: number; payouts_due_30d: number
}
type TrendRow = { day: string; expected: number; collected: number; rate: number }
type GroupFin = {
  group_id: string; group_name: string
  expected_total: number; collected_total: number; outstanding_total: number
  overdue_total: number; penalties_total: number; reg_fees_total: number
  paid_out_total: number; pending_payouts: number; balance: number
  collection_rate: number; member_count: number; active_members: number; defaulted_members: number
}

function ghs(n: number | undefined) {
  return `GHS ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function AnalyticsPage() {
  const [data, setData]       = useState<{ analytics: Analytics; trend: TrendRow[]; groupFinancials: GroupFin[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getAdminToken()
    callFunction<any>('admin-analytics', { token: token! })
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="animate-spin text-brand-gold" size={36} /></div>
  if (!data?.analytics) return <div className="p-8 text-center text-gray-400">No data yet. Create a group and activate it first.</div>

  const a = data.analytics
  const maxTrend = Math.max(...data.trend.map(t => Number(t.expected)), 1)

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 pb-12 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Analytics</h1>
        <p className="text-gray-400 text-sm mt-1">Collection performance and financial health</p>
      </div>

      {/* Today's collection */}
      <div className="bg-gradient-to-r from-brand-green to-brand-green-mid border border-brand-gold/30 rounded-2xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-green-200 text-sm font-medium">Collected today</p>
            <p className="text-4xl font-extrabold text-brand-gold mt-1">{ghs(a.collected_today)}</p>
            <p className="text-green-200 text-sm mt-1">
              of {ghs(a.due_today)} due · {a.paid_today_count}/{a.due_today_count} members paid
            </p>
          </div>
          <div className="text-right">
            <div className="text-5xl font-extrabold text-white">{Number(a.collection_rate_today).toFixed(0)}%</div>
            <p className="text-green-300 text-sm">collection rate</p>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-4 h-2.5 bg-green-900/50 rounded-full overflow-hidden">
          <div className="h-full bg-brand-gold rounded-full transition-all"
               style={{ width: `${Math.min(Number(a.collection_rate_today), 100)}%` }} />
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'This Week',        value: ghs(a.collected_this_week),  icon: TrendingUp,    color: 'text-emerald-400', bg: 'bg-emerald-900/40' },
          { label: 'This Month',       value: ghs(a.collected_this_month), icon: Wallet,        color: 'text-blue-400',    bg: 'bg-blue-900/40' },
          { label: 'Total Outstanding',value: ghs(a.total_outstanding),    icon: Target,        color: 'text-amber-400',   bg: 'bg-amber-900/40' },
          { label: 'Total Overdue',    value: ghs(a.total_overdue),        icon: AlertTriangle, color: 'text-red-400',     bg: 'bg-red-900/40' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
              <Icon size={17} className={color} />
            </div>
            <div className="text-lg font-extrabold text-white">{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Upcoming payout liability */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <p className="text-gray-400 text-sm">Payouts due — next 7 days</p>
          <p className="text-2xl font-extrabold text-brand-gold mt-1">{ghs(a.payouts_due_7d)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <p className="text-gray-400 text-sm">Payouts due — next 30 days</p>
          <p className="text-2xl font-extrabold text-brand-gold mt-1">{ghs(a.payouts_due_30d)}</p>
        </div>
      </div>

      {/* Collection trend chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h2 className="font-bold text-white mb-1">Collection Trend</h2>
        <p className="text-gray-500 text-xs mb-5">Last 14 days · expected vs collected</p>

        {data.trend.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">No contribution data yet</p>
        ) : (
          <>
            <div className="flex items-end gap-1.5 h-40">
              {data.trend.map(t => {
                const expH = (Number(t.expected)  / maxTrend) * 100
                const colH = (Number(t.collected) / maxTrend) * 100
                const isToday = t.day === new Date().toISOString().split('T')[0]
                return (
                  <div key={t.day} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className="w-full relative flex-1 flex items-end">
                      {/* Expected (background) */}
                      <div className="absolute bottom-0 w-full bg-gray-800 rounded-t transition-all"
                           style={{ height: `${expH}%` }} />
                      {/* Collected (foreground) */}
                      <div className={`absolute bottom-0 w-full rounded-t transition-all ${Number(t.rate) >= 90 ? 'bg-emerald-500' : Number(t.rate) >= 60 ? 'bg-brand-gold' : 'bg-red-500'}`}
                           style={{ height: `${colH}%` }} />
                    </div>
                    <span className={`text-[9px] ${isToday ? 'text-brand-gold font-bold' : 'text-gray-600'}`}>
                      {format(new Date(t.day), 'd')}
                    </span>
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs whitespace-nowrap shadow-xl">
                      <p className="text-white font-medium">{format(new Date(t.day), 'MMM d')}</p>
                      <p className="text-gray-400">Due: {ghs(t.expected)}</p>
                      <p className="text-emerald-400">Paid: {ghs(t.collected)}</p>
                      <p className="text-brand-gold">{Number(t.rate).toFixed(0)}%</p>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 mt-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500" /><span className="text-gray-400">≥90%</span></span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-brand-gold" /><span className="text-gray-400">60–89%</span></span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500" /><span className="text-gray-400">&lt;60%</span></span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-800" /><span className="text-gray-400">Expected</span></span>
            </div>
          </>
        )}
      </div>

      {/* Per-group financial health */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h2 className="font-bold text-white mb-1">Group Financial Health</h2>
        <p className="text-gray-500 text-xs mb-5">Balance = collected + registration fees − paid out</p>

        {data.groupFinancials.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">No active groups</p>
        ) : (
          <div className="space-y-4">
            {data.groupFinancials.map(g => (
              <div key={g.group_id} className="p-4 bg-gray-800/50 border border-gray-800 rounded-xl">
                <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
                  <div>
                    <h3 className="font-bold text-white">{g.group_name}</h3>
                    <p className="text-xs text-gray-500">
                      {g.active_members} active
                      {g.defaulted_members > 0 && <span className="text-red-400"> · {g.defaulted_members} defaulted</span>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xl font-extrabold ${Number(g.balance) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {ghs(g.balance)}
                    </p>
                    <p className="text-xs text-gray-500">current balance</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-gray-500 text-xs">Collected</p><p className="text-emerald-400 font-semibold">{ghs(g.collected_total)}</p></div>
                  <div><p className="text-gray-500 text-xs">Outstanding</p><p className="text-amber-400 font-semibold">{ghs(g.outstanding_total)}</p></div>
                  <div><p className="text-gray-500 text-xs">Paid out</p><p className="text-blue-400 font-semibold">{ghs(g.paid_out_total)}</p></div>
                  <div><p className="text-gray-500 text-xs">Still owed out</p><p className="text-gray-300 font-semibold">{ghs(g.pending_payouts)}</p></div>
                </div>

                <div className="mt-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500">Collection rate</span>
                    <span className={Number(g.collection_rate) >= 90 ? 'text-emerald-400' : Number(g.collection_rate) >= 60 ? 'text-brand-gold' : 'text-red-400'}>
                      {Number(g.collection_rate).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${Number(g.collection_rate) >= 90 ? 'bg-emerald-500' : Number(g.collection_rate) >= 60 ? 'bg-brand-gold' : 'bg-red-500'}`}
                         style={{ width: `${Math.min(Number(g.collection_rate), 100)}%` }} />
                  </div>
                </div>

                {Number(g.overdue_total) > 0 && (
                  <p className="mt-3 text-xs text-red-400 flex items-center gap-1.5">
                    <AlertTriangle size={12} /> {ghs(g.overdue_total)} overdue
                    {Number(g.penalties_total) > 0 && ` · ${ghs(g.penalties_total)} in unpaid penalties`}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
