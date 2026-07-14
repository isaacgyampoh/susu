'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { KYCApplication } from '@/types'
import { format } from 'date-fns'
import { Loader2, CheckCircle, XCircle, Eye, Copy, Check } from 'lucide-react'

export default function KYCPage() {
  const [apps, setApps]         = useState<KYCApplication[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [selected, setSelected] = useState<KYCApplication | null>(null)
  const [reason, setReason]     = useState('')
  const [processing, setProcessing] = useState(false)
  const [toast, setToast]       = useState('')
  const [createdCreds, setCreatedCreds] = useState<{ member_id: string; passcode: string } | null>(null)
  const [copied, setCopied]     = useState(false)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4000) }

  async function load() {
    setLoading(true)
    const token = getAdminToken()
    const { data, error } = await callFunction<KYCApplication[]>(`kyc-review?status=${filter}`, { token: token! })
    setApps(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  async function handleAction(action: 'approve' | 'reject') {
    if (!selected) return
    if (action === 'reject' && !reason.trim()) { alert('Please enter a rejection reason'); return }
    setProcessing(true)
    const token = getAdminToken()
    const { data, error } = await callFunction<{ message: string; member_id?: string; passcode?: string }>(
      `kyc-review?id=${selected.id}`,
      { method: 'POST', body: { action, rejection_reason: reason }, token: token! }
    )
    setProcessing(false)
    if (error) { alert(error); return }

    if (action === 'approve' && data?.passcode) {
      setCreatedCreds({ member_id: data.member_id!, passcode: data.passcode })
    } else {
      showToast(action === 'approve' ? '✅ Member approved' : '❌ Application rejected')
      setSelected(null)
      setReason('')
      load()
    }
  }

  function copyCredsToClipboard() {
    if (!createdCreds) return
    navigator.clipboard.writeText(`Member ID: ${createdCreds.member_id}\nPasscode: ${createdCreds.passcode}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function dismissCreds() {
    setCreatedCreds(null)
    setSelected(null)
    setReason('')
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto pb-12 animate-fade-in">
      {toast && <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm">{toast}</div>}

      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">KYC Applications</h1>
        <p className="text-gray-400 text-sm mt-1">Review and approve member applications</p>
      </div>

      <div className="flex gap-2 mb-6">
        {(['pending', 'approved', 'rejected'] as const).map(s => (
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
                <th className="px-5 py-3 text-left font-medium">Fee</th>
                <th className="px-5 py-3 text-left font-medium">Submitted</th>
                <th className="px-5 py-3 text-left font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {apps.map(app => (
                <tr key={app.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-4 text-white font-medium">{app.full_name}</td>
                  <td className="px-5 py-4 text-gray-400 hidden sm:table-cell">{app.phone}</td>
                  <td className="px-5 py-4 text-gray-400 hidden md:table-cell">{(app as any).susu_groups?.name}</td>
                  <td className="px-5 py-4">
                    <span className={app.registration_fee_paid ? 'badge-green' : 'badge-gold'}>
                      {app.registration_fee_paid ? 'Paid' : 'Pending'}
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

      {/* Review Modal */}
      {selected && !createdCreds && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg p-6 space-y-4 animate-slide-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-white text-lg">Review Application</h2>
            <div className="space-y-2 text-sm">
              {[
                ['Name', selected.full_name],
                ['Phone', selected.phone],
                ['Email', (selected as any).email ?? '—'],
                ['Ghana Card', selected.ghana_card_number],
                ['Group', (selected as any).susu_groups?.name ?? '—'],
                ['Reg. Fee', selected.registration_fee_paid ? '✅ Paid' : '⏳ Pending'],
                ['Status', selected.status],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-gray-800 pb-2">
                  <span className="text-gray-500">{k}</span>
                  <span className="text-white font-medium">{v}</span>
                </div>
              ))}
              {(selected as any).ghana_card_front_url && (
                <div className="flex gap-3 pt-2">
                  <a href={(selected as any).ghana_card_front_url} target="_blank" rel="noopener noreferrer" className="text-brand-gold text-xs underline">View Ghana Card Front</a>
                  {(selected as any).ghana_card_back_url && <a href={(selected as any).ghana_card_back_url} target="_blank" rel="noopener noreferrer" className="text-brand-gold text-xs underline">Back</a>}
                </div>
              )}
            </div>

            {selected.status === 'pending' && (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Rejection Reason (required if rejecting)</label>
                  <textarea className="w-full px-3 py-2 bg-gray-800 border border-gray-700 text-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold resize-none"
                    rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Could not verify Ghana Card number" />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleAction('approve')} disabled={processing}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-colors disabled:opacity-50">
                    {processing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />} Approve
                  </button>
                  <button onClick={() => handleAction('reject')} disabled={processing}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl transition-colors disabled:opacity-50">
                    {processing ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />} Reject
                  </button>
                </div>
              </>
            )}
            <button onClick={() => setSelected(null)} className="w-full text-gray-500 text-sm hover:text-gray-300 py-2">Close</button>
          </div>
        </div>
      )}

      {/* Credentials Modal — shown after approval (when no SMS configured) */}
      {createdCreds && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-emerald-700 rounded-2xl w-full max-w-md p-6 space-y-4 animate-slide-up">
            <div className="flex items-center gap-3">
              <CheckCircle size={28} className="text-emerald-400" />
              <h2 className="font-bold text-white text-lg">Member Approved!</h2>
            </div>
            <p className="text-gray-400 text-sm">Share these credentials with the member manually (SMS will be added later):</p>

            <div className="p-4 bg-gray-800 rounded-xl space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Member ID</span>
                <span className="text-white font-bold font-mono text-lg">{createdCreds.member_id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Passcode</span>
                <span className="text-brand-gold font-bold font-mono text-2xl tracking-widest">{createdCreds.passcode}</span>
              </div>
            </div>

            <button onClick={copyCredsToClipboard} className="w-full flex items-center justify-center gap-2 py-3 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-xl transition-colors">
              {copied ? <><Check size={16} className="text-emerald-400" /> Copied!</> : <><Copy size={16} /> Copy to Clipboard</>}
            </button>
            <p className="text-xs text-gray-500 text-center">Member logs in at /login with their phone number and this passcode.</p>
            <button onClick={dismissCreds} className="w-full py-3 bg-brand-gold text-brand-green font-bold rounded-xl hover:bg-amber-400 transition-colors">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
