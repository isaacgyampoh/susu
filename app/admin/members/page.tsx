'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { Member } from '@/types'
import { format } from 'date-fns'
import { Loader2, Search, Users, ChevronRight } from 'lucide-react'

type StatusFilter = 'active' | 'pending' | 'suspended' | 'all'

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<StatusFilter>('active')
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(1)
  const [total, setTotal]     = useState(0)

  useEffect(() => {
    const t = setTimeout(() => load(), search ? 400 : 0)
    return () => clearTimeout(t)
  }, [filter, search, page])

  async function load() {
    setLoading(true)
    const token = getAdminToken()
    const params = new URLSearchParams({
      status: filter,
      page:   String(page),
      ...(search ? { search } : {}),
    })
    const { data } = await callFunction<{ members: Member[]; total: number }>(
      `admin-members?${params}`, { token: token! }
    )
    setMembers(data?.members ?? [])
    setTotal(data?.total ?? 0)
    setLoading(false)
  }

  function statusBadge(s: string) {
    if (s === 'active')    return <span className="badge-green">Active</span>
    if (s === 'suspended') return <span className="badge-red">Suspended</span>
    if (s === 'pending')   return <span className="badge-gold">Pending</span>
    return <span className="badge-gray">{s}</span>
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto pb-12 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Members</h1>
          <p className="text-gray-400 text-sm mt-1">{total} total members</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 text-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold placeholder-gray-500"
            placeholder="Search by name, phone, or member ID…"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <div className="flex gap-2">
          {(['active','pending','suspended','all'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => { setFilter(s); setPage(1) }}
              className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-colors ${filter === s ? 'bg-brand-gold text-brand-green' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-gold" size={32} /></div>
      ) : members.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          No {filter} members found
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-800">
              <tr className="text-gray-500">
                <th className="px-5 py-3 text-left font-medium">Member</th>
                <th className="px-5 py-3 text-left font-medium hidden sm:table-cell">Member ID</th>
                <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Phone</th>
                <th className="px-5 py-3 text-left font-medium hidden lg:table-cell">Joined</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {members.map(m => (
                <tr key={m.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-green flex items-center justify-center shrink-0">
                        <span className="text-white font-bold text-xs">{m.full_name[0]}</span>
                      </div>
                      <div>
                        <p className="text-white font-medium">{m.full_name}</p>
                        <p className="text-gray-500 text-xs sm:hidden">{m.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-gray-400 font-mono text-xs hidden sm:table-cell">{m.member_id}</td>
                  <td className="px-5 py-4 text-gray-400 hidden md:table-cell">{m.phone}</td>
                  <td className="px-5 py-4 text-gray-400 hidden lg:table-cell">{format(new Date(m.created_at), 'MMM d, yyyy')}</td>
                  <td className="px-5 py-4">{statusBadge(m.status)}</td>
                  <td className="px-5 py-4">
                    <Link href={`/admin/members/${m.id}`} className="text-gray-400 hover:text-white transition-colors">
                      <ChevronRight size={18} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {total > 20 && (
            <div className="px-5 py-4 border-t border-gray-800 flex items-center justify-between">
              <span className="text-sm text-gray-500">Showing {((page-1)*20)+1}–{Math.min(page*20, total)} of {total}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                  className="px-3 py-1.5 text-sm bg-gray-800 text-gray-400 rounded-lg disabled:opacity-40 hover:text-white">Prev</button>
                <button onClick={() => setPage(p => p+1)} disabled={page*20 >= total}
                  className="px-3 py-1.5 text-sm bg-gray-800 text-gray-400 rounded-lg disabled:opacity-40 hover:text-white">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
