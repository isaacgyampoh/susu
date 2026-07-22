'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { format } from 'date-fns'

/*
 * Money received — every payment, in-app, so the operator never has to open
 * NaloPay to see today's takings. Online (NaloPay) and manual are split and
 * totalled so the online figure reconciles against NaloPay's own report.
 */
const n2 = (v: any) => Number(v ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const RANGES = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'All time']] as const
const CHANNELS = [['all', 'All'], ['online', 'NaloPay'], ['manual', 'Manual']] as const

export default function TransactionsPage() {
  const [range, setRange]     = useState<string>('today')
  const [channel, setChannel] = useState<string>('all')
  const [status, setStatus]   = useState<string>('success')
  const [rows, setRows]       = useState<any[]>([])
  const [totals, setTotals]   = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage]       = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [syncRaw, setSyncRaw] = useState('')
  const [view, setView]       = useState<'received' | 'whopaid'>('whopaid')
  const [paidRows, setPaidRows] = useState<any[]>([])
  const [paidSummary, setPaidSummary] = useState<any>(null)
  const [paidLoading, setPaidLoading] = useState(true)

  async function loadPaid() {
    setPaidLoading(true)
    const { data } = await callFunction<any>(`admin-paid-today?range=${range}`, { token: getAdminToken()! })
    setPaidRows(data?.rows ?? [])
    setPaidSummary(data?.summary ?? null)
    setPaidLoading(false)
  }
  useEffect(() => { if (view === 'whopaid') loadPaid() }, [range, view])

  async function reconcile() {
    setSyncing(true); setSyncMsg('')
    const { data, error } = await callFunction<any>('admin-reconcile-payments', { method: 'POST', token: getAdminToken()! })
    setSyncing(false)
    if (error) { setSyncMsg(error); return }
    setSyncMsg(
      `Checked ${data.checked} pending payment(s): ${data.settled} newly settled, ${data.still_pending} still pending, ${data.failed} failed.` +
      (data.hint ? ` — ${data.hint}` : ''))
    // Surface the raw provider response for the first pending, to diagnose format
    const firstPending = (data.details ?? []).find((d: any) => d.status === 'pending' && d.raw)
    if (firstPending) setSyncRaw(JSON.stringify(firstPending.raw, null, 2))
    else setSyncRaw('')
    load(true)
  }

  async function forceSettle() {
    if (!confirm('Only do this after confirming these payments are SUCCESSFUL in your NaloPay dashboard. It marks all pending payments as received. Continue?')) return
    setSyncing(true); setSyncMsg('')
    const { data, error } = await callFunction<any>('admin-reconcile-payments', { method: 'POST', token: getAdminToken()!, body: { force: true } })
    setSyncing(false)
    if (error) { setSyncMsg(error); return }
    setSyncMsg(`Force-settled ${data.settled} payment(s) you confirmed in NaloPay.`)
    setSyncRaw('')
    load(true)
  }

  async function load(reset = true) {
    setLoading(true)
    const p = reset ? 1 : page
    const token = getAdminToken()
    const { data } = await callFunction<any>(
      `admin-transactions?range=${range}&channel=${channel}&status=${status}&page=${p}`, { token: token! })
    setTotals(data?.totals ?? null)
    setHasMore(!!data?.has_more)
    setRows(reset ? (data?.transactions ?? []) : [...rows, ...(data?.transactions ?? [])])
    if (reset) setPage(1)
    setLoading(false)
  }
  useEffect(() => { load(true) }, [range, channel, status])

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Money Received</h1>
          <p className="text-ink-2 text-sm mt-1">Every payment into your susu — reconcile the NaloPay total against your NaloPay dashboard.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={reconcile} disabled={syncing}
            className="px-4 py-2.5 bg-ink text-white font-semibold rounded-[10px] text-sm hover:brightness-105 transition-all disabled:opacity-50 whitespace-nowrap">
            {syncing ? 'Syncing…' : 'Sync from NaloPay'}
          </button>
          <button onClick={forceSettle} disabled={syncing}
            className="px-4 py-2.5 border border-line text-ink font-semibold rounded-[10px] text-sm hover:bg-tint transition-colors disabled:opacity-50 whitespace-nowrap">
            Force settle
          </button>
        </div>
      </div>
      {syncMsg && (
        <div className="mb-4 p-3 rounded-[10px] bg-tint border border-line text-sm text-ink">{syncMsg}</div>
      )}
      {syncRaw && (
        <div className="mb-4 p-3 rounded-[10px] bg-tint border border-line">
          <p className="text-xs text-ink-2 mb-1.5">NaloPay's raw status response for a pending payment (send this to your developer):</p>
          <pre className="text-[10px] text-ink font-mono overflow-x-auto whitespace-pre-wrap break-all">{syncRaw}</pre>
        </div>
      )}

      {/* View toggle */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setView('whopaid')}
          className={`px-4 py-2 rounded-[10px] text-sm font-semibold transition-colors ${view === 'whopaid' ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>
          Who paid
        </button>
        <button onClick={() => setView('received')}
          className={`px-4 py-2 rounded-[10px] text-sm font-semibold transition-colors ${view === 'received' ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>
          Transactions
        </button>
      </div>

      {view === 'whopaid' && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {RANGES.map(([v, l]) => (
              <button key={v} onClick={() => setRange(v)}
                className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors ${range === v ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>{l}</button>
            ))}
          </div>
          {paidSummary && (
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="card p-4 bg-ink border-ink">
                <p className="text-[22px] font-extrabold tnum text-white"><span className="text-[12px] align-[.35em] mr-0.5 text-white/60">GHS</span>{n2(paidSummary.total)}</p>
                <p className="text-[12px] text-white/60 mt-1">collected · {RANGES.find(r => r[0] === range)?.[1]}</p>
              </div>
              <div className="card p-4">
                <p className="text-[22px] font-extrabold tnum">{paidSummary.members}</p>
                <p className="t-label mt-1">members paid</p>
              </div>
              <div className="card p-4">
                <p className="text-[22px] font-extrabold tnum">{paidSummary.payments}</p>
                <p className="t-label mt-1">days paid</p>
              </div>
            </div>
          )}
          {paidLoading ? (
            <p className="text-ink-3 text-sm py-10 text-center">Loading…</p>
          ) : paidRows.length === 0 ? (
            <div className="border border-line rounded-[10px] p-10 text-center text-ink-2">Nobody has paid in this period yet.</div>
          ) : (
            <div className="border border-line rounded-[10px] overflow-hidden">
              <div className="scroll-x">
                <table className="w-full text-sm min-w-[560px] lg:min-w-0">
                  <thead className="border-b border-line">
                    <tr className="text-ink-2 text-left">
                      <th className="px-5 py-3 font-medium">Member</th>
                      <th className="px-5 py-3 font-medium">Group</th>
                      <th className="px-5 py-3 font-medium">Days paid</th>
                      <th className="px-5 py-3 font-medium">Amount</th>
                      <th className="px-5 py-3 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {paidRows.map((r, i) => (
                      <tr key={i} className="hover:bg-tint transition-colors">
                        <td className="px-5 py-3.5">
                          <Link href={`/admin/members/${r.member_id}`} className="font-medium text-ink hover:underline underline-offset-2">{r.name}</Link>
                          <p className="text-[11px] text-ink-3">{r.code}</p>
                        </td>
                        <td className="px-5 py-3.5 text-ink-2">{r.group}</td>
                        <td className="px-5 py-3.5 font-medium">{r.days}</td>
                        <td className="px-5 py-3.5 font-semibold tnum">GHS {n2(r.total)}</td>
                        <td className="px-5 py-3.5 text-ink-2 text-xs whitespace-nowrap">{r.last_paid ? format(new Date(r.last_paid), 'MMM d, HH:mm') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {view === 'received' && (
       <>
      {/* Totals */}
      {totals && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="card p-4 bg-ink border-ink">
            <p className="text-[22px] font-extrabold tnum text-white">
              <span className="text-[12px] align-[.35em] mr-0.5 text-white/60">GHS</span>{n2(totals.all.total)}
            </p>
            <p className="text-[12px] text-white/60 mt-1">{totals.all.count} total · {RANGES.find(r => r[0] === range)?.[1]}</p>
          </div>
          <div className="card p-4">
            <p className="text-[22px] font-extrabold tnum text-green">GHS {n2(totals.online.total)}</p>
            <p className="t-label mt-1">{totals.online.count} via NaloPay</p>
          </div>
          <div className="card p-4">
            <p className="text-[22px] font-extrabold tnum">GHS {n2(totals.manual.total)}</p>
            <p className="t-label mt-1">{totals.manual.count} manual</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {RANGES.map(([v, l]) => (
          <button key={v} onClick={() => setRange(v)}
            className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors ${range === v ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>{l}</button>
        ))}
        <span className="w-px bg-line mx-1" />
        {CHANNELS.map(([v, l]) => (
          <button key={v} onClick={() => setChannel(v)}
            className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors ${channel === v ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>{l}</button>
        ))}
        <span className="w-px bg-line mx-1" />
        {(['success', 'pending', 'failed'] as const).map(v => (
          <button key={v} onClick={() => setStatus(v)}
            className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold capitalize transition-colors ${status === v ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>{v}</button>
        ))}
      </div>

      {/* List */}
      {loading && rows.length === 0 ? (
        <p className="text-ink-3 text-sm py-10 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="border border-line rounded-[10px] p-10 text-center text-ink-2">
          No {status} payments in this period.
        </div>
      ) : (
        <div className="border border-line rounded-[10px] overflow-hidden">
          <div className="scroll-x">
            <table className="w-full text-sm min-w-[640px] lg:min-w-0">
              <thead className="border-b border-line">
                <tr className="text-ink-2 text-left">
                  <th className="px-5 py-3 font-medium">Member</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Channel</th>
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(t => (
                  <tr key={t.id} className="hover:bg-tint transition-colors">
                    <td className="px-5 py-3.5">
                      {t.member ? (
                        <Link href={`/admin/members/${t.member.id}`} className="font-medium text-ink hover:underline underline-offset-2">
                          {t.member.name}
                        </Link>
                      ) : <span className="text-ink-3">—</span>}
                      {t.member && <p className="text-[11px] text-ink-3">{t.member.member_id}</p>}
                    </td>
                    <td className="px-5 py-3.5 font-semibold tnum">GHS {n2(t.amount)}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${t.channel === 'online' ? 'badge-green' : 'bg-tint text-ink-2'}`}>
                        {t.channel === 'online' ? 'NaloPay' : 'Manual'}
                      </span>
                      {t.type === 'registration_fee' && <span className="ml-1 text-[10px] text-ink-3">reg fee</span>}
                      {t.type === 'bulk_contribution' && <span className="ml-1 text-[10px] text-ink-3">bulk</span>}
                    </td>
                    <td className="px-5 py-3.5 text-ink-2 text-xs whitespace-nowrap">{format(new Date(t.created_at), 'MMM d, HH:mm')}</td>
                    <td className="px-5 py-3.5 text-ink-3 text-[11px] font-mono">{t.order_id ?? t.reference?.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <button onClick={() => { setPage(p => p + 1); load(false) }}
              className="w-full py-3 text-sm text-ink-2 hover:text-ink hover:bg-tint transition-colors border-t border-line">
              Load more
            </button>
          )}
        </div>
      )}
       </>
      )}
    </div>
  )
}
