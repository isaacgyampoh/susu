'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { AdminDashboard } from '@/types'
import { format } from 'date-fns'
import { Users, Layers, ShieldCheck, AlertCircle, TrendingUp, Loader2, ChevronRight } from 'lucide-react'

function statCard(label: string, value: string | number, color: string, icon: React.ReactNode, href: string) {
  return (
    <Link href={href} className="card p-5 hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>{icon}</div>
        <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
      </div>
      <div className="text-2xl font-extrabold text-gray-900">{value}</div>
      <div className="text-sm text-gray-500 mt-0.5">{label}</div>
    </Link>
  )
}

export default function AdminDashboardPage() {
  const [data, setData]       = useState<AdminDashboard | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getAdminToken()
    callFunction<AdminDashboard>('admin-dashboard', { token: token! })
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex justify-center py-32"><Loader2 className="animate-spin text-brand-gold" size={36} /></div>
  )

  if (!data) return <div className="p-8 text-center text-gray-400">Could not load dashboard</div>

  const { stats, recentKYC, upcomingPayouts, groups } = data

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 pb-12 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Overview of your Susu platform</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {statCard('Active Members',   stats.totalMembers,         'bg-blue-900/50',    <Users size={20} className="text-blue-400" />,    '/admin/members')}
        {statCard('Active Groups',    stats.activeGroups,         'bg-emerald-900/50', <Layers size={20} className="text-emerald-400" />, '/admin/groups')}
        {statCard('Pending KYC',      stats.pendingKYC,           'bg-amber-900/50',   <ShieldCheck size={20} className="text-amber-400" />, '/admin/kyc')}
        {statCard('Overdue',          stats.overdueContributions, 'bg-red-900/50',     <AlertCircle size={20} className="text-red-400" />,  '/admin/contributions')}
        {statCard(`GHS ${Number(stats.totalCollected).toLocaleString()}`, 'Total Collected', 'bg-brand-green/20', <TrendingUp size={20} className="text-brand-gold" />, '/admin/payouts')}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent KYC */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-white">Recent KYC Applications</h2>
            <Link href="/admin/kyc" className="text-brand-gold text-sm hover:underline">View all</Link>
          </div>
          {recentKYC?.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6">No applications</p>
          ) : (
            <div className="space-y-2">
              {recentKYC?.map((k) => (
                <Link key={k.id} href={`/admin/kyc`} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-800 transition-colors">
                  <div>
                    <p className="text-white text-sm font-medium">{k.full_name}</p>
                    <p className="text-gray-500 text-xs">{k.phone} · {k.susu_groups?.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{format(new Date(k.submitted_at), 'MMM d')}</span>
                    <span className={k.status === 'pending' ? 'badge-gold' : k.status === 'approved' ? 'badge-green' : 'badge-red'}>{k.status}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming payouts */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-white">Upcoming Payouts (7 days)</h2>
            <Link href="/admin/payouts" className="text-brand-gold text-sm hover:underline">View all</Link>
          </div>
          {upcomingPayouts?.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6">No payouts in the next 7 days</p>
          ) : (
            <div className="space-y-2">
              {upcomingPayouts?.map((p) => (
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
      </div>

      {/* Groups overview */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-white">All Groups</h2>
          <Link href="/admin/groups/new" className="btn-primary text-xs px-4 py-2">+ New Group</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="pb-3 text-left font-medium">Group</th>
                <th className="pb-3 text-left font-medium">Contribution</th>
                <th className="pb-3 text-left font-medium">Members</th>
                <th className="pb-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {groups?.map((g) => (
                <tr key={g.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="py-3 text-white font-medium">{g.name}</td>
                  <td className="py-3 text-gray-400">GHS {g.contribution_amount}/{g.contribution_frequency}</td>
                  <td className="py-3 text-gray-400">{g.current_members}/{g.max_members}</td>
                  <td className="py-3">
                    <span className={g.status === 'active' ? 'badge-green' : g.status === 'open' ? 'badge-blue' : g.status === 'full' ? 'badge-gold' : 'badge-gray'}>{g.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
