'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { AdminDashboard } from '@/types'
import { format } from 'date-fns'
import { ghs as n0 } from '@/lib/money'


export default function Dashboard() {
  const [d, setD]        = useState<AdminDashboard | null>(null)
  const [loading, setL]  = useState(true)
  const [busy, setBusy]  = useState(false)
  const [note, setNote]  = useState('')

  const [today, setToday] = useState<any>(null)

  async function load() {
    const { data } = await callFunction<AdminDashboard>('admin-dashboard', { token: getAdminToken()! })
    setD(data); setL(false)
    callFunction<any>('admin-paid-today', { token: getAdminToken()! })
      .then(({ data: a }) => setToday(a?.summary ?? null))
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

  /*
   * The anomaly counts, turned into things somebody can act on. Each entry
   * states the fact, why it matters and where it is resolved. Zeroes are
   * dropped rather than shown as "0 problems", which is noise.
   */
  const an = (d?.anomalies ?? {}) as Record<string, number>
  const attention = ([
    {
      key: 'pending', n: an.pending_over_48h ?? 0, tone: 'bad' as const,
      head: `${n0(an.pending_over_48h)} payments pending over 48 hours`,
      why: `GHS ${n0(an.pending_over_48h_value)} the provider has never confirmed. Until it does, none of it counts as collected.`,
      cta: 'Reconcile', href: '/admin/reconciliation',
    },
    {
      key: 'reg', n: an.approved_registrations_unpaid ?? 0, tone: 'bad' as const,
      head: `${n0(an.approved_registrations_unpaid)} approved registrations unpaid`,
      why: 'These members were let in but their registration fee was never received.',
      cta: 'Registrations', href: '/admin/kyc',
    },
    {
      key: 'sched', n: an.memberships_no_schedule ?? 0, tone: 'warn' as const,
      head: `${n0(an.memberships_no_schedule)} memberships with no schedule`,
      why: 'They owe nothing and are never asked to pay, because their group has not started.',
      cta: 'Groups', href: '/admin/groups',
    },
    {
      key: 'payout', n: an.active_group_memberships_no_payout_date ?? 0, tone: 'warn' as const,
      head: `${n0(an.active_group_memberships_no_payout_date)} slots with no collection date`,
      why: 'These members cannot be told when they collect. The system will not guess a date.',
      cta: 'Payouts', href: '/admin/payouts',
    },
    {
      key: 'alloc', n: an.allocations_vs_unpaid ?? 0, tone: 'bad' as const,
      head: `${n0(an.allocations_vs_unpaid)} payments allocated to unpaid days`,
      why: 'Money was applied to a day that is still marked unpaid. Worth investigating.',
      cta: 'Reconcile', href: '/admin/reconciliation',
    },
  ]).filter(a => a.n > 0)

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

      {/*
        ── WHAT NEEDS ATTENTION ──────────────────────────────────────────────
        admin-dashboard has always returned these counts and this page always
        threw them away: the console showed how much had been collected but not
        that 324 payments had been pending for over two days.

        First on the page, and first on a phone, because it is the only part
        with anything to DO. Each line says what happened, why it matters and
        where to fix it — a number alone tells an administrator nothing they can
        act on.

        Only real counts appear. When every one is zero the section says so
        rather than rendering an empty box.
      */}
      <section aria-labelledby="attention" className="mb-3">
        <h2 id="attention" className="t-label mb-2">Needs attention</h2>

        {attention.length === 0 ? (
          <div className="card p-4">
            <p className="text-sm text-ink-2">Nothing is waiting. Everything reconciles.</p>
          </div>
        ) : (
          <div className="card divide-y divide-line-2 p-0 overflow-hidden">
            {attention.map(a => (
              <Link key={a.key} href={a.href}
                className="flex items-start gap-3 p-4 transition-colors hover:bg-bg
                           focus-visible:outline-none focus-visible:ring-2
                           focus-visible:ring-inset focus-visible:ring-ink/30">
                <span aria-hidden="true"
                  className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${
                    a.tone === 'bad' ? 'bg-red' : 'bg-gold'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-ink">{a.head}</span>
                  <span className="block text-[12px] text-ink-2 mt-0.5 leading-relaxed">{a.why}</span>
                </span>
                <span className="text-[12px] text-ink-3 shrink-0 mt-0.5 whitespace-nowrap">{a.cta} &rarr;</span>
              </Link>
            ))}
          </div>
        )}
      </section>

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
          {stats.remainingToday != null && (
            /* Still to collect today, AFTER part-payments — not the gross
               obligation, which reads as this figure without being it. */
            <p className="text-[11.5px] text-white/55 mt-2 pt-2 border-t border-white/15 tnum">
              GHS {n0(stats.remainingToday)} still to collect today
            </p>
          )}
        </div>
      </div>

      {today && today.expected > 0 && (
        <Link href="/admin/transactions" className="card p-4 mb-3 block hover:border-ink/25 transition-colors">
          <div className="flex items-baseline justify-between mb-2">
            <p className="t-label">Today&rsquo;s collection</p>
            <p className="text-[12px] text-ink-3">see who paid &rarr;</p>
          </div>
          <p className="text-[26px] font-extrabold text-ink tnum">
            {today.paid_count} <span className="text-ink-2 font-semibold text-[18px]">of {today.expected} paid</span>
          </p>
          <div className="h-1.5 bg-line rounded-full overflow-hidden mt-3">
            <div className="h-full bg-ink rounded-full transition-all"
              style={{ width: `${Math.round((today.paid_count / today.expected) * 100)}%` }} />
          </div>
          <p className="text-xs text-ink-2 mt-2">
            GHS {n0(today.received_total)} received today
            {today.unpaid_count > 0 && <> &middot; {today.unpaid_count} still to pay</>}
          </p>
        </Link>
      )}

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
            <div>
              <table className="w-full">
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
            <div>
              <table className="w-full">
              <tbody className="divide-y divide-line">
                {groups.map(g => (
                  <tr key={g.id} className="hover:bg-bg transition-colors">
                    <td className="py-2.5 pr-3">
                      <Link href={`/admin/groups/${g.id}/edit`} className="text-[13px] font-medium hover:underline underline-offset-4">
                        {g.name}
                      </Link>
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
