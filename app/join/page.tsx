'use client'
import { useEffect, useState } from 'react'
import { callFunction } from '@/lib/supabase'
import type { SusuGroup } from '@/types'

/*
 * Public application form — no sign-in required. A prospective member
 * picks ONE OR SEVERAL susu groups, fills in their details, uploads
 * their Ghana Card, and submits. The application lands in the admin
 * KYC queue; if Paystack is configured and fees apply, they're sent
 * to pay the combined registration fee.
 */

const n0 = (v: any) => Number(v ?? 0).toLocaleString('en-GH')

export default function JoinPage() {
  const [groups, setGroups]   = useState<SusuGroup[]>([])
  const [picked, setPicked]   = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState('')
  const [done, setDone]       = useState<{ fee: number; paid: boolean } | null>(null)

  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', ghana_card_number: '',
    date_of_birth: '', occupation: '', residential_address: '',
    mobile_money_number: '', mobile_money_provider: 'MTN',
  })

  useEffect(() => {
    callFunction<{ groups: SusuGroup[] }>('groups-public')
      .then(({ data }) => setGroups((data?.groups ?? []).filter(g => g.current_members < g.max_members)))
      .finally(() => setLoading(false))
  }, [])

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))
  const toggle = (id: string) =>
    setPicked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const pickedGroups = groups.filter(g => picked.has(g.id))
  const totalFee     = pickedGroups.reduce((s, g) => s + Number(g.registration_fee || 0), 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (picked.size === 0) { setError('Select at least one susu group to join.'); return }
    if (!form.full_name || !form.phone || !form.ghana_card_number) {
      setError('Full name, phone number and Ghana Card number are required.'); return
    }

    setSending(true)
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => v && fd.append(k, v))
    fd.append('selected_group_ids', Array.from(picked).join(','))

    const { data, error: err } = await callFunction<{
      kyc_id: string; fee: number; fee_paid: boolean
      paystack: { authorization_url: string } | null
    }>('kyc-submit', { method: 'POST', body: fd })
    setSending(false)
    if (err) { setError(err); return }

    // Registration fee due online? Send them straight to payment.
    if (data?.paystack?.authorization_url) {
      window.location.href = data.paystack.authorization_url
      return
    }
    setDone({ fee: data?.fee ?? 0, paid: !!data?.fee_paid })
    window.scrollTo(0, 0)
  }

  const field = "w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"

  if (done) {
    return (
      <div className="min-h-screen grid place-items-center px-5 py-10">
        <div className="max-w-[440px] w-full text-center animate-fade-in">
          <div className="text-5xl mb-4">🎉</div>
          <h1 className="text-2xl font-extrabold text-ink">Application received!</h1>
          <p className="text-ink-2 text-sm mt-3">
            Thank you — your application to join{' '}
            <span className="font-semibold text-ink">{picked.size} group{picked.size > 1 ? 's' : ''}</span> has been submitted.
            We'll review it and send your sign-in details by SMS once approved.
          </p>
          {done.fee > 0 && !done.paid && (
            <p className="text-ink-2 text-sm mt-3">
              A registration fee of <span className="font-semibold text-ink">GHS {n0(done.fee)}</span> applies —
              our team will contact you to collect it.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 sm:px-5 py-8 sm:py-12">
      <div className="max-w-[560px] mx-auto animate-fade-in">
        <p className="text-[12px] font-bold tracking-[.14em] uppercase text-ink-3">Abbie Wealth Susu</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mt-1.5">Join a Susu Group</h1>
        <p className="text-ink-2 text-sm mt-2">
          Choose one or more groups below, tell us about yourself, and we'll set you up.
        </p>

        {error && <div className="p-3 mt-5 bg-tint border border-red/40 rounded-[10px] text-red text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="mt-6 space-y-6 pb-10">

          {/* ── Group selection (multi) ── */}
          <div className="border border-line rounded-[10px] p-4 sm:p-5">
            <h2 className="font-semibold text-ink text-sm mb-1">Choose your group{groups.length > 1 ? 's' : ''} *</h2>
            <p className="text-xs text-ink-3 mb-3">You can join more than one — each has its own contributions and payout.</p>

            {loading ? (
              <p className="text-sm text-ink-3 py-4">Loading groups…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-ink-3 py-4">No groups are open for joining right now. Please check back soon.</p>
            ) : (
              <div className="space-y-2.5">
                {groups.map(g => {
                  const checked = picked.has(g.id)
                  return (
                    <label key={g.id}
                      className={`flex items-start gap-3 p-3.5 border rounded-[10px] cursor-pointer transition-colors ${
                        checked ? 'border-ink bg-tint' : 'border-line hover:border-ink/40'}`}>
                      <input type="checkbox" className="w-4 h-4 mt-0.5 accent-green"
                        checked={checked} onChange={() => toggle(g.id)} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-ink">{g.name}</span>
                        <span className="block text-xs text-ink-2 mt-0.5">
                          Pay GHS {n0(g.contribution_amount)} {g.contribution_frequency} · Receive GHS {n0(g.cashout_amount)}
                        </span>
                        <span className="block text-[11px] text-ink-3 mt-0.5">
                          {g.max_members - g.current_members} spot{g.max_members - g.current_members === 1 ? '' : 's'} left
                          {Number(g.registration_fee) > 0 && <> · Registration GHS {n0(g.registration_fee)}</>}
                        </span>
                        {g.description && <span className="block text-[11px] text-ink-3 mt-1">{g.description}</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            {picked.size > 0 && (
              <div className="mt-3 p-3 bg-tint border border-line rounded-[10px] text-sm flex items-center justify-between">
                <span className="text-ink-2">{picked.size} group{picked.size > 1 ? 's' : ''} selected</span>
                <span className="font-semibold text-ink">
                  {totalFee > 0 ? `Registration total: GHS ${n0(totalFee)}` : 'No registration fee'}
                </span>
              </div>
            )}
          </div>

          {/* ── Personal details ── */}
          <div className="border border-line rounded-[10px] p-4 sm:p-5">
            <h2 className="font-semibold text-ink text-sm mb-3">Your details</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm text-ink-2 mb-1.5">Full Name * <span className="text-ink-3">(as on Ghana Card)</span></label>
                <input required className={field} value={form.full_name} onChange={e => set('full_name', e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Phone Number *</label>
                <input required type="tel" className={field} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="0244XXXXXX" />
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Ghana Card Number *</label>
                <input required className={field} value={form.ghana_card_number} onChange={e => set('ghana_card_number', e.target.value)} placeholder="GHA-XXXXXXXXX-X" />
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Email</label>
                <input type="email" className={field} value={form.email} onChange={e => set('email', e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Date of Birth</label>
                <input type="date" className={field} value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Occupation</label>
                <input className={field} value={form.occupation} onChange={e => set('occupation', e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Residential Address</label>
                <input className={field} value={form.residential_address} onChange={e => set('residential_address', e.target.value)} placeholder="Optional" />
              </div>
            </div>
          </div>

          {/* ── MoMo ── */}
          <div className="border border-line rounded-[10px] p-4 sm:p-5">
            <h2 className="font-semibold text-ink text-sm mb-1">Mobile Money</h2>
            <p className="text-xs text-ink-3 mb-3">Where your payout will be sent.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Provider</label>
                <select className={field} value={form.mobile_money_provider} onChange={e => set('mobile_money_provider', e.target.value)}>
                  <option value="MTN">MTN Mobile Money</option>
                  <option value="Vodafone">Vodafone Cash</option>
                  <option value="AirtelTigo">AirtelTigo Money</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">MoMo Number</label>
                <input type="tel" className={field} value={form.mobile_money_number} onChange={e => set('mobile_money_number', e.target.value)} placeholder="0244XXXXXX" />
              </div>
            </div>
          </div>

          <button type="submit" disabled={sending || loading}
            className="w-full py-4 bg-ink text-white font-bold rounded-[12px] hover:brightness-105 transition-all active:scale-[.98] disabled:opacity-50">
            {sending ? 'Submitting…'
              : picked.size > 1 ? `Apply to Join ${picked.size} Groups`
              : 'Apply to Join'}
          </button>
          <p className="text-[11px] text-ink-3 text-center -mt-2">
            By applying you agree to the group's contribution schedule. You'll receive your sign-in details by SMS once approved.
          </p>
        </form>
      </div>
    </div>
  )
}
