'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { memberSignInUrl, credentialsMessage, whatsappLink } from '@/lib/member-link'
import type { KYCApplication } from '@/types'
import { format } from 'date-fns'
export default function KYCPage() {
  const [apps, setApps]         = useState<KYCApplication[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [payoutDates, setPayoutDates] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<KYCApplication | null>(null)
  const [reason, setReason]     = useState('')
  const [processing, setProcessing] = useState(false)
  const [toast, setToast]       = useState('')
  const [createdCreds, setCreatedCreds] = useState<{ member_id: string; passcode: string; full_name: string; phone: string; group?: string } | null>(null)
  const [copied, setCopied]     = useState(false)
  const [docBusy, setDocBusy]   = useState(false)

  /**
   * Ghana Cards live in a private bucket. This mints a URL good for two minutes
   * and records who looked. Opening a national ID should leave a trace.
   */
  async function openDocument(path: string, subject: string) {
    setDocBusy(true)
    const { data, error } = await callFunction<{ url: string }>('admin-document', {
      method: 'POST', body: { path, subject }, token: getAdminToken()!,
    })
    setDocBusy(false)
    if (error || !data?.url) { alert(error ?? 'Could not open document'); return }
    window.open(data.url, '_blank', 'noopener,noreferrer')
  }

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
      { method: 'POST', body: { action, rejection_reason: reason, payout_dates: payoutDates }, token: token! }
    )
    setProcessing(false)
    if (error) { alert(error); return }

    if (action === 'approve' && data?.passcode) {
      setCreatedCreds({
        member_id: data.member_id!,
        passcode:  data.passcode,
        full_name: selected.full_name,
        phone:     selected.phone,
        group:     ((selected as any).selected_groups?.map((g: any) => g.name).join(', ')) ?? (selected as any).susu_groups?.name,
      })
    } else {
      showToast(action === 'approve' ? 'Member approved' : 'Application rejected')
      setSelected(null)
      setReason('')
      setPayoutDates({})
      load()
    }
  }

  const shareText = createdCreds ? credentialsMessage(createdCreds) : ''

  function copyCredsToClipboard() {
    if (!createdCreds) return
    navigator.clipboard.writeText(shareText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function shareWhatsApp() {
    if (!createdCreds) return
    window.open(whatsappLink(createdCreds.phone, shareText), '_blank')
  }

  function dismissCreds() {
    setCreatedCreds(null)
    setSelected(null)
    setReason('')
    load()
  }

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      {toast && <div className="fixed top-4 right-4 z-50 bg-paper text-ink px-5 py-3 rounded-[10px]  text-sm">{toast}</div>}

      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink">KYC Applications</h1>
        <p className="text-ink-2 text-sm mt-1">Review and approve member applications</p>
      </div>

      <div className="flex gap-2 mb-6">
        {(['pending', 'approved', 'rejected'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${filter === s ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">Loading…</div>
      ) : apps.length === 0 ? (
        <div className="text-center py-20 text-ink-2">No {filter} applications</div>
      ) : (
        <div className="border border-line rounded-[10px] overflow-hidden">
          <div className="scroll-x">
            <table className="w-full text-sm min-w-[620px] lg:min-w-0">
            <thead className="border-b border-line">
              <tr className="text-ink-2">
                <th className="px-5 py-3 text-left font-medium">Applicant</th>
                <th className="px-5 py-3 text-left font-medium hidden sm:table-cell">Phone</th>
                <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Group</th>
                <th className="px-5 py-3 text-left font-medium">Fee</th>
                <th className="px-5 py-3 text-left font-medium">Submitted</th>
                <th className="px-5 py-3 text-left font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {apps.map(app => (
                <tr key={app.id} className="hover:bg-tint transition-colors">
                  <td className="px-5 py-4 text-ink font-medium">{app.full_name}</td>
                  <td className="px-5 py-4 text-ink-2 hidden sm:table-cell">{app.phone}</td>
                  <td className="px-5 py-4 text-ink-2 hidden md:table-cell">{((app as any).selected_groups?.map((g: any) => g.name).join(', ')) ?? (app as any).susu_groups?.name}</td>
                  <td className="px-5 py-4">
                    <span className={app.registration_fee_paid ? 'badge-green' : 'badge-gold'}>
                      {app.registration_fee_paid ? 'Paid' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-ink-2">{format(new Date(app.submitted_at), 'MMM d, yyyy')}</td>
                  <td className="px-5 py-4">
                    <button onClick={() => setSelected(app)} className="p-1.5 text-ink-2 hover:text-ink transition-colors">
                      </button>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {selected && !createdCreds && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="border border-line rounded-[10px] w-full max-w-lg p-6 space-y-4 animate-slide-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-ink text-lg">Review Application</h2>
            <div className="space-y-2 text-sm">
              {[
                ['Name', selected.full_name],
                ['Phone', selected.phone],
                ['Email', (selected as any).email ?? '—'],
                ['Ghana Card', selected.ghana_card_number],
                [((selected as any).selected_groups?.length ?? 0) > 1 ? 'Groups' : 'Group', ((selected as any).selected_groups?.map((g: any) => g.name).join(', ')) ?? (selected as any).susu_groups?.name ?? '—'],
                ['Reg. Fee', selected.registration_fee_paid ? 'Paid' : '⏳ Pending'],
                ['Status', selected.status],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-line pb-2">
                  <span className="text-ink-2">{k}</span>
                  <span className="text-ink font-medium">{v}</span>
                </div>
              ))}
              {(selected as any).ghana_card_front_url && (
                <div className="flex gap-3 pt-2">
                  <a href={(selected as any).ghana_card_front_url} target="_blank" rel="noopener noreferrer" className="text-ink text-xs underline">View Ghana Card Front</a>
                  {(selected as any).ghana_card_back_url && <a href={(selected as any).ghana_card_back_url} target="_blank" rel="noopener noreferrer" className="text-ink text-xs underline">Back</a>}
                </div>
              )}
            </div>

            {selected.status === 'pending' && (
              <>
                <div className="border border-line rounded-[10px] p-3 space-y-2.5">
                  <p className="text-sm font-semibold text-ink">Payout date{(((selected as any).selected_groups?.length ?? 1) > 1) ? 's' : ''} <span className="text-ink-3 font-normal">(when approving)</span></p>
                  {(((selected as any).selected_groups) ?? [{ id: (selected as any).selected_group_id, name: (selected as any).susu_groups?.name ?? 'Group' }]).map((g: any) => (
                    <div key={g.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-ink-2 flex-1 truncate">{g.name}</span>
                      <input type="date" value={payoutDates[g.id] ?? ''}
                        onChange={e => setPayoutDates(prev => ({ ...prev, [g.id]: e.target.value }))}
                        className="px-3 py-2 bg-tint border border-line text-ink rounded-[10px] text-sm focus:outline-none focus:border-ink" />
                    </div>
                  ))}
                  <p className="text-xs text-ink-3">When the member will receive their payout in each group. Leave blank to set later on the member's page.</p>
                </div>
                <div>
                  <label className="block text-sm text-ink-2 mb-1.5">Rejection Reason (required if rejecting)</label>
                  <textarea className="w-full px-3 py-2 bg-tint border border-line text-ink rounded-[10px] text-sm focus:outline-none focus:ring-0 focus:border-ink resize-none"
                    rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Could not verify Ghana Card number" />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleAction('approve')} disabled={processing}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-ink text-white font-semibold rounded-[10px] transition-colors disabled:opacity-50">
                    {processing ? '…' : ''} Approve
                  </button>
                  <button onClick={() => handleAction('reject')} disabled={processing}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-red text-white font-semibold rounded-[10px] transition-colors disabled:opacity-50">
                    {processing ? '…' : ''} Reject
                  </button>
                </div>
              </>
            )}
            <button onClick={() => setSelected(null)} className="w-full text-ink-2 text-sm hover:text-ink py-2">Close</button>
          </div>
        </div>
      )}

      {/* Approved: the only job left is getting the link to the member. */}
      {createdCreds && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-xl w-full max-w-[420px] p-6 animate-fade-in">
            <p className="t-label">Approved</p>
            <h2 className="text-[20px] font-semibold tracking-[-.02em] mt-1">{createdCreds.full_name}</h2>
            <p className="text-[12.5px] text-ink-2 mt-1">
              Send them the link below. They cannot sign in until you do.
            </p>

            <table className="w-full mt-5">
              <tbody className="divide-y divide-line border-y border-line">
                <tr>
                  <td className="py-2.5 text-[12.5px] text-ink-2">Portal link</td>
                  <td className="py-2.5 text-right text-[12px] font-medium break-all">{memberSignInUrl()}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-[12.5px] text-ink-2">Phone</td>
                  <td className="py-2.5 text-right text-[13px] font-medium tnum">{createdCreds.phone}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-[12.5px] text-ink-2">Passcode</td>
                  <td className="py-2.5 text-right text-[20px] font-semibold tnum tracking-[.12em]">{createdCreds.passcode}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-[12.5px] text-ink-2">Member ID</td>
                  <td className="py-2.5 text-right text-[13px] font-medium">{createdCreds.member_id}</td>
                </tr>
              </tbody>
            </table>

            <p className="text-[11.5px] text-ink-3 mt-3">
              The passcode is shown once. If it is lost, reset it from the member&apos;s page.
            </p>

            <div className="flex gap-2 mt-5">
              <button onClick={shareWhatsApp} className="btn-dark flex-1">Send on WhatsApp</button>
              <button onClick={copyCredsToClipboard} className="btn-line">{copied ? 'Copied' : 'Copy'}</button>
            </div>

            <button onClick={dismissCreds} className="btn-ghost w-full mt-2">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
