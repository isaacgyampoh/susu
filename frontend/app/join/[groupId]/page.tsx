'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import PublicNav from '@/components/layout/public-nav'
import { callFunction } from '@/lib/supabase'
import type { SusuGroup } from '@/types'
import { CheckCircle, Loader2, Upload, AlertCircle } from 'lucide-react'

type Step = 'info' | 'kyc' | 'payment' | 'done'

export default function JoinPage() {
  const { groupId }    = useParams<{ groupId: string }>()
  const searchParams   = useSearchParams()
  const router         = useRouter()

  const [group, setGroup]     = useState<SusuGroup | null>(null)
  const [step, setStep]       = useState<Step>('info')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState('')
  const [kycId, setKycId]     = useState('')

  // Form state
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', date_of_birth: '', occupation: '',
    residential_address: '', ghana_card_number: '', mobile_money_number: '',
    mobile_money_provider: 'MTN', bank_name: '', bank_account_number: '', bank_account_name: '',
  })
  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [backFile, setBackFile]   = useState<File | null>(null)
  const [agreed, setAgreed]       = useState(false)

  useEffect(() => {
    // Check if returning from Paystack
    const ref = searchParams.get('ref')
    if (ref && ref.startsWith('KYC-')) {
      verifyPaystackRef(ref)
      return
    }

    // Load group info
    callFunction<{ groups: SusuGroup[] }>('groups-public').then(({ data }) => {
      const g = data?.groups?.find((g) => g.id === groupId) ?? null
      setGroup(g)
      setLoading(false)
    })
  }, [groupId, searchParams])

  async function verifyPaystackRef(ref: string) {
    setStep('payment')
    setLoading(false)
    // Payment will be confirmed by webhook automatically
    setTimeout(() => setStep('done'), 1500)
  }

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!agreed) { setError('You must agree to the rules to continue.'); return }
    if (!frontFile || !backFile) { setError('Please upload both sides of your Ghana Card.'); return }

    setSubmitting(true)
    setError('')

    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => v && fd.append(k, v))
    fd.append('selected_group_id', groupId)
    fd.append('ghana_card_front', frontFile)
    fd.append('ghana_card_back', backFile)

    const { data, error: err } = await callFunction<{
      kyc_id: string; fee: number; paystack?: { authorization_url: string }
    }>('kyc-submit', { method: 'POST', body: fd })

    setSubmitting(false)

    if (err) { setError(err); return }

    setKycId(data!.kyc_id)

    if (data?.paystack?.authorization_url) {
      window.location.href = data.paystack.authorization_url
    } else {
      setStep('done')
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="flex justify-center py-32"><Loader2 className="animate-spin text-brand-green" size={36} /></div>
    </div>
  )

  if (!group) return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="text-center py-20 text-gray-500">Group not found.</div>
    </div>
  )

  const payoutAmount = group.contribution_amount * group.max_members * group.cycle_days

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-2xl mx-auto px-4 py-10">

        {/* Group summary */}
        <div className="card p-5 mb-6 bg-brand-green text-white">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="font-bold text-xl">{group.name}</h1>
              <p className="text-green-200 text-sm mt-1">
                GHS {group.contribution_amount}/day · {group.cycle_days}-day cycles · {group.max_members} members
              </p>
            </div>
            <div className="text-right">
              <div className="text-brand-gold font-bold text-xl">GHS {payoutAmount.toLocaleString()}</div>
              <div className="text-green-300 text-xs">Your payout</div>
            </div>
          </div>
        </div>

        {step === 'done' ? (
          <div className="card p-10 text-center animate-slide-up">
            <CheckCircle size={56} className="text-emerald-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-brand-green">Application Submitted!</h2>
            <p className="text-gray-500 mt-3 max-w-sm mx-auto">
              Your KYC application and registration fee have been received. Our team will review and notify you via SMS within 24 hours.
            </p>
            <button onClick={() => router.push('/')} className="btn-secondary mt-8">Back to Home</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 sm:p-8 space-y-5 animate-slide-up">
            <h2 className="text-xl font-bold text-brand-green">KYC Application</h2>
            <p className="text-sm text-gray-500">Fill in your details accurately. This information will be verified.</p>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Full Name *</label>
                <input className="input" required value={form.full_name} onChange={e => setField('full_name', e.target.value)} placeholder="As on Ghana Card" />
              </div>
              <div>
                <label className="label">Phone Number *</label>
                <input className="input" required type="tel" value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="0244XXXXXX" />
              </div>
              <div>
                <label className="label">Email (optional)</label>
                <input className="input" type="email" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="you@example.com" />
              </div>
              <div>
                <label className="label">Date of Birth *</label>
                <input className="input" required type="date" value={form.date_of_birth} onChange={e => setField('date_of_birth', e.target.value)} />
              </div>
              <div>
                <label className="label">Ghana Card Number *</label>
                <input className="input" required value={form.ghana_card_number} onChange={e => setField('ghana_card_number', e.target.value)} placeholder="GHA-XXXXXXXXX-X" />
              </div>
              <div>
                <label className="label">Occupation *</label>
                <input className="input" required value={form.occupation} onChange={e => setField('occupation', e.target.value)} placeholder="e.g. Teacher, Trader" />
              </div>
            </div>

            <div>
              <label className="label">Residential Address *</label>
              <input className="input" required value={form.residential_address} onChange={e => setField('residential_address', e.target.value)} placeholder="Area, City" />
            </div>

            {/* Ghana Card Upload */}
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { label: 'Ghana Card — Front *', key: 'front', setter: setFrontFile, file: frontFile },
                { label: 'Ghana Card — Back *',  key: 'back',  setter: setBackFile,  file: backFile  },
              ].map(({ label, setter, file }) => (
                <div key={label}>
                  <label className="label">{label}</label>
                  <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-brand-green transition-colors bg-gray-50">
                    {file ? (
                      <span className="text-sm text-brand-green font-medium px-3 text-center">{file.name}</span>
                    ) : (
                      <>
                        <Upload size={20} className="text-gray-400 mb-1" />
                        <span className="text-xs text-gray-400">Click to upload</span>
                      </>
                    )}
                    <input type="file" className="hidden" accept="image/*" onChange={e => setter(e.target.files?.[0] ?? null)} />
                  </label>
                </div>
              ))}
            </div>

            {/* Mobile Money */}
            <div className="border-t pt-5">
              <h3 className="font-semibold text-gray-700 mb-3">Mobile Money (Preferred Payout)</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Provider</label>
                  <select className="input" value={form.mobile_money_provider} onChange={e => setField('mobile_money_provider', e.target.value)}>
                    <option value="MTN">MTN Mobile Money</option>
                    <option value="Vodafone">Vodafone Cash</option>
                    <option value="AirtelTigo">AirtelTigo Money</option>
                  </select>
                </div>
                <div>
                  <label className="label">Mobile Money Number</label>
                  <input className="input" type="tel" value={form.mobile_money_number} onChange={e => setField('mobile_money_number', e.target.value)} placeholder="0244XXXXXX" />
                </div>
              </div>
            </div>

            {/* Consent */}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-1 w-4 h-4 accent-brand-green" />
                <span className="text-sm text-amber-800">
                  I have read and agree to all Susu Platform rules. I understand that defaulting before my payout forfeits my slot and no refund will be issued.
                </span>
              </label>
            </div>

            {/* Registration fee note */}
            {group.registration_fee > 0 && (
              <p className="text-sm text-gray-500 text-center">
                After submitting, you will be redirected to pay the registration fee of <strong>GHS {group.registration_fee}</strong> via Paystack (card or mobile money).
              </p>
            )}

            <button type="submit" disabled={submitting} className="btn-secondary w-full text-base py-3.5">
              {submitting ? <Loader2 className="animate-spin" size={18} /> : 'Submit Application & Pay Registration Fee'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
