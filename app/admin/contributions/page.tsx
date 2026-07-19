'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { Contribution, SusuGroup } from '@/types'
import { format } from 'date-fns'
type StatusFilter = 'pending' | 'paid' | 'overdue' | 'all'
type Method = 'cash' | 'momo' | 'bank'

/*
 * Contributions — now a collection desk, not just a ledger view.
 * Money collected by hand (cash, direct MoMo, bank) is recorded here:
 * tick the days a member has paid for and mark them paid, or use
 * Record Payment to take an amount and settle their oldest days first.
 */

export default function ContributionsPage() {
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [groups, setGroups]               = useState<SusuGroup[]>([])
  const [loading, setLoading]             = useState(true)
  const [statusFilter, setStatusFilter]   = useState<StatusFilter>('pending')
  const [groupFilter, setGroupFilter]     = useState<string>('all')
  const [page, setPage]                   = useState(1)
  const [total, setTotal]                 = useState(0)
  const [toast, setToast]                 = useState('')

  // Table selection → mark paid
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)

  // Record Payment modal
  const [recOpen, setRecOpen]     = useState(false)
  const [search, setSearch]       = useState('')
  const [searching, setSearching] = useState(false)
  const [matches, setMatches]     = useState<any[]>([])
  const [recMember, setRecMember] = useState<any>(null)
  const [unpaid, setUnpaid]       = useState<Contribution[]>([])
  const [unpaidLoading, setUnpaidLoading] = useState(false)
  const [recPicked, setRecPicked] = useState<Set<string>>(new Set())
  const [amountIn, setAmountIn]   = useState('')
  const [recFilter, setRecFilter] = useState<string>('all')

  // Shared confirm fields
  const [method, setMethod]   = useState<Method>('cash')
  const [note, setNote]       = useState('')
  const [sendSms, setSendSms] = useState(true)
  const [saving, setSaving]   = useState(false)

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(''), 3500) }

  useEffect(() => {
    const token = getAdminToken()
    callFunction<{ groups: SusuGroup[] }>('groups-create', { token: token! })
      .then(({ data }) => setGroups(data?.groups ?? []))
  }, [])

  useEffect(() => { loadContributions() }, [statusFilter, groupFilter, page])

  async function loadContributions() {
    setLoading(true)
    const token = getAdminToken()
    const params = new URLSearchParams({ page: String(page) })
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (groupFilter  !== 'all') params.set('group_id', groupFilter)

    const { data } = await callFunction<{ contributions: Contribution[]; total: number }>(
      `contributions-list?${params}`, { token: token! }
    )
    setContributions(data?.contributions ?? [])
    setTotal(data?.total ?? 0)
    setPicked(new Set())
    setLoading(false)
  }

  // ── Record Payment: member search ──
  useEffect(() => {
    if (!recOpen || recMember || search.trim().length < 2) { setMatches([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const token = getAdminToken()
      const { data } = await callFunction<{ members: any[] }>(
        `admin-members?status=all&search=${encodeURIComponent(search.trim())}`, { token: token! })
      setMatches(data?.members ?? [])
      setSearching(false)
    }, 350)
    return () => clearTimeout(t)
  }, [search, recOpen, recMember])

  async function pickMember(m: any) {
    setRecMember(m); setMatches([]); setRecPicked(new Set()); setAmountIn(''); setRecFilter('all')
    setUnpaidLoading(true)
    const token = getAdminToken()
    // Collection mode: everything owed, across every group and slot
    const { data } = await callFunction<{ contributions: Contribution[] }>(
      `contributions-list?member_id=${m.id}&collection=1`, { token: token! })
    setUnpaid(data?.contributions ?? [])
    setUnpaidLoading(false)
  }

  const recSections = (() => {
    const map = new Map<string, { key: string; label: string; freq: string; rows: any[] }>()
    for (const c of unpaid as any[]) {
      const key = c.membership_id
      if (!map.has(key)) {
        const pos = c.group_memberships?.payout_position
        map.set(key, {
          key,
          label: `${c.susu_groups?.name ?? 'Group'}${pos ? ` — slot #${pos}` : ''}`,
          freq: c.susu_groups?.contribution_frequency ?? 'daily',
          rows: [],
        })
      }
      map.get(key)!.rows.push(c)
    }
    return Array.from(map.values())
  })()

  // Typing an amount auto-ticks the oldest days it covers, within the
  // chosen group/slot when one is selected
  function applyAmount(v: string, filterOverride?: string) {
    setAmountIn(v)
    const f = filterOverride ?? recFilter
    const pool = f === 'all' ? unpaid : (unpaid as any[]).filter(c => c.membership_id === f)
    const amt = parseFloat(v)
    if (isNaN(amt) || amt <= 0) { setRecPicked(new Set()); return }
    let left = amt
    const next = new Set<string>()
    for (const c of pool) {
      const a = Number(c.amount)
      if (left >= a - 0.001) { next.add(c.id); left -= a } else break
    }
    setRecPicked(next)
  }

  const recTotal = unpaid.filter(c => recPicked.has(c.id)).reduce((s, c) => s + Number(c.amount), 0)
  const remainder = amountIn ? Math.max(0, parseFloat(amountIn || '0') - recTotal) : 0

  const tableSelectable = contributions.filter(c => ['pending', 'overdue'].includes(c.status))
  const pickedRows  = contributions.filter(c => picked.has(c.id))
  const pickedTotal = pickedRows.reduce((s, c) => s + Number(c.amount), 0)

  async function submitPayment(ids: string[], after: () => void) {
    setSaving(true)
    const token = getAdminToken()
    const { data, error } = await callFunction<{ message: string }>('payments-manual', {
      method: 'POST', token: token!,
      body: { contribution_ids: ids, method, note: note || undefined, no_sms: !sendSms },
    })
    setSaving(false)
    if (error) { alert(error); return }
    showToast(data?.message ?? 'Payment recorded')
    setNote('')
    after()
    loadContributions()
  }

  function statusBadge(s: string) {
    if (s === 'paid')    return <span className="badge-green">Paid</span>
    if (s === 'overdue') return <span className="badge-red">Overdue</span>
    return <span className="badge-gold">Pending</span>
  }

  const methodPicker = (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-ink-2 mb-1.5">How was it paid?</label>
        <div className="flex gap-2">
          {(['cash', 'momo', 'bank'] as Method[]).map(m => (
            <button key={m} type="button" onClick={() => setMethod(m)}
              className={`flex-1 py-2.5 rounded-[10px] text-sm font-semibold capitalize transition-all ${
                method === m ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink border border-line'}`}>
              {m === 'momo' ? 'MoMo' : m}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm text-ink-2 mb-1.5">Reference / note <span className="text-ink-3">(optional)</span></label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. MoMo TXN ID, receipt no."
          className="w-full px-4 py-2.5 bg-tint border border-line text-ink rounded-[10px] text-sm focus:outline-none focus:border-ink" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={sendSms} onChange={e => setSendSms(e.target.checked)} className="w-4 h-4 accent-green" />
        <span className="text-sm text-ink">Send SMS receipt to the member</span>
      </label>
    </div>
  )

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-28 animate-fade-in">
      {toast && <div className="fixed top-5 right-5 z-[60] bg-ink text-white text-sm font-medium px-4 py-2.5 rounded-[10px] shadow-lg animate-fade-in">{toast}</div>}

      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Contributions</h1>
          <p className="text-ink-2 text-sm mt-1">{total} total records</p>
        </div>
        <button onClick={() => { setRecOpen(true); setRecMember(null); setSearch(''); setUnpaid([]) }}
          className="px-4 py-2.5 bg-ink text-white font-semibold rounded-[10px] text-sm hover:brightness-105 transition-colors">
          Record Payment
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex gap-2 flex-wrap">
          {(['pending','paid','overdue','all'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>
              {s}
            </button>
          ))}
        </div>
        <select
          className="px-3 py-1.5 bg-tint border border-line text-ink text-sm rounded-lg focus:outline-none focus:ring-0 focus:border-ink"
          value={groupFilter} onChange={e => { setGroupFilter(e.target.value); setPage(1) }}>
          <option value="all">All Groups</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">Loading…</div>
      ) : contributions.length === 0 ? (
        <div className="text-center py-20 text-ink-2">No contributions found</div>
      ) : (
        <div className="border border-line rounded-[10px] overflow-hidden">
          <div className="scroll-x">
            <table className="w-full text-sm min-w-[660px] lg:min-w-0">
            <thead className="border-b border-line">
              <tr className="text-ink-2">
                <th className="pl-4 pr-1 py-3 w-8">
                  {tableSelectable.length > 0 && (
                    <input type="checkbox" className="w-4 h-4 accent-green"
                      checked={tableSelectable.length > 0 && tableSelectable.every(c => picked.has(c.id))}
                      onChange={e => setPicked(e.target.checked ? new Set(tableSelectable.map(c => c.id)) : new Set())} />
                  )}
                </th>
                <th className="px-4 py-3 text-left font-medium">Member</th>
                <th className="px-4 py-3 text-left font-medium hidden sm:table-cell">Group</th>
                <th className="px-4 py-3 text-left font-medium">Due Date</th>
                <th className="px-4 py-3 text-left font-medium hidden md:table-cell">Paid On</th>
                <th className="px-4 py-3 text-left font-medium">Amount</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {contributions.map(c => {
                const selectable = ['pending', 'overdue'].includes(c.status)
                return (
                <tr key={c.id}
                  onClick={() => selectable && setPicked(p => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })}
                  className={`transition-colors ${selectable ? 'cursor-pointer' : ''} ${picked.has(c.id) ? 'bg-tint' : 'hover:bg-tint'}`}>
                  <td className="pl-4 pr-1 py-3.5" onClick={e => e.stopPropagation()}>
                    {selectable && (
                      <input type="checkbox" className="w-4 h-4 accent-green" checked={picked.has(c.id)}
                        onChange={() => setPicked(p => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} />
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <Link href={`/admin/members/${(c as any).members?.id}`} onClick={e => e.stopPropagation()} className="text-ink font-medium text-xs hover:underline underline-offset-2 block">{(c as any).members?.full_name}</Link>
                    <p className="text-ink-2 text-xs font-mono">{(c as any).members?.member_id}</p>
                  </td>
                  <td className="px-4 py-3.5 text-ink-2 hidden sm:table-cell text-xs">{c.susu_groups?.name}</td>
                  <td className="px-4 py-3.5 text-ink text-xs">{format(new Date(c.due_date), 'MMM d, yyyy')}</td>
                  <td className="px-4 py-3.5 text-ink-2 text-xs hidden md:table-cell">
                    {c.paid_at ? format(new Date(c.paid_at), 'MMM d, HH:mm') : '—'}
                  </td>
                  <td className="px-4 py-3.5 text-ink font-semibold">GHS {Number(c.amount).toFixed(2)}</td>
                  <td className="px-4 py-3.5">{statusBadge(c.status)}</td>
                </tr>
              )})}
            </tbody>
            </table>
          </div>

          {total > 30 && (
            <div className="px-5 py-4 border-t border-line flex items-center justify-between">
              <span className="text-sm text-ink-2">Page {page} · {total} records</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                  className="px-3 py-1.5 text-sm bg-tint text-ink-2 rounded-lg disabled:opacity-40 hover:text-ink">Prev</button>
                <button onClick={() => setPage(p => p+1)} disabled={page*30>=total}
                  className="px-3 py-1.5 text-sm bg-tint text-ink-2 rounded-lg disabled:opacity-40 hover:text-ink">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating mark-as-paid bar */}
      {picked.size > 0 && !confirming && (
        <div className="fixed bottom-6 inset-x-0 z-40 px-5 pointer-events-none">
          <div className="max-w-[560px] mx-auto pointer-events-auto">
            <button onClick={() => setConfirming(true)}
              className="w-full py-3.5 bg-ink text-white font-bold rounded-[14px] shadow-xl hover:brightness-105 transition-all active:scale-[.98]">
              Mark {picked.size} day{picked.size > 1 ? 's' : ''} as paid · GHS {pickedTotal.toLocaleString()}
            </button>
          </div>
        </div>
      )}

      {/* Confirm modal for table selection */}
      {confirming && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setConfirming(false)}>
          <div className="bg-white border border-line rounded-[10px] w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="font-bold text-ink text-lg">Record manual payment</h2>
              <p className="text-ink-2 text-sm mt-1">
                {picked.size} contribution{picked.size > 1 ? 's' : ''} · GHS {pickedTotal.toLocaleString()} total
              </p>
            </div>
            {methodPicker}
            <div className="flex gap-3">
              <button onClick={() => setConfirming(false)} className="flex-1 py-3 border border-line text-ink font-semibold rounded-[10px] hover:bg-tint transition-colors">Cancel</button>
              <button onClick={() => submitPayment(Array.from(picked), () => { setConfirming(false); setPicked(new Set()) })} disabled={saving}
                className="flex-1 py-3 bg-ink text-white font-semibold rounded-[10px] hover:brightness-105 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : 'Confirm paid'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment modal */}
      {recOpen && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setRecOpen(false)}>
          <div className="bg-white border border-line rounded-[10px] w-full max-w-lg p-6 space-y-4 animate-slide-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="font-bold text-ink text-lg">Record Payment</h2>
              <p className="text-ink-2 text-sm mt-0.5">Cash, direct MoMo, or bank — settle a member's oldest days first.</p>
            </div>

            {!recMember ? (
              <div>
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search member by name, phone or ID…"
                  className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:border-ink" />
                {searching && <p className="text-xs text-ink-3 mt-2">Searching…</p>}
                {matches.length > 0 && (
                  <div className="mt-2 border border-line rounded-[10px] divide-y divide-line overflow-hidden">
                    {matches.slice(0, 8).map(m => (
                      <button key={m.id} type="button" onClick={() => pickMember(m)}
                        className="w-full text-left px-4 py-2.5 hover:bg-tint transition-colors">
                        <span className="text-sm font-medium text-ink">{m.full_name}</span>
                        <span className="text-xs text-ink-2 ml-2">{m.member_id} · {m.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between p-3 bg-tint border border-line rounded-[10px]">
                  <div>
                    <p className="text-sm font-semibold text-ink">{recMember.full_name}</p>
                    <p className="text-xs text-ink-2">{recMember.member_id} · {recMember.phone}</p>
                  </div>
                  <button type="button" onClick={() => { setRecMember(null); setSearch(''); setUnpaid([]) }}
                    className="text-xs text-ink-2 hover:text-red">Change</button>
                </div>

                {unpaidLoading ? (
                  <p className="text-sm text-ink-3 py-4 text-center">Loading their unpaid days…</p>
                ) : unpaid.length === 0 ? (
                  <p className="text-sm text-ink-2 py-4 text-center">This member has no pending or overdue contributions. 🎉</p>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm text-ink-2 mb-1.5">Which plan is this payment for?</label>
                      <select value={recFilter}
                        onChange={e => { setRecFilter(e.target.value); setRecPicked(new Set()); if (amountIn) applyAmount(amountIn, e.target.value) }}
                        className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:border-ink">
                        <option value="all">All groups & slots ({unpaid.length} unpaid days)</option>
                        {recSections.map(sec => (
                          <option key={sec.key} value={sec.key}>
                            {sec.label} · {sec.freq} · {sec.rows.length} unpaid — GHS {sec.rows.reduce((t: number, r: any) => t + Number(r.amount), 0).toLocaleString()} owed
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm text-ink-2 mb-1.5">Amount received (GHS)</label>
                      <input type="number" min="0" step="0.01" value={amountIn} onChange={e => applyAmount(e.target.value)}
                        placeholder="Type the amount — oldest days tick themselves"
                        className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:border-ink" />
                      {remainder > 0.009 && (
                        <p className="text-xs text-gold mt-1.5">
                          GHS {remainder.toFixed(2)} left over doesn't cover a full day — untick or adjust, the leftover won't be recorded.
                        </p>
                      )}
                    </div>

                    <div className="border border-line rounded-[10px] max-h-56 overflow-y-auto">
                      {recSections.filter(sec => recFilter === 'all' || sec.key === recFilter).map(sec => (
                        <div key={sec.key}>
                          <div className="sticky top-0 bg-tint px-3.5 py-2 border-b border-line flex items-center justify-between">
                            <span className="text-xs font-bold text-ink">{sec.label}</span>
                            <span className="text-[11px] text-ink-2">{sec.freq} · {sec.rows.length} unpaid</span>
                          </div>
                          <div className="divide-y divide-line">
                            {sec.rows.map((c: any) => (
                              <label key={c.id} className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-tint">
                                <input type="checkbox" className="w-4 h-4 accent-green" checked={recPicked.has(c.id)}
                                  onChange={() => setRecPicked(p => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} />
                                <span className="flex-1 text-sm text-ink">{format(new Date(c.due_date), 'EEE, MMM d yyyy')}</span>
                                {c.status === 'overdue' && <span className="badge-red text-[10px]">Overdue</span>}
                                <span className="text-sm font-semibold text-ink tnum">GHS {Number(c.amount).toFixed(2)}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {methodPicker}

                    <button onClick={() => submitPayment(Array.from(recPicked), () => { setRecOpen(false); setRecMember(null) })}
                      disabled={saving || recPicked.size === 0}
                      className="w-full py-3.5 bg-ink text-white font-bold rounded-[10px] hover:brightness-105 transition-all disabled:opacity-50">
                      {saving ? 'Saving…'
                        : recPicked.size === 0 ? 'Tick the days being paid for'
                        : `Confirm GHS ${recTotal.toLocaleString()} · ${recPicked.size} day${recPicked.size > 1 ? 's' : ''}`}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
