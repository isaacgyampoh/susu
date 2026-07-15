'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { AdminDashboard } from '@/types'
import { format } from 'date-fns'
const n0 = (v: any) => Number(v ?? 0).toLocaleString('en-GH', { maximumFractionDigits: 0 })

export default function AdminHome() {
  const [d, setD]        = useState<AdminDashboard | null>(null)
  const [loading, setL]  = useState(true)
  const [flagging, setF] = useState(false)
  const [note, setNote]  = useState('')

  async function load() {
    const { data } = await callFunction<AdminDashboard>('admin-dashboard', { token: getAdminToken()! })
    setD(data); setL(false)
  }
  useEffect(() => { load() }, [])

  async function lateCheck() {
    setF(true)
    const { data, error } = await callFunction<any>('flag-late-payments', { method: 'POST', token: getAdminToken()! })
    setF(false)
    setNote(error ?? `${data?.flagged_count ?? 0} payment${data?.flagged_count === 1 ? '' : 's'} flagged`)
    setTimeout(() => setNote(''), 4000)
    load()
  }

  if (loading) return <div className="grid place-items-center h-[70vh]">'…'</div>
  if (!d)      return <div className="p-10 text-center t-meta">Could not load. Check your Supabase setup.</div>

  const { stats, upcomingPayouts, groups } = d
  const cards = [
    { v: n0(stats.totalMembers),         l: 'Members',       href: '/admin/members' },
    { v: n0(stats.activeGroups),         l: 'Groups',      href: '/admin/groups' },
    { v: n0(stats.overdueContributions), l: 'Overdue', href: '/admin/contributions', alert: stats.overdueContributions > 0 },
    { v: n0(stats.pendingKYC),           l: 'Pending KYC', href: '/admin/kyc' },
  ]

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <header className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="t-h1">Dashboard</h1>
          <p className="t-meta mt-1">Overview of your susu platform</p>
        </div>
        <div className="flex items-center gap-2">
          {note && <span className="t-meta">{note}</span>}
          <button onClick={lateCheck} disabled={flagging} className="act-quiet act-sm">
            {flagging ? '…' : <>Run late check</>}
          </button>
        </div>
      </header>

      {/* Collected — the hero figure */}
      <div className="panel p-6 bg-blue border-blue mb-4">
        <p className="text-[12px] font-semibold text-white/60">Total collected</p>
        <p className="text-[38px] font-extrabold tracking-[-.03em] text-white leading-none mt-1.5 tnum">
          <span className="text-[17px] align-[.4em] mr-1 text-white">GHS</span>{n0(stats.totalCollected)}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
        {cards.map(({ v, l, href, alert }) => (
          <Link key={l} href={href} className="panel p-4 hover:border-blue transition-colors group">
            <p className={`text-[22px] font-extrabold tnum ${alert ? 'text-red' : ''}`}>{v}</p>
            <p className="t-meta mt-0.5 group-hover:text-blue transition-colors">{l}</p>
          </Link>
        ))}
      </div>

      <div className="panel p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="t-h2">Upcoming payouts — next 7 days</p>
          <Link href="/admin/payouts" className="t-meta font-semibold hover:text-blue transition-colors flex items-center gap-0.5">
            All </Link>
        </div>
        {!upcomingPayouts?.length ? (
          <p className="t-meta py-4">Nothing due in the next 7 days.</p>
        ) : (
          <div className="divide-y divide-line">
            {upcomingPayouts.map(p => (
              <div key={p.id} className="flex items-center justify-between py-3 gap-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold truncate">{p.members?.full_name}</p>
                  <p className="t-meta">{p.members?.member_id} · {p.susu_groups?.name}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[14px] font-bold tnum">GHS {n0(p.total_amount)}</p>
                  <p className="t-meta">{format(new Date(p.scheduled_date), 'd MMM')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="t-h2">Groups</p>
          <Link href="/admin/groups/new" className="act-soft act-sm">New group</Link>
        </div>
        {!groups?.length ? (
          <div className="py-8 text-center">
            <p className="t-meta">No groups yet.</p>
            <Link href="/admin/groups/new" className="act-primary act-sm mt-3">Create your first group</Link>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {groups.map(g => (
              <div key={g.id} className="flex items-center justify-between py-3 gap-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold truncate">{g.name}</p>
                  <p className="t-meta">
                    GHS {n0(g.contribution_amount)} {g.contribution_frequency} · {g.current_members}/{g.max_members} members
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {g.cashout_amount ? <p className="text-[13.5px] font-bold tnum">GHS {n0(g.cashout_amount)}</p> : null}
                  <span className={g.status === 'active' ? 'pill-on' : g.status === 'full' ? 'pill-wait' : 'pill-off'}>{g.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}