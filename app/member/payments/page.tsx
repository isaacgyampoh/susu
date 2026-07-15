'use client'
import { useEffect, useState } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { Contribution } from '@/types'
import { format } from 'date-fns'
import { Loader2, CreditCard, CheckCircle, Clock, AlertCircle, Zap, X, Calendar } from 'lucide-react'

type FilterStatus = 'all' | 'paid' | 'pending' | 'overdue'

const QUICK_OPTIONS = [
  { days: 7,  label: '1 Week'   },
  { days: 14, label: '2 Weeks'  },
  { days: 30, label: '1 Month'  },
]

export default function PaymentsPage() {
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<FilterStatus>('all')
  const [payingId, setPayingId] = useState<string | null>(null)
  const [page, setPage]         = useState(1)
  const [total, setTotal]       = useState(0)

  // Bulk payment state
  const [showBulk, setShowBulk]   = useState(false)
  const [bulkDays, setBulkDays]   = useState(7)
  const [preview, setPreview]     = useState<any>(null)
  const [previewing, setPreviewing] = useState(false)
  const [payingBulk, setPayingBulk] = useState(false)

  async function load() {
    setLoading(true)
    const token  = getMemberToken()
    const params = filter === 'all' ? `page=${page}` : `status=${filter}&page=${page}`
    const { data } = await callFunction<{ contributions: Contribution[]; total: number }>(
      `contributions-list?${params}`, { token: token! }
    )
    setContributions(data?.contributions ?? [])
    setTotal(data?.total ?? 0)
    setLoading(false)
  }

  useEffect(() => { load() }, [filter, page])

  // Load bulk preview when days change
  useEffect(() => {
    if (!showBulk) return
    setPreviewing(true)
    const token = getMemberToken()
    callFunction<any>(`payments-bulk?days=${bulkDays}`, { token: token! })
      .then(({ data }) => setPreview(data))
      .finally(() => setPreviewing(false))
  }, [showBulk, bulkDays])

  async function handlePay(c: Contribution) {
    const token = getMemberToken()
    setPayingId(c.id)
    const { data, error } = await callFunction<{ authorization_url?: string; dev_mode?: boolean }>(
      'payments-initialize', { method: 'POST', body: { contribution_id: c.id }, token: token! }
    )
    setPayingId(null)
    if (error) { alert(error); return }
    if (data?.dev_mode) { load(); return }
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  async function handleBulkPay() {
    setPayingBulk(true)
    const token = getMemberToken()
    const { data, error } = await callFunction<{ authorization_url?: string; dev_mode?: boolean; count?: number }>(
      'payments-bulk', { method: 'POST', body: { days: bulkDays }, token: token! }
    )
    setPayingBulk(false)
    if (error) { alert(error); return }
    if (data?.dev_mode) { setShowBulk(false); load(); return }
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  const totalPaid    = contributions.filter(c => c.status === 'paid').reduce((s, c) => s + Number(c.amount), 0)
  const totalPending = contributions.filter(c => c.status !== 'paid').reduce((s, c) => s + Number(c.amount), 0)
  const unpaidCount  = contributions.filter(c => c.status !== 'paid').length

  function statusBadge(s: string) {
    if (s === 'paid')    return <span className="badge-green">Paid</span>
    if (s === 'overdue') return <span className="badge-red">Overdue</span>
    return <span className="badge-gold">Pending</span>
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto pb-12 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-brand-green">My Payments</h1>
        <p className="text-gray-500 text-sm mt-1">Pay one day at a time, or clear several days in a single MoMo transaction</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-5">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-emerald-600 mb-1"><CheckCircle size={15} /><span className="text-xs font-medium">Paid</span></div>
          <div className="font-bold text-gray-900 text-sm sm:text-base">GHS {totalPaid.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-amber-500 mb-1"><Clock size={15} /><span className="text-xs font-medium">Due</span></div>
          <div className="font-bold text-gray-900 text-sm sm:text-base">GHS {totalPending.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-blue-500 mb-1"><CreditCard size={15} /><span className="text-xs font-medium">Records</span></div>
          <div className="font-bold text-gray-900 text-sm sm:text-base">{total}</div>
        </div>
      </div>

      {/* ── BULK PAY CTA ── */}
      {unpaidCount > 0 && (
        <button onClick={() => setShowBulk(true)}
          className="w-full mb-5 p-4 bg-gradient-to-r from-brand-green to-brand-green-mid rounded-2xl text-left hover:shadow-lg transition-shadow group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-brand-gold flex items-center justify-center shrink-0">
                <Zap size={20} className="text-brand-green" />
              </div>
              <div>
                <p className="font-bold text-white">Pay Multiple Days at Once</p>
                <p className="text-green-200 text-sm">One MoMo transaction — save time and stay ahead</p>
              </div>
            </div>
            <span className="text-brand-gold font-bold text-sm group-hover:translate-x-1 transition-transform hidden sm:block">Pay ahead →</span>
          </div>
        </button>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {(['all', 'pending', 'paid', 'overdue'] as FilterStatus[]).map(s => (
          <button key={s} onClick={() => { setFilter(s); setPage(1) }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize whitespace-nowrap transition-colors ${filter === s ? 'bg-brand-green text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-brand-green" size={32} /></div>
      ) : contributions.length === 0 ? (
        <div className="card p-12 text-center">
          <CreditCard size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No {filter === 'all' ? '' : filter} payments found</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-gray-500">
                  <th className="px-5 py-3 text-left font-medium">Group</th>
                  <th className="px-5 py-3 text-left font-medium">Due</th>
                  <th className="px-5 py-3 text-left font-medium hidden sm:table-cell">Paid</th>
                  <th className="px-5 py-3 text-left font-medium">Amount</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {contributions.map(c => (
                  <tr key={c.id} className={`hover:bg-gray-50 transition-colors ${c.is_flagged ? 'bg-red-50/50' : ''}`}>
                    <td className="px-5 py-3.5">
                      <span className="text-gray-800 font-medium">{c.susu_groups?.name}</span>
                      {c.is_flagged && <span className="ml-2 text-xs text-red-600 font-semibold">FLAGGED</span>}
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{format(new Date(c.due_date), 'MMM d, yyyy')}</td>
                    <td className="px-5 py-3.5 text-gray-500 hidden sm:table-cell">
                      {c.paid_at ? format(new Date(c.paid_at), 'MMM d · HH:mm') : '—'}
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-gray-900">
                      GHS {Number(c.amount).toFixed(2)}
                      {c.penalty_due && Number(c.penalty_due) > 0
                        ? <span className="block text-xs text-red-600 font-normal">+{Number(c.penalty_due).toFixed(2)} penalty</span>
                        : null}
                    </td>
                    <td className="px-5 py-3.5">{statusBadge(c.status)}</td>
                    <td className="px-5 py-3.5">
                      {c.status !== 'paid' ? (
                        <button onClick={() => handlePay(c)} disabled={payingId === c.id}
                          className="btn-primary text-xs px-3 py-1.5">
                          {payingId === c.id ? <Loader2 size={12} className="animate-spin" /> : 'Pay'}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 font-mono">{c.paystack_ref?.slice(-8) ?? '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > 20 && (
            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
              <span className="text-sm text-gray-500">{((page-1)*20)+1}–{Math.min(page*20, total)} of {total}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Previous</button>
                <button onClick={() => setPage(p => p+1)} disabled={page*20>=total}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── BULK PAY MODAL ── */}
      {showBulk && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowBulk(false)}>
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-6 space-y-5 animate-slide-up max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-extrabold text-brand-green text-xl">Pay Ahead</h2>
                <p className="text-gray-500 text-sm mt-0.5">Clear several days in one MoMo payment</p>
              </div>
              <button onClick={() => setShowBulk(false)} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
            </div>

            {/* Quick options */}
            <div className="grid grid-cols-3 gap-2">
              {QUICK_OPTIONS.map(({ days, label }) => (
                <button key={days} onClick={() => setBulkDays(days)}
                  className={`py-3 rounded-xl font-semibold text-sm transition-all ${bulkDays === days ? 'bg-brand-green text-white scale-105' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Custom slider */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-500">Or choose exactly</span>
                <span className="font-bold text-brand-green">{bulkDays} payment{bulkDays !== 1 ? 's' : ''}</span>
              </div>
              <input type="range" min={1} max={60} value={bulkDays}
                onChange={e => setBulkDays(parseInt(e.target.value))}
                className="w-full accent-brand-green" />
              <div className="flex justify-between text-xs text-gray-400 mt-1"><span>1</span><span>60</span></div>
            </div>

            {/* Preview */}
            {previewing ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin text-brand-green" size={28} /></div>
            ) : preview && preview.count > 0 ? (
              <>
                <div className="p-4 bg-brand-green-light rounded-2xl space-y-2.5">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Calendar size={14} />
                    <span>
                      {preview.from && format(new Date(preview.from), 'MMM d')} – {preview.to && format(new Date(preview.to), 'MMM d, yyyy')}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{preview.count} contribution{preview.count !== 1 ? 's' : ''}</span>
                    <span className="font-medium">GHS {Number(preview.subtotal).toFixed(2)}</span>
                  </div>
                  {preview.penalties > 0 && (
                    <div className="flex justify-between text-sm text-red-600">
                      <span>Late penalties</span>
                      <span className="font-medium">GHS {Number(preview.penalties).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2.5 border-t border-brand-green/20">
                    <span className="font-bold text-brand-green">Total to pay</span>
                    <span className="font-extrabold text-brand-green text-xl">GHS {Number(preview.total).toFixed(2)}</span>
                  </div>
                </div>

                <div className="max-h-32 overflow-y-auto space-y-1">
                  {preview.contributions?.slice(0, 10).map((c: any) => (
                    <div key={c.id} className="flex justify-between text-xs py-1.5 px-2 rounded-lg bg-gray-50">
                      <span className="text-gray-600">{format(new Date(c.due_date), 'EEE, MMM d')} · {c.susu_groups?.name}</span>
                      <span className="text-gray-800 font-medium">GHS {Number(c.amount).toFixed(2)}</span>
                    </div>
                  ))}
                  {preview.count > 10 && <p className="text-xs text-gray-400 text-center pt-1">+ {preview.count - 10} more</p>}
                </div>

                <button onClick={handleBulkPay} disabled={payingBulk}
                  className="w-full py-4 bg-brand-gold text-brand-green font-extrabold rounded-2xl hover:bg-amber-400 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 text-base">
                  {payingBulk ? <Loader2 size={20} className="animate-spin" /> : <><Zap size={18} /> Pay GHS {Number(preview.total).toFixed(2)} via MoMo</>}
                </button>
                <p className="text-xs text-gray-400 text-center">Single MoMo transaction · covers {preview.count} day{preview.count !== 1 ? 's' : ''}</p>
              </>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <CheckCircle size={32} className="mx-auto mb-2 text-emerald-400" />
                <p className="text-sm">Nothing left to pay — you're all caught up!</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
