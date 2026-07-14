'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { Contribution, SusuGroup } from '@/types'
import { format } from 'date-fns'
import { Loader2, CheckCircle, AlertCircle, Clock } from 'lucide-react'

type StatusFilter = 'pending' | 'paid' | 'overdue' | 'all'

export default function ContributionsPage() {
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [groups, setGroups]               = useState<SusuGroup[]>([])
  const [loading, setLoading]             = useState(true)
  const [statusFilter, setStatusFilter]   = useState<StatusFilter>('pending')
  const [groupFilter, setGroupFilter]     = useState<string>('all')
  const [page, setPage]                   = useState(1)
  const [total, setTotal]                 = useState(0)

  useEffect(() => {
    // Load groups for filter dropdown
    const token = getAdminToken()
    callFunction<{ groups: SusuGroup[] }>('groups-create', { token: token! })
      .then(({ data }) => setGroups(data?.groups ?? []))
  }, [])

  useEffect(() => {
    loadContributions()
  }, [statusFilter, groupFilter, page])

  async function loadContributions() {
    setLoading(true)
    const token = getAdminToken()
    const params = new URLSearchParams({ page: String(page) })
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (groupFilter  !== 'all') params.set('group_id', groupFilter)

    const { data } = await callFunction<{ contributions: Contribution[]; total: number }>(
      `contributions-list?${params}`, { token: token! }
    )
    setContributions(data?.contributions ?? [])
    setTotal(data?.total ?? 0)
    setLoading(false)
  }

  function statusIcon(s: string) {
    if (s === 'paid')    return <CheckCircle size={15} className="text-emerald-500" />
    if (s === 'overdue') return <AlertCircle size={15} className="text-red-500" />
    return <Clock size={15} className="text-amber-500" />
  }

  function statusBadge(s: string) {
    if (s === 'paid')    return <span className="badge-green">Paid</span>
    if (s === 'overdue') return <span className="badge-red">Overdue</span>
    return <span className="badge-gold">Pending</span>
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto pb-12 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">Contributions</h1>
        <p className="text-gray-400 text-sm mt-1">{total} total records</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex gap-2 flex-wrap">
          {(['pending','paid','overdue','all'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-brand-gold text-brand-green' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              {s}
            </button>
          ))}
        </div>
        <select
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold"
          value={groupFilter} onChange={e => { setGroupFilter(e.target.value); setPage(1) }}>
          <option value="all">All Groups</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-gold" size={32} /></div>
      ) : contributions.length === 0 ? (
        <div className="text-center py-20 text-gray-500">No contributions found</div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-800">
              <tr className="text-gray-500">
                <th className="px-5 py-3 text-left font-medium">Member</th>
                <th className="px-5 py-3 text-left font-medium hidden sm:table-cell">Group</th>
                <th className="px-5 py-3 text-left font-medium">Due Date</th>
                <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Paid On</th>
                <th className="px-5 py-3 text-left font-medium">Amount</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {contributions.map(c => (
                <tr key={c.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      {statusIcon(c.status)}
                      <div>
                        <p className="text-white font-medium text-xs">{(c as any).members?.full_name}</p>
                        <p className="text-gray-500 text-xs font-mono">{(c as any).members?.member_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-400 hidden sm:table-cell text-xs">{c.susu_groups?.name}</td>
                  <td className="px-5 py-3.5 text-gray-300 text-xs">{format(new Date(c.due_date), 'MMM d, yyyy')}</td>
                  <td className="px-5 py-3.5 text-gray-400 text-xs hidden md:table-cell">
                    {c.paid_at ? format(new Date(c.paid_at), 'MMM d, HH:mm') : '—'}
                  </td>
                  <td className="px-5 py-3.5 text-white font-semibold">GHS {Number(c.amount).toFixed(2)}</td>
                  <td className="px-5 py-3.5">{statusBadge(c.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {total > 30 && (
            <div className="px-5 py-4 border-t border-gray-800 flex items-center justify-between">
              <span className="text-sm text-gray-500">Page {page} · {total} records</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                  className="px-3 py-1.5 text-sm bg-gray-800 text-gray-400 rounded-lg disabled:opacity-40 hover:text-white">Prev</button>
                <button onClick={() => setPage(p => p+1)} disabled={page*30>=total}
                  className="px-3 py-1.5 text-sm bg-gray-800 text-gray-400 rounded-lg disabled:opacity-40 hover:text-white">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
