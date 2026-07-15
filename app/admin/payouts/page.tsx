'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { Payout } from '@/types'
import { format } from 'date-fns'
import { Loader2, CheckCircle, Send, AlertTriangle, ShieldCheck, ShieldAlert, Copy, Check } from 'lucide-react'

type Eligibility = {
  eligible: boolean; reason: string
  gross_amount: number; outstanding_contrib: number; outstanding_penalty: number
  registration_fee: number; net_amount: number
  contributions_paid: number; contributions_due: number
}

const ghs = (n: any) => `GHS ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function PayoutsPage() {
  const [payouts, setPayouts]   = useState<Payout[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'upcoming' | 'paid' | 'all'>('upcoming')
  const [selected, setSelected] = useState<Payout | null>(null)
  const [elig, setElig]         = useState<Eligibility | null>(null)
  const [checking, setChecking] = useState(false)
  const [notes, setNotes]       = useState('')
  const [ref, setRef]           = useState('')
  const [override, setOverride] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [toast, setToast]       = useState('')
  const [copiedMomo, setCopiedMomo] = useState(false)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000) }

  async function load() {
    setLoading(true)
    const token = getAdminToken()
    const { data } = await callFunction<{ payouts: Payout[] }>(`payouts-admin?status=${filter}`, { token: token! })
    setPayouts(data?.payouts ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  async function openPayout(p: Payout) {
    setSelected(p); setNotes(''); setRef(''); setOverride(false); setElig(null)
    setChecking(true)
    const token = getAdminToken()
    const { data } = await callFunction<{ eligibility: Eligibility }>(
      `payouts-admin?eligibility=${p.id}`, { token: token! }
    )
    setElig(data?.eligibility ?? null)
    setChecking(false)
  }

  async function markPaid() {
    if (!selected) return
    setProcessing(true)
    const token = getAdminToken()
    const { data, error } = await callFunction<any>('payouts-admin', {
      method: 'PATCH',
      body: { payout_id: selected.id, notes, paystack_transfer_ref: ref, override_eligibility: override },
      token: token!,
    })
    setProcessing(false)
    if (error) { showToast('❌ ' + error); return }
    showToast(`✅ Payout of ${ghs(data?.net_amount)} recorded · member notified`)
    setSelected(null)
    load()
  }

  function copyMomo(num?: string) {
    if (!num) return
    navigator.clipboard.writeText(num)
    setCopiedMomo(true)
    setTimeout(() => setCopiedMomo(false), 2000)
  }

  const momo = (selected?.members as any)?.mobile_money_number

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto pb-12 animate-fade-in">
      {toast && <div className="fixed top-4 right-4 z-50 bg-gray-900 border border-gray-700 text-white px-5 py-3 rounded-xl shadow-lg text-sm max-w-sm">{toast}</div>}

      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">Payouts</h1>
        <p className="text-gray-400 text-sm mt-1">Every payout is checked against the member's balance before you can release it</p>
      </div>

      <div className="flex gap-2 mb-6">
        {(['upcoming', 'paid', 'all'] as const).map(s => (
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-800">
                <tr className="text-gray-500">
                  <th className="px-5 py-3 text-left font-medium">Member</th>
                  <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Group</th>
                  <th className="px-5 py-3 text-left font-medium">Amount</th>
                  <th className="px-5 py-3 text-left font-medium">Date</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {payouts.map(p => (
                  <tr key={p.id} className="hover:bg-gray-800/50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="text-white font-medium">{p.members?.full_name}</p>
                      <p className="text-gray-500 text-xs font-mono">
                        {p.members?.member_id} · {(p.members as any)?.mobile_money_number ?? 'no MoMo'}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-gray-400 hidden md:table-cell">{p.susu_groups?.name}</td>
                    <td className="px-5 py-4">
                      <span className="text-brand-gold font-bold">{ghs(p.total_amount)}</span>
                      {(p as any).net_amount && Number((p as any).net_amount) !== Number(p.total_amount) && (
                        <p className="text-xs text-gray-500">net: {ghs((p as any).net_amount)}</p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-400">{format(new Date(p.scheduled_date), 'MMM d, yyyy')}</td>
                    <td className="px-5 py-4">
                      <span className={p.status === 'paid' ? 'badge-green' : p.status === 'processing' ? 'badge-blue' : 'badge-gold'}>{p.status}</span>
                    </td>
                    <td className="px-5 py-4">
                      {p.status !== 'paid' ? (
                        <button onClick={() => openPayout(p)}
                          className="flex items-center gap-1.5 text-xs text-brand-gold hover:text-white transition-colors font-medium">
                          <Send size={13} /> Review & Pay
                        </button>
                      ) : <CheckCircle size={16} className="text-emerald-500" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PAYOUT MODAL WITH ELIGIBILITY ── */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg p-6 space-y-4 animate-slide-up max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>

            <div>
              <h2 className="font-bold text-white text-lg">Review Payout</h2>
              <p className="text-gray-500 text-sm">{selected.members?.full_name} · {selected.members?.member_id}</p>
            </div>

            {checking ? (
              <div className="flex flex-col items-center py-10 gap-3">
                <Loader2 className="animate-spin text-brand-gold" size={28} />
                <p className="text-gray-500 text-sm">Checking eligibility…</p>
              </div>
            ) : elig ? (
              <>
                {/* Eligibility banner */}
                <div className={`p-4 rounded-xl border flex items-start gap-3 ${elig.eligible ? 'bg-emerald-900/20 border-emerald-700/40' : 'bg-red-900/20 border-red-700/40'}`}>
                  {elig.eligible
                    ? <ShieldCheck size={20} className="text-emerald-400 mt-0.5 shrink-0" />
                    : <ShieldAlert size={20} className="text-red-400 mt-0.5 shrink-0" />
                  }
                  <div>
                    <p className={`font-semibold text-sm ${elig.eligible ? 'text-emerald-300' : 'text-red-300'}`}>
                      {elig.eligible ? 'Eligible for payout' : 'NOT eligible'}
                    </p>
                    <p className="text-gray-400 text-xs mt-0.5">{elig.reason}</p>
                    <p className="text-gray-500 text-xs mt-1">
                      {elig.contributions_paid}/{elig.contributions_due} contributions paid up to payout date
                    </p>
                  </div>
                </div>

                {/* Money breakdown */}
                <div className="p-4 bg-gray-800 rounded-xl space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Cashout amount</span>
                    <span className="text-white font-medium">{ghs(elig.gross_amount)}</span>
                  </div>
                  {Number(elig.registration_fee) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">+ Registration fee back</span>
                      <span className="text-emerald-400 font-medium">+{ghs(elig.registration_fee)}</span>
                    </div>
                  )}
                  {Number(elig.outstanding_contrib) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-red-400">− Unpaid contributions</span>
                      <span className="text-red-400 font-medium">−{ghs(elig.outstanding_contrib)}</span>
                    </div>
                  )}
                  {Number(elig.outstanding_penalty) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-red-400">− Unpaid penalties</span>
                      <span className="text-red-400 font-medium">−{ghs(elig.outstanding_penalty)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2.5 border-t border-gray-700">
                    <span className="font-bold text-white">Send to member</span>
                    <span className="font-extrabold text-brand-gold text-xl">{ghs(elig.net_amount)}</span>
                  </div>
                </div>

                {/* MoMo destination */}
                <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500">Send via {(selected.members as any)?.mobile_money_provider ?? 'MoMo'}</p>
                    <p className="text-white font-mono font-bold">{momo ?? '⚠️ No MoMo number on file'}</p>
                  </div>
                  {momo && (
                    <button onClick={() => copyMomo(momo)} className="p-2 text-gray-400 hover:text-white transition-colors">
                      {copiedMomo ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                    </button>
                  )}
                </div>

                {/* Override */}
                {!elig.eligible && (
                  <label className="flex items-start gap-2.5 p-3 bg-amber-900/20 border border-amber-700/40 rounded-xl cursor-pointer">
                    <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-amber-500 shrink-0" />
                    <span className="text-xs text-amber-300">
                      <strong>Override the block and pay anyway.</strong> The unpaid amount will be deducted from what you send. This action is recorded in the audit log.
                    </span>
                  </label>
                )}

                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">MoMo Transaction Reference</label>
                  <input value={ref} onChange={e => setRef(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 text-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
                    placeholder="Paste the MoMo transaction ID after sending" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Notes (optional)</label>
                  <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 text-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold resize-none"
                    placeholder="e.g. Sent via MTN MoMo at 14:32" />
                </div>

                <button onClick={markPaid} disabled={processing || (!elig.eligible && !override)}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {processing ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                  {!elig.eligible && !override ? 'Blocked — tick override to proceed' : `Confirm ${ghs(elig.net_amount)} Sent`}
                </button>
              </>
            ) : (
              <p className="text-red-400 text-sm text-center py-8">Could not run eligibility check.</p>
            )}

            <button onClick={() => setSelected(null)} className="w-full text-gray-500 text-sm hover:text-gray-300 py-2">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
