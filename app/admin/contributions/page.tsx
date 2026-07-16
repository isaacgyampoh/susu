'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { Contribution, SusuGroup } from '@/types'
import { format } from 'date-fns'
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

  function statusBadge(s: string) {
    if (s === 'paid')    return <span className="badge-green">Paid</span>
    if (s === 'overdue') return <span className="badge-red">Overdue</span>
    return <span className="badge-gold">Pending</span>
  }

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink">Contributions</h1>
        <p className="text-ink-2 text-sm mt-1">{total} total records</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex gap-2 flex-wrap">
          {(['pending','paid','overdue','all'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>
              {s}
            </button>
          ))}
        </div>
        <select
          className="px-3 py-1.5 bg-tint border border-line text-ink text-sm rounded-lg focus:outline-none focus:ring-0 focus:border-ink"
          value={groupFilter} onChange={e => { setGroupFilter(e.target.value); setPage(1) }}>
          <option value="all">All Groups</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">Loading…</div>
      ) : contributions.length === 0 ? (
        <div className="text-center py-20 text-ink-2">No contributions found</div>
      ) : (
        <div className="border border-line rounded-[10px] overflow-hidden">
          <div className="scroll-x">
            <table className="w-full text-sm min-w-[620px] lg:min-w-0">
            <thead className="border-b border-line">
              <tr className="text-ink-2">
                <th className="px-5 py-3 text-left font-medium">Member</th>
                <th className="px-5 py-3 text-left font-medium hidden sm:table-cell">Group</th>
                <th className="px-5 py-3 text-left font-medium">Due Date</th>
                <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Paid On</th>
                <th className="px-5 py-3 text-left font-medium">Amount</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {contributions.map(c => (
                <tr key={c.id} className="hover:bg-tint transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="text-ink font-medium text-xs">{(c as any).members?.full_name}</p>
                        <p className="text-ink-2 text-xs font-mono">{(c as any).members?.member_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-ink-2 hidden sm:table-cell text-xs">{c.susu_groups?.name}</td>
                  <td className="px-5 py-3.5 text-ink text-xs">{format(new Date(c.due_date), 'MMM d, yyyy')}</td>
                  <td className="px-5 py-3.5 text-ink-2 text-xs hidden md:table-cell">
                    {c.paid_at ? format(new Date(c.paid_at), 'MMM d, HH:mm') : '—'}
                  </td>
                  <td className="px-5 py-3.5 text-ink font-semibold">GHS {Number(c.amount).toFixed(2)}</td>
                  <td className="px-5 py-3.5">{statusBadge(c.status)}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>

          {total > 30 && (
            <div className="px-5 py-4 border-t border-line flex items-center justify-between">
              <span className="text-sm text-ink-2">Page {page} · {total} records</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                  className="px-3 py-1.5 text-sm bg-tint text-ink-2 rounded-lg disabled:opacity-40 hover:text-ink">Prev</button>
                <button onClick={() => setPage(p => p+1)} disabled={page*30>=total}
                  className="px-3 py-1.5 text-sm bg-tint text-ink-2 rounded-lg disabled:opacity-40 hover:text-ink">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
