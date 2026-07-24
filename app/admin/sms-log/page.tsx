'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { format } from 'date-fns'

/*
 * The SMS record — proof of what was sent, to whom, and when.
 * Search by a member's name or their number.
 */
const RANGES = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'All time']] as const
const STATUS = [['all', 'All'], ['sent', 'Sent'], ['failed', 'Failed']] as const

export default function SmsLogPage() {
  const [q, setQ]           = useState('')
  const [range, setRange]   = useState<string>('7d')
  const [status, setStatus] = useState<string>('all')
  const [rows, setRows]     = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage]     = useState(1)
  const [hasMore, setHasMore] = useState(false)

  async function load(reset = true) {
    setLoading(true)
    const p = reset ? 1 : page + 1
    const { data } = await callFunction<any>(
      `admin-sms-log?q=${encodeURIComponent(q)}&range=${range}&status=${status}&page=${p}`,
      { token: getAdminToken()! })
    setNotice(data?.notice ?? '')
    setSummary(data?.summary ?? null)
    setHasMore(!!data?.has_more)
    setRows(reset ? (data?.messages ?? []) : [...rows, ...(data?.messages ?? [])])
    setPage(p)
    setLoading(false)
  }
  useEffect(() => { load(true) }, [range, status])

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-ink">SMS Log</h1>
        <p className="text-ink-2 text-sm mt-1">
          Every message the system has sent. Search a member to see exactly what they received.
        </p>
      </div>

      {notice && (
        <div className="mb-4 p-3 rounded-[10px] bg-tint border border-gold/50 text-sm text-ink">{notice}</div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <form onSubmit={e => { e.preventDefault(); load(true) }} className="flex gap-2 flex-1 min-w-[240px]">
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Member name or phone number…"
            className="flex-1 px-3 py-2 bg-tint border border-line rounded-[10px] text-sm text-ink focus:outline-none focus:border-ink" />
          <button type="submit"
            className="px-4 py-2 bg-ink text-white rounded-[10px] text-sm font-semibold hover:brightness-105 transition-all">
            Search
          </button>
          {q && (
            <button type="button" onClick={() => { setQ(''); setTimeout(() => load(true), 0) }}
              className="px-3 py-2 border border-line text-ink-2 rounded-[10px] text-sm hover:bg-tint transition-colors">
              Clear
            </button>
          )}
        </form>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {RANGES.map(([v, l]) => (
          <button key={v} onClick={() => setRange(v)}
            className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors ${range === v ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>{l}</button>
        ))}
        <span className="w-px bg-line mx-1" />
        {STATUS.map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)}
            className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors ${status === v ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>{l}</button>
        ))}
      </div>

      {summary && (summary.sent > 0 || summary.failed > 0) && (
        <div className="grid grid-cols-2 gap-3 mb-5 max-w-[420px]">
          <div className="card p-4">
            <p className="text-[22px] font-extrabold tnum text-green">{summary.sent}</p>
            <p className="t-label mt-1">accepted by the network</p>
          </div>
          <div className="card p-4">
            <p className={`text-[22px] font-extrabold tnum ${summary.failed > 0 ? 'text-red' : ''}`}>{summary.failed}</p>
            <p className="t-label mt-1">failed to send</p>
          </div>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <p className="text-ink-3 text-sm py-10 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="border border-line rounded-[10px] p-10 text-center text-ink-2">
          {q ? `No messages found for “${q}” in this period.` : 'No messages sent in this period.'}
        </div>
      ) : (
        <div className="border border-line rounded-[10px] overflow-hidden">
          <div className="scroll-x">
            <table className="w-full text-sm min-w-[680px] lg:min-w-0">
              <thead className="border-b border-line">
                <tr className="text-ink-2 text-left">
                  <th className="px-5 py-3 font-medium">To</th>
                  <th className="px-5 py-3 font-medium">Message</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-tint transition-colors align-top">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-ink">{r.who ?? r.recipient}</p>
                      {r.who && <p className="text-[11px] text-ink-3">{r.recipient}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-ink-2 max-w-[520px]">{r.message}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${r.ok ? 'badge-green' : 'badge-red'}`}>
                        {r.ok ? 'Sent' : 'Failed'}
                      </span>
                      {r.error && <p className="text-[10px] text-ink-3 mt-1">{r.error}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-ink-2 text-xs whitespace-nowrap">
                      {format(new Date(r.created_at), 'MMM d, HH:mm')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <button onClick={() => load(false)}
              className="w-full py-3 text-sm text-ink-2 hover:text-ink hover:bg-tint transition-colors border-t border-line">
              Load more
            </button>
          )}
        </div>
      )}

      <p className="text-[11.5px] text-ink-3 mt-4">
        “Sent” means the network accepted the message. Delivery to the handset can still fail after that — if a member insists they saw nothing, check the number on their profile first.
      </p>
    </div>
  )
}
