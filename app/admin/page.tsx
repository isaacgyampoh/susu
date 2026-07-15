'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { AdminDashboard } from '@/types'
import { format } from 'date-fns'
import { Loader2 } from 'lucide-react'

const n0 = (v: any) => Number(v ?? 0).toLocaleString('en-GH', { maximumFractionDigits: 0 })

export default function AdminHome() {
  const [d, setD]         = useState<AdminDashboard | null>(null)
  const [loading, setL]   = useState(true)
  const [flagging, setF]  = useState(false)
  const [note, setNote]   = useState('')

  async function load() {
    const { data } = await callFunction<AdminDashboard>('admin-dashboard', { token: getAdminToken()! })
    setD(data); setL(false)
  }
  useEffect(() => { load() }, [])

  async function lateCheck() {
    setF(true)
    const { data, error } = await callFunction<any>('flag-late-payments', { method: 'POST', token: getAdminToken()! })
    setF(false)
    setNote(error ? error : `${data?.flagged_count ?? 0} payment${data?.flagged_count === 1 ? '' : 's'} flagged late`)
    setTimeout(() => setNote(''), 4000)
    load()
  }

  if (loading) return <div className="grid place-items-center h-[60vh]"><Loader2 className="animate-spin text-ink-3" size={22} /></div>
  if (!d)      return <div className="p-10 text-center t-meta">Could not load. Check your Supabase setup.</div>

  const { stats, upcomingPayouts, groups } = d

  const figures = [
    { v: n0(stats.totalMembers),         l: 'Members',   href: '/admin/members' },
    { v: n0(stats.activeGroups),         l: 'Groups',    href: '/admin/groups' },
    { v: n0(stats.overdueContributions), l: 'Overdue',   href: '/admin/contributions', alert: stats.overdueContributions > 0 },
    { v: n0(stats.pendingKYC),           l: 'Pending KYC', href: '/admin/kyc' },
  ]

  return (
    <div className="px-6 sm:px-10 py-8 sm:py-10 max-w-[1080px] animate-fade-in">

      <header className="flex items-start justify-between gap-6 flex-wrap mb-9">
        <h1 className="t-display">Dashboard</h1>
        <div className="flex items-center gap-2">
          {note && <span className="t-meta mr-1">{note}</span>}
          <button onClick={lateCheck} disabled={flagging} className="act-quiet act-sm">
            {flagging ? <Loader2 size={13} className="animate-spin" /> : 'Run late check'}
          </button>
          <Link href="/admin/members/new" className="act-primary act-sm">Add member</Link>
        </div>
      </header>

      {/* Figures — no tiles, no icons, no chevrons. Just the numbers. */}
      <section className="rule-hd" />
      <section className="grid grid-cols-2 md:grid-cols-4 divide-x divide-line border-b border-line">
        {figures.map(({ v, l, href, alert }) => (
          <Link key={l} href={href} className="px-5 py-7 first:pl-0 hover:bg-wash transition-colors group">
            <p className={`t-figure ${alert ? 'text-alert' : ''}`}>{v}</p>
            <p className="t-label mt-2 group-hover:text-ink transition-colors">{l}</p>
          </Link>
        ))}
      </section>

      {/* The one number that matters most gets the accent */}
      <section className="py-8 border-b border-line flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p className="t-label">Total collected</p>
          <p className="text-[40px] font-extrabold tracking-[-.03em] leading-none tnum mt-2">
            <span className="text-[17px] align-[.4em] mr-1 font-bold text-ink-2">GHS</span>
            {n0(stats.totalCollected)}
          </p>
        </div>
        <span className="w-16 h-1 bg-accent mb-2" />
      </section>

      {/* Upcoming payouts */}
      <section className="py-9">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="t-label !text-ink">Upcoming payouts — next 7 days</h2>
          <Link href="/admin/payouts" className="t-meta hover:text-ink transition-colors">All payouts</Link>
        </div>

        {!upcomingPayouts?.length ? (
          <p className="t-meta py-6">Nothing due in the next 7 days.</p>
        ) : (
          <table className="w-full">
            <tbody className="divide-y divide-line border-y border-line">
              {upcomingPayouts.map(p => (
                <tr key={p.id} className="hover:bg-wash transition-colors">
                  <td className="py-3.5 pr-4">
                    <p className="text-[14px] font-semibold">{p.members?.full_name}</p>
                    <p className="t-meta">{p.members?.member_id}</p>
                  </td>
                  <td className="py-3.5 px-4 t-meta hidden sm:table-cell">{p.susu_groups?.name}</td>
                  <td className="py-3.5 px-4 t-meta whitespace-nowrap">{format(new Date(p.scheduled_date), 'd MMM')}</td>
                  <td className="py-3.5 pl-4 text-right text-[15px] font-bold tnum whitespace-nowrap">
                    {n0(p.total_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Groups */}
      <section className="pb-12">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="t-label !text-ink">Groups</h2>
          <Link href="/admin/groups/new" className="t-meta hover:text-ink transition-colors">New group</Link>
        </div>

        {!groups?.length ? (
          <div className="py-10 border-y border-line text-center">
            <p className="t-meta">No groups yet.</p>
            <Link href="/admin/groups/new" className="act-accent act-sm mt-4">Create your first group</Link>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-ink">
                <th className="t-label text-left pb-2.5">Group</th>
                <th className="t-label text-left pb-2.5 hidden sm:table-cell">Daily</th>
                <th className="t-label text-left pb-2.5 hidden md:table-cell">Cashout</th>
                <th className="t-label text-left pb-2.5">Members</th>
                <th className="t-label text-right pb-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-b border-line">
              {groups.map(g => (
                <tr key={g.id} className="hover:bg-wash transition-colors">
                  <td className="py-3.5 pr-4 text-[14px] font-semibold">{g.name}</td>
                  <td className="py-3.5 pr-4 t-meta tnum hidden sm:table-cell">{n0(g.contribution_amount)}</td>
                  <td className="py-3.5 pr-4 text-[13px] font-semibold tnum hidden md:table-cell">
                    {g.cashout_amount ? n0(g.cashout_amount) : '—'}
                  </td>
                  <td className="py-3.5 pr-4 t-meta tnum">{g.current_members}/{g.max_members}</td>
                  <td className="py-3.5 text-right">
                    <span className={g.status === 'active' ? 'st-on' : 'st-off'}>{g.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
