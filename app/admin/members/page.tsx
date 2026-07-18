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
  const [invOpen, setInvOpen]   = useState(false)
  const [invCounts, setInvCounts] = useState<{ total_active: number; uninvited: number } | null>(null)
  const [invScope, setInvScope] = useState<'uninvited' | 'all'>('uninvited')
  const [invSending, setInvSending] = useState(false)
  const [invResult, setInvResult]   = useState<any>(null)
  const [wipeOpen, setWipeOpen]     = useState(false)
  const [wipeText, setWipeText]     = useState('')
  const [wiping, setWiping]         = useState(false)

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
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={async () => {
              setInvOpen(true); setInvResult(null); setInvCounts(null); setInvScope('uninvited')
              const token = getAdminToken()
              const { data, error } = await callFunction<{ total_active: number; uninvited: number }>('admin-send-invites', { token: token! })
              if (error) { setApiError(error); setInvOpen(false); return }
              setInvCounts(data!)
            }}
            className="flex items-center gap-2 px-4 py-2.5 border border-line text-ink font-semibold rounded-[10px] text-sm hover:bg-tint transition-colors">
            Send Invites
          </button>
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

      {total > 0 && (
        <div className="mt-10 pt-6 border-t border-line">
          <button onClick={() => { setWipeOpen(true); setWipeText('') }}
            className="text-xs text-red/70 hover:text-red underline underline-offset-2 transition-colors">
            Start fresh — delete ALL members from the system
          </button>
        </div>
      )}

      {/* Fresh start modal */}
      {wipeOpen && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => !wiping && setWipeOpen(false)}>
          <div className="bg-white shadow-xl border border-line rounded-[10px] w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="font-bold text-red text-lg">Delete ALL members?</h2>
              <p className="text-ink-2 text-sm mt-1.5 leading-relaxed">
                This erases <strong className="text-ink">every member</strong> in the system — those who have paid and those who haven't — along with
                all their contributions, payouts, transactions and messages. <strong className="text-ink">Your groups are kept</strong> and
                re-opened, ready to be filled again. This cannot be undone.
              </p>
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">
                Type <span className="font-mono font-semibold text-ink">DELETE ALL MEMBERS</span> to confirm
              </label>
              <input autoFocus value={wipeText} onChange={e => setWipeText(e.target.value)}
                placeholder="DELETE ALL MEMBERS"
                className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] font-mono text-sm focus:outline-none focus:border-red" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setWipeOpen(false)} disabled={wiping}
                className="flex-1 py-3 border border-line text-ink font-semibold rounded-[10px] hover:bg-tint transition-colors">Cancel</button>
              <button
                onClick={async () => {
                  setWiping(true)
                  const token = getAdminToken()
                  const { data, error } = await callFunction<any>('admin-members?all=true', {
                    method: 'DELETE', token: token!, body: { confirm: 'DELETE ALL MEMBERS' },
                  })
                  setWiping(false)
                  if (error) { alert(error); return }
                  setWipeOpen(false)
                  alert(data?.message ?? 'All members deleted.')
                  load()
                }}
                disabled={wiping || wipeText.trim() !== 'DELETE ALL MEMBERS'}
                className="flex-1 py-3 bg-red text-white font-semibold rounded-[10px] hover:brightness-105 transition-colors disabled:opacity-40">
                {wiping ? 'Deleting…' : `Delete all ${total}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Invites modal */}
      {invOpen && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => !invSending && setInvOpen(false)}>
          <div className="bg-white shadow-xl border border-line rounded-[10px] w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="font-bold text-ink text-lg">Send portal invites</h2>
              <p className="text-ink-2 text-sm mt-1">
                Each invite issues a fresh passcode and texts the member their sign-in link, member ID and passcode. They can change it to their own PIN inside the portal.
              </p>
            </div>

            {invResult ? (
              <>
                <div className="p-3 bg-tint border border-line rounded-[10px] text-sm">
                  <p className="font-semibold text-ink">{invResult.message}</p>
                  {invResult.failed?.map((f: any, i: number) => (
                    <p key={i} className="text-xs text-red mt-1">{f.member}: {f.reason}</p>
                  ))}
                </div>
                <button onClick={() => { setInvOpen(false); load() }}
                  className="w-full py-3 bg-ink text-white font-semibold rounded-[10px]">Done</button>
              </>
            ) : !invCounts ? (
              <p className="text-sm text-ink-3 py-4 text-center">Loading…</p>
            ) : (
              <>
                <div className="space-y-2">
                  <label className={`flex items-start gap-2.5 p-3 border rounded-[10px] cursor-pointer ${invScope === 'uninvited' ? 'border-ink bg-tint' : 'border-line'}`}>
                    <input type="radio" name="invscope" checked={invScope === 'uninvited'} onChange={() => setInvScope('uninvited')} className="mt-1 accent-green" />
                    <span className="text-sm text-ink">
                      <strong>Members not yet invited ({invCounts.uninvited})</strong>
                      <span className="block text-xs text-ink-3 mt-0.5">The normal choice — sends to everyone still waiting.</span>
                    </span>
                  </label>
                  <label className={`flex items-start gap-2.5 p-3 border rounded-[10px] cursor-pointer ${invScope === 'all' ? 'border-ink bg-tint' : 'border-line'}`}>
                    <input type="radio" name="invscope" checked={invScope === 'all'} onChange={() => setInvScope('all')} className="mt-1 accent-green" />
                    <span className="text-sm text-ink">
                      <strong>All active members ({invCounts.total_active})</strong>
                      <span className="block text-xs text-red mt-0.5">Re-issues a NEW passcode for everyone — anyone's current passcode (including PINs they set themselves) stops working.</span>
                    </span>
                  </label>
                </div>
                <button
                  onClick={async () => {
                    setInvSending(true)
                    const token = getAdminToken()
                    const { data, error } = await callFunction<any>('admin-send-invites', {
                      method: 'POST', token: token!, body: { scope: invScope },
                    })
                    setInvSending(false)
                    if (error) { alert(error); return }
                    setInvResult(data)
                  }}
                  disabled={invSending || (invScope === 'uninvited' && invCounts.uninvited === 0)}
                  className="w-full py-3.5 bg-ink text-white font-bold rounded-[10px] disabled:opacity-50">
                  {invSending ? 'Sending…'
                    : invScope === 'uninvited'
                      ? (invCounts.uninvited === 0 ? 'Everyone is already invited' : `Send ${invCounts.uninvited} invite${invCounts.uninvited === 1 ? '' : 's'}`)
                      : `Re-issue & send to all ${invCounts.total_active}`}
                </button>
                <button onClick={() => setInvOpen(false)} className="w-full text-ink-2 text-sm hover:text-ink py-1">Cancel</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
