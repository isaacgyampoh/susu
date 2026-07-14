'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { Payout } from '@/types'
import { format } from 'date-fns'
import { Loader2, CheckCircle, Send } from 'lucide-react'

export default function PayoutsPage() {
  const [payouts, setPayouts]   = useState<Payout[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'upcoming' | 'paid' | 'all'>('upcoming')
  const [selected, setSelected] = useState<Payout | null>(null)
  const [notes, setNotes]       = useState('')
  const [ref, setRef]           = useState('')
  const [processing, setProcessing] = useState(false)
  const [toast, setToast]       = useState('')

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(''), 3000) }

  async function load() {
    setLoading(true)
    const token = getAdminToken()
    const { data } = await callFunction<{ payouts: Payout[] }>(
      `payouts-admin?status=${filter}`, { token: token! }
    )
    setPayouts(data?.payouts ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  async function markPaid() {
    if (!selected) return
    setProcessing(true)
    const token = getAdminToken()
    const { error } = await callFunction('payouts-admin', {
      method: 'PATCH',
      body: { payout_id: selected.id, notes, paystack_transfer_ref: ref },
      token: token!,
    })
    setProcessing(false)
    if (error) { alert(error); return }
    showToast('✅ Payout marked as paid. Member notified via SMS.')
    setSelected(null)
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto pb-12 animate-fade-in">
      {toast && <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm">{toast}</div>}

      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">Payouts</h1>
        <p className="text-gray-400 text-sm mt-1">Manage and record member payouts</p>
      </div>

      <div className="flex gap-2 mb-6">
        {(['upcoming','paid','all'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${filter === s ? 'bg-brand-gold text-brand-green' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-gold" size={32} /></div>
      ) : payouts.length === 0 ? (
        <div className="text-center py-20 text-gray-500">No {filter} payouts</div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-800">
              <tr className="text-gray-500">
                <th className="px-5 py-3 text-left font-medium">Member</th>
                <th className="px-5 py-3 text-left font-medium">Group</th>
                <th className="px-5 py-3 text-left font-medium">Amount</th>
                <th className="px-5 py-3 text-left font-medium">Due Date</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {payouts.map(p => (
                <tr key={p.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-4">
                    <p className="text-white font-medium">{p.members?.full_name}</p>
                    <p className="text-gray-500 text-xs">{p.members?.member_id} · {p.members?.mobile_money_number ?? p.members?.bank_account_number ?? '—'}</p>
                  </td>
                  <td className="px-5 py-4 text-gray-400">{p.susu_groups?.name}</td>
                  <td className="px-5 py-4 text-brand-gold font-bold">GHS {Number(p.total_amount).toLocaleString()}</td>
                  <td className="px-5 py-4 text-gray-400">{format(new Date(p.scheduled_date), 'MMM d, yyyy')}</td>
                  <td className="px-5 py-4">
                    <span className={p.status === 'paid' ? 'badge-green' : p.status === 'processing' ? 'badge-blue' : 'badge-gold'}>{p.status}</span>
                  </td>
                  <td className="px-5 py-4">
                    {p.status !== 'paid' && (
                      <button onClick={() => { setSelected(p); setNotes(''); setRef('') }}
                        className="flex items-center gap-1.5 text-xs text-brand-gold hover:text-white transition-colors font-medium">
                        <Send size={13} /> Mark Paid
                      </button>
                    )}
                    {p.status === 'paid' && <CheckCircle size={16} className="text-emerald-500" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mark paid modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-white text-lg">Record Payout</h2>
            <div className="p-4 bg-gray-800 rounded-xl space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Member</span><span className="text-white">{selected.members?.full_name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="text-brand-gold font-bold">GHS {Number(selected.total_amount).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Due</span><span className="text-white">{format(new Date(selected.scheduled_date), 'MMM d, yyyy')}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">MoMo/Bank</span><span className="text-white text-xs">{selected.members?.mobile_money_number ?? selected.members?.bank_account_number ?? '—'}</span></div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Paystack Transfer Reference (optional)</label>
              <input className="w-full px-3 py-2 bg-gray-800 border border-gray-700 text-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                value={ref} onChange={e => setRef(e.target.value)} placeholder="TRF_XXXXXXXXXXXXXXX" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Notes (optional)</label>
              <textarea className="w-full px-3 py-2 bg-gray-800 border border-gray-700 text-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Sent via MTN MoMo" />
            </div>
            <button onClick={markPaid} disabled={processing}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors disabled:opacity-50">
              {processing ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
              Confirm Payout Sent
            </button>
            <button onClick={() => setSelected(null)} className="w-full text-gray-500 text-sm hover:text-gray-300 transition-colors py-2">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
