'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { format } from 'date-fns'

/*
 * Group roster — every slot in this group and who holds it, plus the OTHER
 * groups each member belongs to, so one person can be tracked across the
 * whole operation from a single screen.
 */

const n0 = (v: any) => Number(v ?? 0).toLocaleString('en-GH')

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [group, setGroup]     = useState<any>(null)
  const [roster, setRoster]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')
  const [q, setQ]             = useState('')

  useEffect(() => {
    const token = getAdminToken()
    callFunction<{ group: any; roster: any[] }>(`groups-create?id=${id}`, { token: token! })
      .then(({ data, error }) => {
        setErr(error ?? '')
        setGroup(data?.group ?? null)
        setRoster(data?.roster ?? [])
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="px-5 sm:px-8 lg:px-10 py-7">Loading…</div>
  if (err || !group) return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 text-ink-2">
      {err ? `Could not load group: ${err}` : 'Group not found.'}{' '}
      <Link href="/admin/groups" className="text-ink underline">Back to groups</Link>
    </div>
  )

  // Group rows by member so multi-slot holders read as one person
  const byMember = new Map<string, { member: any; slots: any[]; other: any[] }>()
  for (const r of roster) {
    const mid = r.members?.id ?? r.id
    if (!byMember.has(mid)) byMember.set(mid, { member: r.members, slots: [], other: r.other_groups ?? [] })
    byMember.get(mid)!.slots.push(r)
  }
  let people = Array.from(byMember.values())

  const needle = q.trim().toLowerCase()
  if (needle) people = people.filter(p =>
    p.member?.full_name?.toLowerCase().includes(needle) ||
    p.member?.member_id?.toLowerCase().includes(needle) ||
    p.member?.phone?.includes(needle))

  const activeSlots = roster.filter(r => r.status === 'active').length

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <Link href="/admin/groups" className="text-ink-2 hover:text-ink text-sm transition-colors">Back to Groups</Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mt-4 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">{group.name}</h1>
          <p className="text-ink-2 text-sm mt-1">
            {activeSlots}/{group.max_members} slots filled · {byMember.size} member{byMember.size === 1 ? '' : 's'} ·
            GHS {n0(group.contribution_amount)}/{group.contribution_frequency} · {group.status}
          </p>
        </div>
        <Link href={`/admin/groups/${id}/edit`}
          className="px-4 py-2.5 border border-line text-ink font-semibold rounded-[10px] text-sm hover:bg-tint transition-colors">
          Edit group
        </Link>
      </div>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search this group by name, ID or phone…"
        className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] mb-5 focus:outline-none focus:border-ink" />

      {people.length === 0 ? (
        <div className="border border-line rounded-[10px] p-10 text-center text-ink-2">
          {roster.length === 0 ? 'No members in this group yet.' : 'No members match your search.'}
        </div>
      ) : (
        <div className="border border-line rounded-[10px] overflow-hidden">
          <div className="scroll-x">
            <table className="w-full text-sm min-w-[720px] lg:min-w-0">
              <thead className="border-b border-line">
                <tr className="text-ink-2 text-left">
                  <th className="px-5 py-3 font-medium">Member</th>
                  <th className="px-5 py-3 font-medium">In this group</th>
                  <th className="px-5 py-3 font-medium">Payout</th>
                  <th className="px-5 py-3 font-medium">Also in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {people.map(({ member, slots, other }) => (
                  <tr key={member?.id ?? Math.random()} className="hover:bg-tint transition-colors align-top">
                    <td className="px-5 py-4">
                      <Link href={`/admin/members/${member?.id}`} className="font-medium text-ink hover:underline underline-offset-2">
                        {member?.full_name ?? '—'}
                      </Link>
                      <p className="text-xs text-ink-2 mt-0.5">{member?.member_id} · {member?.phone}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-ink font-medium">{slots.length} slot{slots.length > 1 ? 's' : ''}</span>
                      <p className="text-xs text-ink-2 mt-0.5">
                        {slots.map((s: any) => `#${s.payout_position}`).join(', ')}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      {slots.map((s: any) => (
                        <div key={s.id} className="text-xs mb-1 last:mb-0">
                          <span className="text-ink-2">#{s.payout_position}: </span>
                          {s.payout_received
                            ? <span className="text-green">received</span>
                            : s.payout_date
                              ? <span className="text-ink">{format(new Date(s.payout_date), 'MMM d, yyyy')} · GHS {n0(s.payout_amount)}</span>
                              : <span className="text-gold">no date set</span>}
                        </div>
                      ))}
                    </td>
                    <td className="px-5 py-4">
                      {other.length === 0 ? (
                        <span className="text-xs text-ink-3">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {other.map((o: any) => (
                            <Link key={o.id} href={`/admin/groups/${o.id}`}
                              className="inline-flex items-center px-2 py-0.5 bg-tint border border-line rounded-full text-[11px] text-ink hover:border-ink transition-colors">
                              {o.name}{o.slots > 1 ? ` ×${o.slots}` : ''}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
