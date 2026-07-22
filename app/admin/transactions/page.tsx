'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { format } from 'date-fns'

/*
 * The day's collection roll-call.
 *
 * Pick a day: everyone who was due to pay it appears — those who have paid,
 * then those who have not. Read straight from our own records, so it says
 * the same thing tomorrow as it does now.
 */
const n2 = (v: unknown) =>
  Number(v ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const todayISO = () => new Date().toISOString().slice(0, 10)
const shiftDay = (d: string, n: number) => {
  const dt = new Date(d + 'T12:00:00Z')
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
const prettyDay = (d: string) => {
  if (d === todayISO()) return 'Today'
  if (d === shiftDay(todayISO(), -1)) return 'Yesterday'
  return format(new Date(d + 'T12:00:00Z'), 'EEEE, d MMMM')
}

export default function DailyPaymentsPage() {
  const [day, setDay]         = useState(todayISO())
  const [paid, setPaid]       = useState<any[]>([])
  const [unpaid, setUnpaid]   = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState('')
  const [busyId, setBusyId]   = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await callFunction<any>(`admin-paid-today?date=${day}`, { token: getAdminToken()! })
    setPaid(data?.paid ?? [])
    setUnpaid(data?.unpaid ?? [])
    setSummary(data?.summary ?? null)
    setLoading(false)
  }
  useEffect(() => { load() }, [day])

  async function undoPayment(r: any) {
    const ok = confirm(
      `Mark ${r.name}'s GHS ${n2(r.amount)} for ${day} as NOT paid?\n\n` +
      `Use this when money was recorded that never actually arrived. ` +
      `The day goes back to unpaid and the reversal is written to the audit log.`)
    if (!ok) return
    const reason = prompt('Reason (optional) — e.g. "never completed at NaloPay"') ?? undefined
    setBusyId(r.contribution_id)
    const { error } = await callFunction<any>('admin-undo-payment', {
      method: 'POST', token: getAdminToken()!,
      body: { contribution_id: r.contribution_id, reason },
    })
    setBusyId(null)
    if (error) { alert(error); return }
    load()
  }

  const match = (r: any) =>
    !q.trim() ||
    r.name?.toLowerCase().includes(q.toLowerCase()) ||
    r.code?.toLowerCase().includes(q.toLowerCase()) ||
    r.group?.toLowerCase().includes(q.toLowerCase())

  const paidShown   = paid.filter(match)
  const unpaidShown = unpaid.filter(match)

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-ink">Daily Payments</h1>
        <p className="text-ink-2 text-sm mt-1">
          Who was due to pay on a day, and who has paid.
        </p>
      </div>

      {/* Day picker */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button onClick={() => setDay(todayISO())}
          className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors ${day === todayISO() ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>
          Today
        </button>
        <button onClick={() => setDay(shiftDay(todayISO(), -1))}
          className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors ${day === shiftDay(todayISO(), -1) ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>
          Yesterday
        </button>
        <div className="flex items-center gap-1">
          <button onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day"
            className="px-2.5 py-1.5 rounded-[8px] bg-tint text-ink-2 hover:text-ink text-xs font-semibold">←</button>
          <input type="date" value={day} max={todayISO()} onChange={e => e.target.value && setDay(e.target.value)}
            className="px-2.5 py-1.5 bg-tint border border-line rounded-[8px] text-xs font-semibold text-ink focus:outline-none focus:border-ink" />
          <button onClick={() => setDay(shiftDay(day, 1))} disabled={day >= todayISO()} aria-label="Next day"
            className="px-2.5 py-1.5 rounded-[8px] bg-tint text-ink-2 hover:text-ink text-xs font-semibold disabled:opacity-30">→</button>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a member…"
          className="ml-auto px-3 py-1.5 bg-tint border border-line rounded-[8px] text-xs text-ink w-full sm:w-56 focus:outline-none focus:border-ink" />
      </div>

      {/* The day at a glance */}
      {summary && (
        <div className="card p-4 mb-5">
          <p className="t-label">{prettyDay(day)}</p>
          {summary.expected === 0 ? (
            <p className="text-ink-2 text-sm mt-2">Nobody was due to pay on this day.</p>
          ) : (
            <>
              <p className="text-[26px] font-extrabold text-ink mt-1 tnum">
                {summary.paid_count} <span className="text-ink-2 font-semibold text-[18px]">of {summary.expected} paid</span>
              </p>
              <div className="h-1.5 bg-line rounded-full overflow-hidden mt-3">
                <div className="h-full bg-ink rounded-full transition-all"
                  style={{ width: `${Math.round((summary.paid_count / summary.expected) * 100)}%` }} />
              </div>
              <div className="text-xs text-ink-2 mt-2 space-y-0.5">
                <p>
                  <span className="font-semibold text-ink">GHS {n2(summary.collected_app)}</span> paid in the app
                  <span className="text-ink-3"> — this is the figure to compare with NaloPay</span>
                </p>
                <p>
                  <span className="font-semibold text-ink">GHS {n2(summary.collected_recorded)}</span> recorded by an admin
                  <span className="text-ink-3"> — cash or MoMo collected directly, never passes through NaloPay</span>
                </p>
                {summary.unpaid_count > 0 && (
                  <p className="text-ink-3">GHS {n2(summary.outstanding)} still outstanding</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-ink-3 text-sm py-10 text-center">Loading…</p>
      ) : (
        <>
          {/* PAID */}
          {paidShown.length > 0 && (
            <div className="border border-line rounded-[10px] overflow-hidden mb-5">
              <div className="px-5 py-3 border-b border-line bg-tint">
                <p className="font-semibold text-ink text-sm">Paid · {paidShown.length}</p>
              </div>
              <div className="scroll-x">
                <table className="w-full text-sm min-w-[600px] lg:min-w-0">
                  <thead className="border-b border-line">
                    <tr className="text-ink-2 text-left">
                      <th className="px-5 py-3 font-medium">Member</th>
                      <th className="px-5 py-3 font-medium">Group</th>
                      <th className="px-5 py-3 font-medium">Amount</th>
                      <th className="px-5 py-3 font-medium">How</th>
                      <th className="px-5 py-3 font-medium">When</th>
                      <th className="px-5 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {paidShown.map(r => (
                      <tr key={r.contribution_id} className="hover:bg-tint transition-colors">
                        <td className="px-5 py-3.5">
                          <Link href={`/admin/members/${r.member_id}`}
                            className="font-medium text-ink hover:underline underline-offset-2">{r.name}</Link>
                          <p className="text-[11px] text-ink-3">{r.code}</p>
                        </td>
                        <td className="px-5 py-3.5 text-ink-2">{r.group}</td>
                        <td className="px-5 py-3.5 font-semibold tnum">GHS {n2(r.amount)}</td>
                        <td className="px-5 py-3.5">
                          {r.how === 'app'
                            ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full badge-green">Paid in app</span>
                            : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-tint text-ink-2">By admin{r.method ? ` · ${r.method}` : ''}</span>}
                        </td>
                        <td className="px-5 py-3.5 text-ink-2 text-xs whitespace-nowrap">
                          {r.paid_at ? format(new Date(r.paid_at), 'MMM d, HH:mm') : '—'}
                          {r.late && <span className="ml-1 text-[10px] text-ink-3">(late)</span>}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button onClick={() => undoPayment(r)} disabled={busyId === r.contribution_id}
                            className="text-[11px] font-semibold text-ink-2 hover:text-red underline underline-offset-2 disabled:opacity-40">
                            {busyId === r.contribution_id ? '…' : 'Undo'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* NOT PAID */}
          {unpaidShown.length > 0 && (
            <div className="border border-line rounded-[10px] overflow-hidden">
              <div className="px-5 py-3 border-b border-line bg-tint">
                <p className="font-semibold text-ink text-sm">Not paid · {unpaidShown.length}</p>
              </div>
              <div className="scroll-x">
                <table className="w-full text-sm min-w-[520px] lg:min-w-0">
                  <thead className="border-b border-line">
                    <tr className="text-ink-2 text-left">
                      <th className="px-5 py-3 font-medium">Member</th>
                      <th className="px-5 py-3 font-medium">Group</th>
                      <th className="px-5 py-3 font-medium">Owes</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {unpaidShown.map(r => (
                      <tr key={r.contribution_id} className="hover:bg-tint transition-colors">
                        <td className="px-5 py-3.5">
                          <Link href={`/admin/members/${r.member_id}`}
                            className="font-medium text-ink hover:underline underline-offset-2">{r.name}</Link>
                          <p className="text-[11px] text-ink-3">{r.code}</p>
                        </td>
                        <td className="px-5 py-3.5 text-ink-2">{r.group}</td>
                        <td className="px-5 py-3.5 font-semibold tnum">
                          GHS {n2(r.amount)}
                          {r.part_paid > 0 && (
                            <span className="ml-1 text-[11px] text-ink-2 font-normal">(GHS {n2(r.part_paid)} part-paid)</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${r.status === 'overdue' ? 'badge-red' : 'bg-tint text-ink-2'}`}>
                            {r.status === 'overdue' ? 'Overdue' : 'Due'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {paidShown.length === 0 && unpaidShown.length === 0 && (
            <div className="border border-line rounded-[10px] p-10 text-center text-ink-2">
              {q.trim() ? 'No member matches that search on this day.' : 'Nobody was due to pay on this day.'}
            </div>
          )}
        </>
      )}
    </div>
  )
}
