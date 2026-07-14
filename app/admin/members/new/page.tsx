'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { SusuGroup } from '@/types'
import { Loader2, ArrowLeft, Upload, X, CheckCircle, Copy, Check, UserPlus } from 'lucide-react'

export default function AddMemberPage() {
  const router = useRouter()
  const [groups, setGroups]     = useState<SusuGroup[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [backFile, setBackFile]   = useState<File | null>(null)
  const [copied, setCopied]     = useState(false)
  const [created, setCreated]   = useState<{
    member_id: string; full_name: string; phone: string; passcode: string; payout_position: number | null
  } | null>(null)

  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', whatsapp_number: '',
    ghana_card_number: '', date_of_birth: '', occupation: '', residential_address: '',
    mobile_money_number: '', mobile_money_provider: 'MTN',
    bank_name: '', bank_account_number: '', bank_account_name: '',
    group_id: '', registration_fee_paid: 'true',
  })

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    const token = getAdminToken()
    callFunction<{ groups: SusuGroup[] }>('groups-create', { token: token! })
      .then(({ data }) => setGroups((data?.groups ?? []).filter(g => ['open', 'full'].includes(g.status))))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => v && fd.append(k, v))
    if (frontFile) fd.append('ghana_card_front', frontFile)
    if (backFile)  fd.append('ghana_card_back', backFile)

    const token = getAdminToken()
    const { data, error: err } = await callFunction<{
      member: { member_id: string; full_name: string; phone: string }
      passcode: string; payout_position: number | null
    }>('admin-add-member', { method: 'POST', body: fd, token: token! })

    setLoading(false)
    if (err) { setError(err); return }

    setCreated({
      member_id:       data!.member.member_id,
      full_name:       data!.member.full_name,
      phone:           data!.member.phone,
      passcode:        data!.passcode,
      payout_position: data!.payout_position,
    })
  }

  function copyCreds() {
    if (!created) return
    navigator.clipboard.writeText(
      `SusuPlatform Login\nMember ID: ${created.member_id}\nPhone: ${created.phone}\nPasscode: ${created.passcode}`
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const selectedGroup = groups.find(g => g.id === form.group_id)

  // Success screen
  if (created) {
    return (
      <div className="p-4 sm:p-6 max-w-lg mx-auto pb-12 animate-fade-in">
        <div className="bg-gray-900 border border-emerald-700 rounded-2xl p-8 text-center space-y-5">
          <CheckCircle size={56} className="text-emerald-400 mx-auto" />
          <div>
            <h1 className="text-2xl font-bold text-white">Member Created!</h1>
            <p className="text-gray-400 text-sm mt-1">Share these credentials with {created.full_name}</p>
          </div>

          <div className="p-5 bg-gray-800 rounded-2xl space-y-3 text-left">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm">Member ID</span>
              <span className="text-white font-bold font-mono">{created.member_id}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm">Phone (login)</span>
              <span className="text-white font-mono text-sm">{created.phone}</span>
            </div>
            <div className="flex justify-between items-center border-t border-gray-700 pt-3">
              <span className="text-gray-500 text-sm">Passcode</span>
              <span className="text-brand-gold font-bold font-mono text-3xl tracking-widest">{created.passcode}</span>
            </div>
            {created.payout_position && (
              <div className="flex justify-between items-center border-t border-gray-700 pt-3">
                <span className="text-gray-500 text-sm">Payout Position</span>
                <span className="text-white font-bold">#{created.payout_position}</span>
              </div>
            )}
          </div>

          <button onClick={copyCreds}
            className="w-full flex items-center justify-center gap-2 py-3 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-xl transition-colors">
            {copied ? <><Check size={16} className="text-emerald-400" /> Copied!</> : <><Copy size={16} /> Copy Credentials</>}
          </button>

          <div className="flex gap-3">
            <button onClick={() => { setCreated(null); setForm({ ...form, full_name: '', phone: '', email: '', ghana_card_number: '', mobile_money_number: '' }); setFrontFile(null); setBackFile(null) }}
              className="flex-1 py-3 bg-brand-gold text-brand-green font-bold rounded-xl hover:bg-amber-400 transition-colors">
              Add Another
            </button>
            <button onClick={() => router.push('/admin/members')}
              className="flex-1 py-3 bg-gray-800 text-gray-300 font-medium rounded-xl hover:bg-gray-700 transition-colors">
              View Members
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-12 animate-fade-in">
      <Link href="/admin/members" className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Members
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-brand-gold/20 flex items-center justify-center">
          <UserPlus size={20} className="text-brand-gold" />
        </div>
        <h1 className="text-2xl font-extrabold text-white">Add New Member</h1>
      </div>
      <p className="text-gray-400 text-sm mb-8">Register a member directly. Their login credentials will be generated automatically.</p>

      {error && <div className="p-3 bg-red-900/30 border border-red-500/30 rounded-xl text-red-400 text-sm mb-5">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6">

        {/* Personal */}
        <div>
          <h2 className="font-semibold text-white mb-3 text-sm">Personal Details</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Full Name *</label>
              <input required className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
                value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="As on Ghana Card" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Phone Number * <span className="text-gray-600">(used to login)</span></label>
              <input required type="tel" className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
                value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="0244XXXXXX" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Ghana Card Number *</label>
              <input required className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
                value={form.ghana_card_number} onChange={e => set('ghana_card_number', e.target.value)} placeholder="GHA-XXXXXXXXX-X" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Date of Birth</label>
              <input type="date" className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
                value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Email</label>
              <input type="email" className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
                value={form.email} onChange={e => set('email', e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Occupation</label>
              <input className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
                value={form.occupation} onChange={e => set('occupation', e.target.value)} placeholder="e.g. Trader" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-400 mb-1.5">Residential Address</label>
              <input className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
                value={form.residential_address} onChange={e => set('residential_address', e.target.value)} placeholder="Area, City" />
            </div>
          </div>
        </div>

        {/* Ghana Card */}
        <div className="border-t border-gray-800 pt-5">
          <h2 className="font-semibold text-white mb-3 text-sm">Ghana Card Upload <span className="text-gray-500 font-normal">(optional)</span></h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { label: 'Front', file: frontFile, setter: setFrontFile },
              { label: 'Back',  file: backFile,  setter: setBackFile },
            ].map(({ label, file, setter }) => (
              <label key={label} className="flex flex-col items-center justify-center h-24 border-2 border-dashed border-gray-700 rounded-xl cursor-pointer hover:border-brand-gold transition-colors bg-gray-800/50">
                {file ? (
                  <div className="flex items-center gap-2 px-3">
                    <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                    <span className="text-xs text-gray-300 truncate max-w-[120px]">{file.name}</span>
                    <button type="button" onClick={e => { e.preventDefault(); setter(null) }} className="text-gray-500 hover:text-red-400"><X size={12} /></button>
                  </div>
                ) : (
                  <><Upload size={18} className="text-gray-600 mb-1" /><span className="text-xs text-gray-500">{label} side</span></>
                )}
                <input type="file" className="hidden" accept="image/*" onChange={e => setter(e.target.files?.[0] ?? null)} />
              </label>
            ))}
          </div>
        </div>

        {/* Payout details */}
        <div className="border-t border-gray-800 pt-5">
          <h2 className="font-semibold text-white mb-3 text-sm">Payout Details</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">MoMo Provider</label>
              <select className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
                value={form.mobile_money_provider} onChange={e => set('mobile_money_provider', e.target.value)}>
                <option value="MTN">MTN Mobile Money</option>
                <option value="Vodafone">Vodafone Cash</option>
                <option value="AirtelTigo">AirtelTigo Money</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">MoMo Number</label>
              <input type="tel" className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
                value={form.mobile_money_number} onChange={e => set('mobile_money_number', e.target.value)} placeholder="0244XXXXXX" />
            </div>
          </div>
        </div>

        {/* Group assignment */}
        <div className="border-t border-gray-800 pt-5">
          <h2 className="font-semibold text-white mb-3 text-sm">Assign to Group</h2>
          <select className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
            value={form.group_id} onChange={e => set('group_id', e.target.value)}>
            <option value="">No group (assign later)</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>
                {g.name} — {g.current_members}/{g.max_members} members {g.current_members >= g.max_members ? '(FULL)' : ''}
              </option>
            ))}
          </select>

          {selectedGroup && (
            <div className="mt-3 p-3 bg-brand-green/10 border border-brand-green/30 rounded-xl text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-400">Contribution</span><span className="text-white">GHS {selectedGroup.contribution_amount}/{selectedGroup.contribution_frequency}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Cashout</span><span className="text-brand-gold font-bold">GHS {Number(selectedGroup.cashout_amount ?? 0).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Payout position</span><span className="text-white">#{selectedGroup.current_members + 1}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Registration fee</span><span className="text-white">GHS {selectedGroup.registration_fee}</span></div>
            </div>
          )}

          {selectedGroup && selectedGroup.registration_fee > 0 && (
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input type="checkbox" checked={form.registration_fee_paid === 'true'}
                onChange={e => set('registration_fee_paid', e.target.checked ? 'true' : 'false')}
                className="w-4 h-4 accent-brand-gold" />
              <span className="text-sm text-gray-300">Registration fee of GHS {selectedGroup.registration_fee} has been paid</span>
            </label>
          )}
        </div>

        <button type="submit" disabled={loading}
          className="w-full py-3.5 bg-brand-gold text-brand-green font-bold rounded-xl hover:bg-amber-400 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 size={18} className="animate-spin" /> : <><UserPlus size={18} /> Create Member & Generate Passcode</>}
        </button>
      </form>
    </div>
  )
}
