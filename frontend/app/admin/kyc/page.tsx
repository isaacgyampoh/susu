'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { KYCApplication } from '@/types'
import { format } from 'date-fns'
import { Loader2, CheckCircle, XCircle, Eye } from 'lucide-react'

export default function KYCPage() {
  const [apps, setApps]       = useState<KYCApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [selected, setSelected] = useState<KYCApplication | null>(null)
  const [reason, setReason]   = useState('')
  const [processing, setProcessing] = useState(false)
  const [toast, setToast]     = useState('')

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  async function load() {
    setLoading(true)
    const token = getAdminToken()
    const { data } = await callFunction<{ applications?: KYCApplication[] }>(
      `admin-members?status=${filter}`, { token: token! }
    )
    // Using KYC applications from a separate query
    const { data: kycData } = await callFunction<KYCApplication[]>(
      `kyc-review?status=${filter}`, { token: token! }
    )
    setApps(Array.isArray(kycData) ? kycData : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  async function handleAction(action: 'approve' | 'reject') {
    if (!selected) return
    if (action === 'reject' && !reason.trim()) { alert('Please enter a rejection reason'); return }
    setProcessing(true)
    const token = getAdminToken()
    const { error } = await callFunction(`kyc-review?id=${selected.id}`, {
      method: 'POST', body: { action, rejection_reason: reason }, token: token!,
    })
    setProcessing(false)
    if (error) { alert(error); return }
    showToast(action === 'approve' ? '✅ Member approved and notified via SMS' : '❌ Application rejected and applicant notified')
    setSelected(null)
    setReason('')
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto pb-12 animate-fade-in">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm">{toast}</div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white">KYC Applications</h1>
          <p className="text-gray-400 text-sm mt-1">Review and approve member applications</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {(['pending','approved','rejected'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${filter === s ? 'bg-brand-gold text-brand-green' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-gold" size={32} /></div>
      ) : apps.length === 0 ? (
        <div className="text-center py-20 text-gray-500">No {filter} applications</div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-800">
              <tr className="text-gray-500">
                <th className="px-5 py-3 text-left font-medium">Applicant</th>
                <th className="px-5 py-3 text-left font-medium hidden sm:table-cell">Phone</th>
                <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Group</th>
                <th className="px-5 py-3 text-left font-medium">Fee Paid</th>
                <th className="px-5 py-3 text-left font-medium">Submitted</th>
                <th className="px-5 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {apps.map((app) => (
                <tr key={app.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-4 text-white font-medium">{app.full_name}</td>
                  <td className="px-5 py-4 text-gray-400 hidden sm:table-cell">{app.phone}</td>
                  <td className="px-5 py-4 text-gray-400 hidden md:table-cell">{app.susu_groups?.name}</td>
                  <td className="px-5 py-4">
                    <span className={app.registration_fee_paid ? 'badge-green' : 'badge-red'}>
                      {app.registration_fee_paid ? 'Paid' : 'Unpaid'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-gray-400">{format(new Date(app.submitted_at), 'MMM d, yyyy')}</td>
                  <td className="px-5 py-4">
                    <button onClick={() => setSelected(app)} className="p-1.5 text-gray-400 hover:text-white transition-colors">
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Review modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-white text-lg">Review Application</h2>
            <div className="space-y-2 text-sm">
              {[
                ['Name',           selected.full_name],
                ['Phone',          selected.phone],
                ['Email',          selected.email ?? '—'],
                ['Ghana Card',     selected.ghana_card_number],
                ['Group',          selected.susu_groups?.name ?? '—'],
                ['Fee Paid',       selected.registration_fee_paid ? '✅ Yes' : '❌ No'],
                ['Status',         selected.status],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-gray-800 pb-2">
                  <span className="text-gray-500">{k}</span>
                  <span className="text-white font-medium">{v}</span>
                </div>
              ))}
              {selected.ghana_card_front_url && (
                <div className="flex gap-2 pt-2">
                  <a href={selected.ghana_card_front_url} target="_blank" className="text-brand-gold text-xs underline">View Front</a>
                  {selected.ghana_card_back_url && <a href={selected.ghana_card_back_url} target="_blank" className="text-brand-gold text-xs underline">View Back</a>}
                </div>
              )}
            </div>

            {selected.status === 'pending' && (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Rejection Reason (required if rejecting)</label>
                  <textarea
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 text-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                    rows={2} value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="e.g. Could not verify Ghana Card number"
                  />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleAction('approve')} disabled={processing || !selected.registration_fee_paid}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-colors disabled:opacity-50">
                    {processing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />} Approve
                  </button>
                  <button onClick={() => handleAction('reject')} disabled={processing}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl transition-colors disabled:opacity-50">
                    {processing ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />} Reject
                  </button>
                </div>
                {!selected.registration_fee_paid && <p className="text-amber-400 text-xs">⚠️ Registration fee not paid. Cannot approve yet.</p>}
              </>
            )}

            <button onClick={() => setSelected(null)} className="w-full text-gray-500 text-sm hover:text-gray-300 transition-colors py-2">Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
