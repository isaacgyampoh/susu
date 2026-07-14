'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import PublicNav from '@/components/layout/public-nav'
import { callFunction } from '@/lib/supabase'
import type { SusuGroup } from '@/types'
import { CheckCircle, Loader2, Upload, AlertTriangle, X } from 'lucide-react'

const TERMS = [
  'I confirm I am 18 years of age or older.',
  'I have a steady, verifiable source of income.',
  'I understand the registration fee of GHS 110 is NON-REFUNDABLE once paid.',
  'I understand I must make daily contributions before 6:00 PM every day.',
  'I understand that late payments are automatically flagged and a penalty is applied.',
  'I understand that defaulting on payments will cause me to forfeit my slot with NO consideration.',
  'I understand that the system automatically assigns my group slot when the group fills up.',
  'I commit to completing the full savings cycle without withdrawal.',
  'I agree to all Rules & Regulations as stated on the SusuPlatform website.',
]

export default function JoinPage() {
  const { groupId }  = useParams<{ groupId: string }>()
  const searchParams = useSearchParams()
  const router       = useRouter()

  const [group, setGroup]       = useState<SusuGroup | null>(null)
  const [step, setStep]         = useState<'form' | 'done'>('form')
  const [loading, setLoading]   = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState('')
  const [agreed, setAgreed]     = useState<boolean[]>(new Array(TERMS.length).fill(false))
  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [backFile, setBackFile]   = useState<File | null>(null)

  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', date_of_birth: '',
    occupation: '', residential_address: '', ghana_card_number: '',
    mobile_money_number: '', mobile_money_provider: 'MTN',
    bank_name: '', bank_account_number: '', bank_account_name: '',
  })

  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref?.startsWith('KYC-')) { setStep('done'); setLoading(false); return }

    callFunction<{ groups: SusuGroup[] }>('groups-public').then(({ data }) => {
      const g = data?.groups?.find((g) => g.id === groupId) ?? null
      setGroup(g)
      setLoading(false)
    })
  }, [groupId, searchParams])

  const allAgreed = agreed.every(Boolean)

  function setField(k: string, v: string) { setForm(p => ({ ...p, [k]: v })) }
  function toggleTerm(i: number) {
    setAgreed(prev => { const a = [...prev]; a[i] = !a[i]; return a })
  }
  function agreeAll() { setAgreed(new Array(TERMS.length).fill(true)) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!allAgreed) { setError('You must tick every box in the Terms & Conditions to continue.'); return }
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

    if (data?.paystack?.authorization_url) {
      window.location.href = data.paystack.authorization_url
    } else {
      setStep('done')
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50"><PublicNav />
      <div className="flex justify-center py-32"><Loader2 className="animate-spin text-brand-green" size={36} /></div>
    </div>
  )

  if (!group) return (
    <div className="min-h-screen bg-gray-50"><PublicNav />
      <div className="text-center py-20 text-gray-500">Group not found.</div>
    </div>
  )

  const cashout = group.cashout_amount ?? (group.contribution_amount * group.max_members * group.cycle_days)
  const totalWithFee = cashout + group.registration_fee

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
                GHS {group.contribution_amount}/{group.contribution_frequency} · {group.cycle_days}-day cycles · {group.max_members} members
              </p>
              <p className="text-green-300 text-xs mt-1">Registration fee: GHS {group.registration_fee} (added to your cashout)</p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-brand-gold font-bold text-2xl">GHS {totalWithFee.toLocaleString()}</div>
              <div className="text-green-300 text-xs">Your total cashout</div>
            </div>
          </div>
        </div>

        {step === 'done' ? (
          <div className="card p-10 text-center animate-slide-up">
            <CheckCircle size={56} className="text-emerald-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-brand-green">Application Submitted!</h2>
            <p className="text-gray-500 mt-3 max-w-sm mx-auto">
              Your KYC and registration fee have been received. The admin will review and notify you via SMS within 24 hours with your Member ID and login passcode.
            </p>
            <button onClick={() => router.push('/')} className="btn-secondary mt-8">Back to Home</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 sm:p-8 space-y-6 animate-slide-up">
            <h2 className="text-xl font-bold text-brand-green">KYC Application</h2>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            {/* Personal details */}
            <div>
              <h3 className="font-semibold text-gray-700 mb-3">Personal Details</h3>
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
                  <input className="input" type="email" value={form.email} onChange={e => setField('email', e.target.value)} />
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
                <div className="sm:col-span-2">
                  <label className="label">Residential Address *</label>
                  <input className="input" required value={form.residential_address} onChange={e => setField('residential_address', e.target.value)} placeholder="Area, City" />
                </div>
              </div>
            </div>

            {/* Ghana Card Upload */}
            <div>
              <h3 className="font-semibold text-gray-700 mb-3">Ghana Card Upload *</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { label: 'Front Side', file: frontFile, setter: setFrontFile },
                  { label: 'Back Side',  file: backFile,  setter: setBackFile  },
                ].map(({ label, file, setter }) => (
                  <div key={label}>
                    <label className="label">{label}</label>
                    <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-brand-green transition-colors bg-gray-50">
                      {file ? (
                        <div className="flex items-center gap-2 px-3">
                          <CheckCircle size={16} className="text-emerald-500 shrink-0" />
                          <span className="text-sm text-gray-700 truncate">{file.name}</span>
                          <button type="button" onClick={e => { e.preventDefault(); setter(null) }} className="text-gray-400 hover:text-red-500">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <><Upload size={20} className="text-gray-400 mb-1" /><span className="text-xs text-gray-400">Tap to upload {label}</span></>
                      )}
                      <input type="file" className="hidden" accept="image/*" onChange={e => setter(e.target.files?.[0] ?? null)} />
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Payout details */}
            <div>
              <h3 className="font-semibold text-gray-700 mb-3">Payout / Mobile Money Details</h3>
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

            {/* T&C — every item must be ticked */}
            <div className="border border-amber-200 rounded-2xl p-5 bg-amber-50">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-amber-900">Terms & Conditions *</h3>
                <button type="button" onClick={agreeAll} className="text-xs text-brand-green font-semibold underline">Tick all</button>
              </div>
              <p className="text-xs text-amber-700 mb-4">You must tick every box individually. By doing so you confirm you have read and agreed to each point.</p>
              <div className="space-y-2">
                {TERMS.map((term, i) => (
                  <label key={i} className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={agreed[i]} onChange={() => toggleTerm(i)}
                      className="mt-0.5 w-4 h-4 accent-brand-green shrink-0" />
                    <span className="text-sm text-amber-800">{term}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-500 border border-gray-100">
              After submitting, you will be taken to pay your registration fee of <strong className="text-gray-800">GHS {group.registration_fee}</strong> via Paystack (mobile money or card). This fee will be added to your cashout on your payout day.
            </div>

            <button type="submit" disabled={submitting || !allAgreed} className="btn-secondary w-full text-base py-3.5">
              {submitting
                ? <Loader2 className="animate-spin" size={18} />
                : !allAgreed
                  ? 'Please tick all Terms & Conditions above'
                  : 'Submit Application & Pay Registration Fee'
              }
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
