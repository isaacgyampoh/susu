'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { Member } from '@/types'
import { format } from 'date-fns'
type StatusFilter = 'active' | 'pending' | 'suspended' | 'all'

export default function MembersPage() {
  const router = useRouter()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<StatusFilter>('active')
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(1)
  const [total, setTotal]     = useState(0)
  const [apiError, setApiError] = useState('')

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
    const { data, error } = await callFunction<{ members: Member[]; total: number }>(
      `admin-members?${params}`, { token: token! }
    )
    // Never hide a failure behind "No members found" — say what broke
    setApiError(error ?? '')
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
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Members</h1>
          <p className="text-ink-2 text-sm mt-1">{total} total members</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/members/onboard"
            className="flex items-center gap-2 px-4 py-2.5 border border-line text-ink font-semibold rounded-[10px] text-sm hover:bg-tint transition-colors">
            Onboard Existing
          </Link>
          <Link href="/admin/members/new"
            className="flex items-center gap-2 px-4 py-2.5 bg-ink text-white font-semibold rounded-[10px] text-sm hover:brightness-105 transition-colors">
            Add Member
          </Link>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <input
            className="w-full pl-9 pr-4 py-2.5 bg-tint border border-line text-ink rounded-[10px] text-sm focus:outline-none focus:ring-0 focus:border-ink placeholder-ink-3"
            placeholder="Search by name, phone, or member ID…"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <div className="flex gap-2">
          {(['active','pending','suspended','all'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => { setFilter(s); setPage(1) }}
              className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-colors ${filter === s ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {apiError && (
        <div className="p-3 mb-4 bg-tint border border-red/40 rounded-[10px] text-red text-sm">
          Could not load members: {apiError}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">Loading…</div>
      ) : members.length === 0 ? (
        <div className="text-center py-20 text-ink-2">
          <p>No {filter} members found</p>
          <Link href="/admin/members/new" className="text-ink text-sm hover:underline mt-2 inline-block">Add your first member →</Link>
        </div>
      ) : (
        <div className="border border-line rounded-[10px] overflow-hidden">
          <div className="scroll-x">
            <table className="w-full text-sm min-w-[620px] lg:min-w-0">
            <thead className="border-b border-line">
              <tr className="text-ink-2">
                <th className="px-5 py-3 text-left font-medium">Member</th>
                <th className="px-5 py-3 text-left font-medium hidden sm:table-cell">Member ID</th>
                <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Phone</th>
                <th className="px-5 py-3 text-left font-medium">Groups</th>
                <th className="px-5 py-3 text-left font-medium hidden lg:table-cell">Joined</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map(m => (
                <tr key={m.id} onClick={() => router.push(`/admin/members/${m.id}`)}
                  className="hover:bg-tint transition-colors cursor-pointer">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-[10px] bg-brand-green flex items-center justify-center shrink-0">
                        <span className="text-ink font-bold text-xs">{m.full_name[0]}</span>
                      </div>
                      <div>
                        <p className="text-ink font-medium">{m.full_name}</p>
                        <p className="text-ink-2 text-xs sm:hidden">{m.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-ink-2 font-mono text-xs hidden sm:table-cell">{m.member_id}</td>
                  <td className="px-5 py-4 text-ink-2 hidden md:table-cell">{m.phone}</td>
                  <td className="px-5 py-4">
                    {(((m as any).group_memberships?.[0]?.count) ?? 0) > 0
                      ? <span className="text-ink-2 text-xs">{(m as any).group_memberships[0].count} group{(m as any).group_memberships[0].count > 1 ? 's' : ''}</span>
                      : <span className="badge-red text-[10px]">No group</span>}
                  </td>
                  <td className="px-5 py-4 text-ink-2 hidden lg:table-cell">{m.created_at ? format(new Date(m.created_at), 'MMM d, yyyy') : '—'}</td>
                  <td className="px-5 py-4">{statusBadge(m.status)}</td>
                  <td className="px-5 py-4">
                    <Link href={`/admin/members/${m.id}`} onClick={e => e.stopPropagation()}
                      className="text-ink-2 hover:text-ink text-xs font-medium transition-colors whitespace-nowrap">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>

          {total > 20 && (
            <div className="px-5 py-4 border-t border-line flex items-center justify-between">
              <span className="text-sm text-ink-2">Showing {((page-1)*20)+1}–{Math.min(page*20, total)} of {total}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                  className="px-3 py-1.5 text-sm bg-tint text-ink-2 rounded-lg disabled:opacity-40 hover:text-ink">Prev</button>
                <button onClick={() => setPage(p => p+1)} disabled={page*20 >= total}
                  className="px-3 py-1.5 text-sm bg-tint text-ink-2 rounded-lg disabled:opacity-40 hover:text-ink">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
