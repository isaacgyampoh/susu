'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { AdminDashboard } from '@/types'
import { format } from 'date-fns'
import { Users, Layers, ShieldCheck, AlertCircle, TrendingUp, Loader2, ChevronRight, UserPlus, Flag, Wallet } from 'lucide-react'

export default function AdminDashboardPage() {
  const [data, setData]       = useState<AdminDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [flagging, setFlagging] = useState(false)
  const [toast, setToast]     = useState('')

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(''), 4000) }

  async function load() {
    const token = getAdminToken()
    const { data } = await callFunction<AdminDashboard>('admin-dashboard', { token: token! })
    setData(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function runLateCheck() {
    setFlagging(true)
    const token = getAdminToken()
    const { data: res, error } = await callFunction<{ flagged_count: number; notified: number }>(
      'flag-late-payments', { method: 'POST', token: token! }
    )
    setFlagging(false)
    if (error) { showToast('❌ ' + error); return }
    showToast(`✅ ${res?.flagged_count ?? 0} payment(s) flagged as late`)
    load()
  }

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="animate-spin text-brand-gold" size={36} /></div>
  if (!data)   return <div className="p-8 text-center text-gray-400">Could not load dashboard. Check your Supabase setup.</div>

  const { stats, recentKYC, upcomingPayouts, groups } = data

  const statCards = [
    { label: 'Active Members', value: stats.totalMembers,         href: '/admin/members',       icon: Users,       color: 'bg-blue-900/50 text-blue-400' },
    { label: 'Active Groups',  value: stats.activeGroups,         href: '/admin/groups',        icon: Layers,      color: 'bg-emerald-900/50 text-emerald-400' },
    { label: 'Pending KYC',    value: stats.pendingKYC,           href: '/admin/kyc',           icon: ShieldCheck, color: 'bg-amber-900/50 text-amber-400' },
    { label: 'Overdue',        value: stats.overdueContributions, href: '/admin/contributions', icon: AlertCircle, color: 'bg-red-900/50 text-red-400' },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 pb-12 animate-fade-in">
      {toast && <div className="fixed top-4 right-4 z-50 bg-gray-900 border border-gray-700 text-white px-5 py-3 rounded-xl shadow-lg text-sm">{toast}</div>}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Overview of your Susu platform</p>
        </div>
        <div className="flex gap-2">
          <button onClick={runLateCheck} disabled={flagging}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl text-sm transition-colors disabled:opacity-50">
            {flagging ? <Loader2 size={15} className="animate-spin" /> : <Flag size={15} />} Run Late Check
          </button>
          <Link href="/admin/members/new"
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-gold text-brand-green font-semibold rounded-xl text-sm hover:bg-amber-400 transition-colors">
            <UserPlus size={15} /> Add Member
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map(({ label, value, href, icon: Icon, color }) => (
          <Link key={label} href={href} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-600 transition-colors group">
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}><Icon size={20} /></div>
              <ChevronRight size={16} className="text-gray-700 group-hover:text-gray-400 transition-colors" />
            </div>
            <div className="text-2xl font-extrabold text-white">{value}</div>
            <div className="text-sm text-gray-500 mt-0.5">{label}</div>
          </Link>
        ))}

        {/* Total collected */}
        <div className="bg-gradient-to-br from-brand-green to-brand-green-mid border border-brand-gold/30 rounded-2xl p-5">
          <div className="w-10 h-10 rounded-xl bg-brand-gold/20 flex items-center justify-center mb-3">
            <Wallet size={20} className="text-brand-gold" />
          </div>
          <div className="text-2xl font-extrabold text-brand-gold">GHS {Number(stats.totalCollected).toLocaleString()}</div>
          <div className="text-sm text-green-200 mt-0.5">Total Collected</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Upcoming payouts */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-white flex items-center gap-2"><TrendingUp size={17} className="text-brand-gold" /> Upcoming Payouts (7 days)</h2>
            <Link href="/admin/payouts" className="text-brand-gold text-sm hover:underline">View all</Link>
          </div>
          {!upcomingPayouts || upcomingPayouts.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">No payouts in the next 7 days</p>
          ) : (
            <div className="space-y-2">
              {upcomingPayouts.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-800">
                  <div>
                    <p className="text-white text-sm font-medium">{p.members?.full_name}</p>
                    <p className="text-gray-400 text-xs">{p.susu_groups?.name} · {format(new Date(p.scheduled_date), 'MMM d, yyyy')}</p>
                  </div>
                  <div className="text-brand-gold font-bold">GHS {Number(p.total_amount).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent KYC */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-white flex items-center gap-2"><ShieldCheck size={17} className="text-amber-400" /> Recent KYC Applications</h2>
            <Link href="/admin/kyc" className="text-brand-gold text-sm hover:underline">View all</Link>
          </div>
          {!recentKYC || recentKYC.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">No applications yet</p>
              <p className="text-gray-600 text-xs mt-1">Members will appear here once the public site is live</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentKYC.map(k => (
                <Link key={k.id} href="/admin/kyc" className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-800 transition-colors">
                  <div>
                    <p className="text-white text-sm font-medium">{k.full_name}</p>
                    <p className="text-gray-500 text-xs">{k.phone} · {k.susu_groups?.name}</p>
                  </div>
                  <span className={k.status === 'pending' ? 'badge-gold' : k.status === 'approved' ? 'badge-green' : 'badge-red'}>{k.status}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Groups */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-white">All Groups</h2>
          <Link href="/admin/groups/new" className="px-4 py-2 bg-brand-gold text-brand-green font-semibold rounded-lg text-xs hover:bg-amber-400 transition-colors">+ New Group</Link>
        </div>
        {!groups || groups.length === 0 ? (
          <div className="text-center py-8">
            <Layers size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No groups yet</p>
            <Link href="/admin/groups/new" className="text-brand-gold text-sm hover:underline mt-1 inline-block">Create your first group →</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="pb-3 text-left font-medium">Group</th>
                  <th className="pb-3 text-left font-medium">Contribution</th>
                  <th className="pb-3 text-left font-medium">Cashout</th>
                  <th className="pb-3 text-left font-medium">Members</th>
                  <th className="pb-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {groups.map(g => (
                  <tr key={g.id} className="hover:bg-gray-800/50 transition-colors">
                    <td className="py-3 text-white font-medium">{g.name}</td>
                    <td className="py-3 text-gray-400">GHS {g.contribution_amount}/{g.contribution_frequency}</td>
                    <td className="py-3 text-brand-gold font-semibold">
                      {g.cashout_amount ? `GHS ${Number(g.cashout_amount).toLocaleString()}` : '—'}
                    </td>
                    <td className="py-3 text-gray-400">{g.current_members}/{g.max_members}</td>
                    <td className="py-3">
                      <span className={g.status === 'active' ? 'badge-green' : g.status === 'open' ? 'badge-blue' : g.status === 'full' ? 'badge-gold' : 'badge-gray'}>{g.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
