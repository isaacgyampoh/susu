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
  const [received, setReceived] = useState<any[]>([])
  const [paid, setPaid]       = useState<any[]>([])
  const [unpaid, setUnpaid]   = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState('')
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await callFunction<any>(`admin-paid-today?date=${day}`, { token: getAdminToken()! })
    setReceived(data?.received ?? [])
    setPaid(data?.covered ?? [])
    setUnpaid(data?.unpaid ?? [])
    setSummary(data?.summary ?? null)
    setLoading(false)
  }
  useEffect(() => { load() }, [day])

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [
      ['Section','Member','ID','Group','Amount (GHS)','How','Covers day','Paid at'].join(','),
      ...received.map(r => [
        'Money received', esc(r.name), esc(r.code), esc(r.group), Number(r.amount).toFixed(2),
        r.how === 'app' ? 'In-app' : `Manual${r.method ? ' ' + r.method : ''}`,
        esc(r.due_date),
        r.paid_at ? format(new Date(r.paid_at), 'yyyy-MM-dd HH:mm') : '',
      ].join(',')),
      ...paid.map(r => [
        'Due settled', esc(r.name), esc(r.code), esc(r.group), Number(r.amount).toFixed(2),
        r.how === 'app' ? 'In-app' : `Manual${r.method ? ' ' + r.method : ''}`,
        esc(r.due_date),
        r.paid_at ? format(new Date(r.paid_at), 'yyyy-MM-dd HH:mm') : '',
      ].join(',')),
      ...unpaid.map(r => [
        r.status === 'overdue' ? 'Overdue' : 'Not paid',
        esc(r.name), esc(r.code), esc(r.group), Number(r.amount).toFixed(2), '', esc(r.due_date), '',
      ].join(',')),
    ]
    const blob = new Blob(["\ufeff" + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `daily-payments-${day}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function syncNow() {
    setSyncing(true)
    const { data, error } = await callFunction<any>('cron-settle-pending', {
      method: 'POST', token: getAdminToken()!, body: {},
    })
    setSyncing(false)
    alert(error ? `${error}` : (data?.message ?? 'Done.'))
    if (!error) load()
  }

  async function restoreReversals() {
    const { data: preview, error: pErr } = await callFunction<any>('admin-restore-reversals', {
      method: 'POST', token: getAdminToken()!, body: { dry_run: true },
    })
    if (pErr) { alert(pErr); return }
    if (!preview?.restored) { alert(preview?.message ?? 'Nothing to restore.'); return }
    const lines = (preview.details ?? [])
      .map((d: any) => `\u2022 ${d.member} \u2014 GHS ${n2(d.amount)} (${d.group}, ${d.due_date})`).join('\n')
    if (!confirm(`Restore these ${preview.restored} reversed payment(s)?\n\n${lines}`)) return
    const { data, error } = await callFunction<any>('admin-restore-reversals', {
      method: 'POST', token: getAdminToken()!, body: {},
    })
    if (error) { alert(error); return }
    alert(data?.message ?? 'Restored.')
    load()
  }

  async function repairForced() {
    const pasted = prompt(
      'Reconcile in-app payments against NaloPay.\n\n' +
      'Open NaloPay \u2192 Reports \u2192 Collection report, filter Status = Successful, ' +
      'and paste the TRANSACTION IDs here (one per line, or comma separated).\n\n' +
      'Any in-app payment NOT in that list will be put back to unpaid. ' +
      'Manual payments are never touched.')
    if (!pasted?.trim()) return
    const ids = pasted.split(/[\s,]+/).map(t => t.trim()).filter(Boolean)

    const { data: preview, error: pErr } = await callFunction<any>('admin-repair-forced', {
      method: 'POST', token: getAdminToken()!,
      body: { keep_order_ids: ids, dry_run: true },
    })
    if (pErr) { alert(pErr); return }
    if (!preview?.details?.length && !preview?.to_settle) { alert(preview?.message ?? 'Everything already matches.'); return }

    const revLines = (preview.details ?? [])
      .map((d: any) => `\u2022 ${d.member} \u2014 GHS ${n2(d.amount)} (${d.group}, ${d.due_date})`).join('\n')
    const setLines = (preview.settle_details ?? [])
      .map((d: any) => `\u2022 GHS ${n2(d.amount)} (${d.order_id})`).join('\n')
    let msg = `${preview.confirmed} payment(s) already correct.\n`
    if (preview.to_settle > 0) msg += `\nWILL BE MARKED PAID (successful at NaloPay but missing here) \u2014 GHS ${n2(preview.settle_total)}:\n${setLines}\n`
    if (preview.to_reverse > 0) msg += `\n${preview.to_reverse} payment(s) are marked here but NOT in your pasted list \u2014 they will be LEFT ALONE unless you choose to reverse them in the next step.\n`
    msg += '\nProceed?'
    if (!confirm(msg)) return

    let alsoReverse = false
    if (preview.to_reverse > 0) {
      alsoReverse = confirm(
        `Also REVERSE these ${preview.to_reverse} payment(s) \u2014 GHS ${n2(preview.reverse_total)}?\n\n${revLines}\n\n` +
        `ONLY choose OK if you are certain you pasted EVERY page of NaloPay's successful list \u2014 the report is paginated. ` +
        `If in doubt, choose Cancel: nothing is reversed and you can run this again with the full list.`)
    }

    const { data, error } = await callFunction<any>('admin-repair-forced', {
      method: 'POST', token: getAdminToken()!,
      body: { keep_order_ids: ids, also_reverse: alsoReverse },
    })
    if (error) { alert(error); return }
    alert(data?.message ?? 'Done.')
    load()
  }

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
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Daily Payments</h1>
          <p className="text-ink-2 text-sm mt-1">
            Who was due to pay on a day, and who has paid.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
        <button onClick={syncNow} disabled={syncing}
          className="px-3 py-2 bg-ink text-white rounded-[10px] text-xs font-semibold hover:brightness-105 transition-all disabled:opacity-50 whitespace-nowrap">
          {syncing ? 'Checking…' : 'Sync now'}
        </button>
        <button onClick={restoreReversals}
          className="px-3 py-2 border border-line text-ink-2 hover:text-ink hover:bg-tint rounded-[10px] text-xs font-semibold transition-colors whitespace-nowrap">
          Restore reversed
        </button>
        <button onClick={exportCsv}
          className="px-3 py-2 border border-line text-ink-2 hover:text-ink hover:bg-tint rounded-[10px] text-xs font-semibold transition-colors whitespace-nowrap">
          Export CSV
        </button>
        <button onClick={repairForced}
          className="px-3 py-2 border border-line text-ink-2 hover:text-ink hover:bg-tint rounded-[10px] text-xs font-semibold transition-colors whitespace-nowrap shrink-0">
          Reconcile with NaloPay
        </button>
        </div>
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

      {/* The day at a glance — money in and coverage kept apart */}
      {summary && (
        <div className="grid lg:grid-cols-2 gap-3 mb-5">
          <div className="card p-4">
            <p className="t-label">Money received on {prettyDay(day).toLowerCase()}</p>
            <p className="text-[26px] font-extrabold text-ink mt-1 tnum">
              <span className="text-[13px] align-[.4em] mr-0.5 text-ink-2">GHS</span>{n2(summary.received_total)}
            </p>
            <div className="text-xs text-ink-2 mt-2 space-y-0.5">
              <p><span className="font-semibold text-ink">GHS {n2(summary.received_in_app)}</span> in-app
                <span className="text-ink-3"> — compare with NaloPay for this date</span></p>
              <p><span className="font-semibold text-ink">GHS {n2(summary.received_manual)}</span> manual
                <span className="text-ink-3"> — cash or MoMo taken directly</span></p>
            </div>
          </div>

          <div className="card p-4">
            <p className="t-label">{prettyDay(day)}&rsquo;s dues</p>
            {summary.expected === 0 ? (
              <p className="text-ink-2 text-sm mt-2">Nobody was due to pay on this day.</p>
            ) : (
              <>
                <p className="text-[26px] font-extrabold text-ink mt-1 tnum">
                  {summary.paid_count} <span className="text-ink-2 font-semibold text-[18px]">of {summary.expected} settled</span>
                </p>
                <div className="h-1.5 bg-line rounded-full overflow-hidden mt-3">
                  <div className="h-full bg-ink rounded-full transition-all"
                    style={{ width: `${Math.round((summary.paid_count / summary.expected) * 100)}%` }} />
                </div>
                <p className="text-xs text-ink-2 mt-2">
                  GHS {n2(summary.outstanding)} still outstanding
                  {summary.covered_earlier > 0 && (
                    <span className="text-ink-3"> · {summary.covered_earlier} settled by money received on an earlier day</span>
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Money received on this date */}
      {!loading && received.length > 0 && (
        <div className="border border-line rounded-[10px] overflow-hidden mb-5">
          <div className="px-5 py-3 border-b border-line bg-tint">
            <p className="font-semibold text-ink text-sm">Received on {prettyDay(day).toLowerCase()} · {received.length}</p>
          </div>
          <div className="scroll-x">
            <table className="w-full text-sm min-w-[640px] lg:min-w-0">
              <thead className="border-b border-line">
                <tr className="text-ink-2 text-left">
                  <th className="px-5 py-3 font-medium">Member</th>
                  <th className="px-5 py-3 font-medium">Group</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">How</th>
                  <th className="px-5 py-3 font-medium">Covers</th>
                  <th className="px-5 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {received.filter(match).map(r => (
                  <tr key={r.contribution_id} className="hover:bg-tint transition-colors">
                    <td className="px-5 py-3.5">
                      <Link href={`/admin/members/${r.member_id}`} className="font-medium text-ink hover:underline underline-offset-2">{r.name}</Link>
                      <p className="text-[11px] text-ink-3">{r.code}</p>
                    </td>
                    <td className="px-5 py-3.5 text-ink-2">{r.group}</td>
                    <td className="px-5 py-3.5 font-semibold tnum">GHS {n2(r.amount)}</td>
                    <td className="px-5 py-3.5">
                      {r.how === 'app'
                        ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full badge-green">In-app</span>
                        : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-tint text-ink-2">Manual{r.method ? ` · ${r.method}` : ''}</span>}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-ink-2">
                      {r.covers === 'today' ? 'this day'
                        : r.covers === 'ahead' ? <>ahead · {r.due_date}</>
                        : <>arrears · {r.due_date}</>}
                    </td>
                    <td className="px-5 py-3.5 text-ink-2 text-xs whitespace-nowrap">
                      {r.paid_at ? format(new Date(r.paid_at), 'HH:mm') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                <p className="font-semibold text-ink text-sm">Dues settled for this day · {paidShown.length}</p>
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
                            ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full badge-green">In-app</span>
                            : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-tint text-ink-2">Manual{r.method ? ` · ${r.method}` : ''}</span>}
                        </td>
                        <td className="px-5 py-3.5 text-ink-2 text-xs whitespace-nowrap">
                          {r.paid_at ? format(new Date(r.paid_at), 'MMM d, HH:mm') : '—'}
                          {r.paid_on_another_day && <span className="ml-1 text-[10px] text-ink-3">(not this day)</span>}
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
