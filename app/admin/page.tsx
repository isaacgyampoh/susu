'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { AdminDashboard } from '@/types'
import { format } from 'date-fns'

const n0 = (v: any) => Number(v ?? 0).toLocaleString('en-GH', { maximumFractionDigits: 0 })

export default function Dashboard() {
  const [d, setD]        = useState<AdminDashboard | null>(null)
  const [loading, setL]  = useState(true)
  const [busy, setBusy]  = useState(false)
  const [note, setNote]  = useState('')

  async function load() {
    const { data } = await callFunction<AdminDashboard>('admin-dashboard', { token: getAdminToken()! })
    setD(data); setL(false)
  }
  useEffect(() => { load() }, [])

  async function lateCheck() {
    setBusy(true)
    const { data, error } = await callFunction<any>('flag-late-payments', { method: 'POST', token: getAdminToken()! })
    setBusy(false)
    setNote(error ?? `${data?.flagged_count ?? 0} flagged late`)
    setTimeout(() => setNote(''), 4000)
    load()
  }

  if (loading) return <div className="p-10 text-[13px] text-ink-3">Loading…</div>
  if (!d)      return <div className="p-10 text-[13px] text-ink-3">Could not load. Check your Supabase setup.</div>

  const { stats, upcomingPayouts, groups } = d

  const figures = [
    { v: n0(stats.totalMembers),         l: 'Active members', href: '/admin/members' },
    { v: n0(stats.activeGroups),         l: 'Active groups',  href: '/admin/groups' },
    { v: n0(stats.overdueContributions), l: 'Overdue',        href: '/admin/contributions', warn: stats.overdueContributions > 0 },
    { v: n0(stats.pendingKYC),           l: 'Applications',   href: '/admin/kyc' },
  ]

  return (
    <div className="px-5 sm:px-8 py-7 pb-16 animate-fade-in">
      <header className="flex items-start justify-between gap-4 flex-wrap mb-7">
        <div>
          <h1 className="t-title">Dashboard</h1>
          <p className="t-meta mt-1">Overview of members, contributions and payouts.</p>
        </div>
        <div className="flex items-center gap-2">
          {note && <span className="text-[12px] text-ink-2 mr-1">{note}</span>}
          <button onClick={lateCheck} disabled={busy} className="btn-line btn-sm">
            {busy ? 'Checking…' : 'Run late check'}
          </button>
          <Link href="/admin/members/new" className="btn-dark btn-sm">Add member</Link>
        </div>
      </header>

      {/* Figures */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
        {figures.map(({ v, l, href, warn }) => (
          <Link key={l} href={href} className="card p-4 hover:border-ink/25 transition-colors">
            <p className={`t-figure ${warn ? 'text-red' : ''}`}>{v}</p>
            <p className="t-label mt-1.5">{l}</p>
          </Link>
        ))}
        <div className="card p-4 bg-ink border-ink col-span-2 lg:col-span-1">
          <p className="text-[26px] font-semibold tracking-[-.02em] leading-none tnum text-white">
            <span className="text-[13px] align-[.35em] mr-0.5 text-white/60">GHS</span>{n0(stats.totalCollected)}
          </p>
          <p className="text-[12px] font-medium text-white/60 mt-1.5">Total collected</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {/* Payouts */}
        <section className="card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="t-h2">Upcoming payouts</h2>
            <Link href="/admin/payouts" className="text-[12px] font-medium text-ink-2 hover:text-ink transition-colors">View all</Link>
          </div>
          {!upcomingPayouts?.length ? (
            <p className="text-[12.5px] text-ink-3 py-5">Nothing due in the next 7 days.</p>
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[560px] lg:min-w-0">
              <tbody className="divide-y divide-line">
                {upcomingPayouts.map(p => (
                  <tr key={p.id}>
                    <td className="py-2.5 pr-3">
                      <p className="text-[13px] font-medium">{p.members?.full_name}</p>
                      <p className="text-[11.5px] text-ink-3">{p.members?.member_id} · {p.susu_groups?.name}</p>
                    </td>
                    <td className="py-2.5 pr-3 text-[12px] text-ink-2 whitespace-nowrap">{format(new Date(p.scheduled_date), 'd MMM')}</td>
                    <td className="py-2.5 text-right text-[13px] font-medium tnum whitespace-nowrap">{n0(p.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Groups */}
        <section className="card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="t-h2">Groups</h2>
            <Link href="/admin/groups/new" className="text-[12px] font-medium text-ink-2 hover:text-ink transition-colors">New group</Link>
          </div>
          {!groups?.length ? (
            <div className="py-5">
              <p className="text-[12.5px] text-ink-3">No groups yet.</p>
              <Link href="/admin/groups/new" className="btn-dark btn-sm mt-3">Create your first group</Link>
            </div>
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[560px] lg:min-w-0">
              <tbody className="divide-y divide-line">
                {groups.map(g => (
                  <tr key={g.id}>
                    <td className="py-2.5 pr-3">
                      <p className="text-[13px] font-medium">{g.name}</p>
                      <p className="text-[11.5px] text-ink-3 tnum">
                        GHS {n0(g.contribution_amount)} {g.contribution_frequency} · {g.current_members}/{g.max_members} members
                      </p>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[13px] font-medium tnum whitespace-nowrap">
                      {g.cashout_amount ? n0(g.cashout_amount) : '—'}
                    </td>
                    <td className="py-2.5 text-right">
                      <span className={g.status === 'active' ? 'pill-on' : 'pill-off'}>{g.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
