'use client'
import { useEffect, useState } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { Contribution } from '@/types'
import { format } from 'date-fns'
import { Loader2, CreditCard, CheckCircle, Clock, AlertCircle } from 'lucide-react'

type FilterStatus = 'all' | 'paid' | 'pending' | 'overdue'

function statusBadge(s: string) {
  if (s === 'paid')    return <span className="badge-green">Paid</span>
  if (s === 'overdue') return <span className="badge-red">Overdue</span>
  return <span className="badge-gold">Pending</span>
}

function statusIcon(s: string) {
  if (s === 'paid')    return <CheckCircle size={16} className="text-emerald-500" />
  if (s === 'overdue') return <AlertCircle size={16} className="text-red-500" />
  return <Clock size={16} className="text-amber-500" />
}

export default function PaymentsPage() {
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [loading, setLoading]             = useState(true)
  const [filter, setFilter]               = useState<FilterStatus>('all')
  const [payingId, setPayingId]           = useState<string | null>(null)
  const [page, setPage]                   = useState(1)
  const [total, setTotal]                 = useState(0)

  useEffect(() => {
    setLoading(true)
    const token = getMemberToken()
    const params = filter === 'all' ? `page=${page}` : `status=${filter}&page=${page}`
    callFunction<{ contributions: Contribution[]; total: number }>(
      `contributions-list?${params}`, { token: token! }
    ).then(({ data }) => {
      setContributions(data?.contributions ?? [])
      setTotal(data?.total ?? 0)
    }).finally(() => setLoading(false))
  }, [filter, page])

  async function handlePay(c: Contribution) {
    const token = getMemberToken()
    setPayingId(c.id)
    const { data, error } = await callFunction<{ authorization_url?: string; dev_mode?: boolean; message?: string }>(
      'payments-initialize',
      { method: 'POST', body: { contribution_id: c.id }, token: token! }
    )
    setPayingId(null)
    if (error) { alert(error); return }
    if (data?.dev_mode) { window.location.reload() } else if (data?.authorization_url) { window.location.href = data.authorization_url }
  }

  const totalPaid    = contributions.filter(c => c.status === 'paid').reduce((s, c) => s + Number(c.amount), 0)
  const totalPending = contributions.filter(c => c.status !== 'paid').reduce((s, c) => s + Number(c.amount), 0)

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto pb-12 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-brand-green">My Payments</h1>
        <p className="text-gray-500 text-sm mt-1">Full history of your Susu contributions</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-emerald-600 mb-1"><CheckCircle size={16} /><span className="text-xs font-medium">Total Paid</span></div>
          <div className="font-bold text-gray-900">GHS {totalPaid.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-amber-500 mb-1"><Clock size={16} /><span className="text-xs font-medium">Balance Due</span></div>
          <div className="font-bold text-gray-900">GHS {totalPending.toFixed(2)}</div>
        </div>
        <div className="card p-4 col-span-2 sm:col-span-1">
          <div className="flex items-center gap-2 text-blue-500 mb-1"><CreditCard size={16} /><span className="text-xs font-medium">Total Records</span></div>
          <div className="font-bold text-gray-900">{total}</div>
        </div>
      </div>

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
                  <th className="px-5 py-3 text-left font-medium">Due Date</th>
                  <th className="px-5 py-3 text-left font-medium hidden sm:table-cell">Paid On</th>
                  <th className="px-5 py-3 text-left font-medium">Amount</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {contributions.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        {statusIcon(c.status)}
                        <span className="text-gray-800 font-medium">{c.susu_groups?.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{format(new Date(c.due_date), 'MMM d, yyyy')}</td>
                    <td className="px-5 py-3.5 text-gray-500 hidden sm:table-cell">
                      {c.paid_at ? format(new Date(c.paid_at), 'MMM d, yyyy HH:mm') : '—'}
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-gray-900">GHS {Number(c.amount).toFixed(2)}</td>
                    <td className="px-5 py-3.5">{statusBadge(c.status)}</td>
                    <td className="px-5 py-3.5">
                      {c.status !== 'paid' ? (
                        <button onClick={() => handlePay(c)} disabled={payingId === c.id}
                          className="btn-primary text-xs px-3 py-1.5">
                          {payingId === c.id ? <Loader2 size={12} className="animate-spin" /> : 'Pay Now'}
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

          {/* Pagination */}
          {total > 20 && (
            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
              <span className="text-sm text-gray-500">Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, total)} of {total}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Previous</button>
                <button onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
