'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { SusuGroup } from '@/types'
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
      `Susu — your account\n\nSign in: ${window.location.origin}/m/login\nPhone: ${created.phone}\nPasscode: ${created.passcode}\nMember ID: ${created.member_id}\n\nContributions close 6:00 PM daily.`
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const selectedGroup = groups.find(g => g.id === form.group_id)

  // Success screen
  if (created) {
    return (
      <div className="p-4 sm:p-6 max-w-lg mx-auto pb-12 animate-fade-in">
        <div className="border border-line rounded-[10px] p-8 text-center space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-ink">Member Created!</h1>
            <p className="text-ink-2 text-sm mt-1">Share these credentials with {created.full_name}</p>
          </div>

          <div className="p-5 bg-tint rounded-[10px] space-y-3 text-left">
            <div className="flex justify-between items-center">
              <span className="text-ink-2 text-sm">Member ID</span>
              <span className="text-ink font-bold font-mono">{created.member_id}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-ink-2 text-sm">Phone (login)</span>
              <span className="text-ink font-mono text-sm">{created.phone}</span>
            </div>
            <div className="flex justify-between items-center border-t border-line pt-3">
              <span className="text-ink-2 text-sm">Passcode</span>
              <span className="text-ink font-bold font-mono text-3xl tracking-widest">{created.passcode}</span>
            </div>
            {created.payout_position && (
              <div className="flex justify-between items-center border-t border-line pt-3">
                <span className="text-ink-2 text-sm">Payout Position</span>
                <span className="text-ink font-bold">#{created.payout_position}</span>
              </div>
            )}
          </div>

          <div className="p-4 bg-bg border border-line rounded-lg text-left">
            <p className="text-[12px] font-medium text-ink-2 mb-1.5">Their portal link</p>
            <p className="text-[12.5px] font-mono break-all">{typeof window !== 'undefined' ? `${window.location.origin}/m/login` : '/m/login'}</p>
            <p className="text-[11.5px] text-ink-3 mt-2">Send this link with the credentials above. Members sign in here, not on the console.</p>
          </div>

          <button onClick={copyCreds}
            className="w-full flex items-center justify-center gap-2 py-3 bg-tint hover:bg-tint text-ink font-medium rounded-[10px] transition-colors">
            {copied ? <>Copied!</> : <>Copy Credentials</>}
          </button>

          <div className="flex gap-3">
            <button onClick={() => { setCreated(null); setForm({ ...form, full_name: '', phone: '', email: '', ghana_card_number: '', mobile_money_number: '' }); setFrontFile(null); setBackFile(null) }}
              className="flex-1 py-3 bg-blue text-ink font-bold rounded-[10px] hover:brightness-105 transition-colors">
              Add Another
            </button>
            <button onClick={() => router.push('/admin/members')}
              className="flex-1 py-3 bg-tint text-ink font-medium rounded-[10px] hover:bg-tint transition-colors">
              View Members
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <Link href="/admin/members" className="flex items-center gap-2 text-ink-2 hover:text-ink text-sm mb-6 transition-colors">
        Back to Members
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-[10px] bg-blue/20 flex items-center justify-center">
          </div>
        <h1 className="text-2xl font-extrabold text-ink">Add New Member</h1>
      </div>
      <p className="text-ink-2 text-sm mb-8">Register a member directly. Their login credentials will be generated automatically.</p>

      {error && <div className="p-3 bg-tint border border-red/40 rounded-[10px] text-red text-sm mb-5">{error}</div>}

      <form onSubmit={handleSubmit} className="border border-line rounded-[10px] p-6 space-y-6">

        {/* Personal */}
        <div>
          <h2 className="font-semibold text-ink mb-3 text-sm">Personal Details</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Full Name *</label>
              <input required className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue"
                value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="As on Ghana Card" />
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Phone Number * <span className="text-ink-3">(used to login)</span></label>
              <input required type="tel" className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue"
                value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="0244XXXXXX" />
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Ghana Card Number *</label>
              <input required className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue"
                value={form.ghana_card_number} onChange={e => set('ghana_card_number', e.target.value)} placeholder="GHA-XXXXXXXXX-X" />
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Date of Birth</label>
              <input type="date" className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue"
                value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Email</label>
              <input type="email" className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue"
                value={form.email} onChange={e => set('email', e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Occupation</label>
              <input className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue"
                value={form.occupation} onChange={e => set('occupation', e.target.value)} placeholder="e.g. Trader" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-ink-2 mb-1.5">Residential Address</label>
              <input className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue"
                value={form.residential_address} onChange={e => set('residential_address', e.target.value)} placeholder="Area, City" />
            </div>
          </div>
        </div>

        {/* Ghana Card */}
        <div className="border-t border-line pt-5">
          <h2 className="font-semibold text-ink mb-3 text-sm">Ghana Card Upload <span className="text-ink-2 font-normal">(optional)</span></h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { label: 'Front', file: frontFile, setter: setFrontFile },
              { label: 'Back',  file: backFile,  setter: setBackFile },
            ].map(({ label, file, setter }) => (
              <label key={label} className="flex flex-col items-center justify-center h-24 border-2 border-dashed border-line rounded-[10px] cursor-pointer hover:border-brand-gold transition-colors bg-tint">
                {file ? (
                  <div className="flex items-center gap-2 px-3">
                    <span className="text-xs text-ink truncate max-w-[120px]">{file.name}</span>
                    <button type="button" onClick={e => { e.preventDefault(); setter(null) }} className="text-ink-2 hover:text-red"></button>
                  </div>
                ) : (
                  <><span className="text-xs text-ink-2">{label} side</span></>
                )}
                <input type="file" className="hidden" accept="image/*" onChange={e => setter(e.target.files?.[0] ?? null)} />
              </label>
            ))}
          </div>
        </div>

        {/* Payout details */}
        <div className="border-t border-line pt-5">
          <h2 className="font-semibold text-ink mb-3 text-sm">Payout Details</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">MoMo Provider</label>
              <select className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue"
                value={form.mobile_money_provider} onChange={e => set('mobile_money_provider', e.target.value)}>
                <option value="MTN">MTN Mobile Money</option>
                <option value="Vodafone">Vodafone Cash</option>
                <option value="AirtelTigo">AirtelTigo Money</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">MoMo Number</label>
              <input type="tel" className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue"
                value={form.mobile_money_number} onChange={e => set('mobile_money_number', e.target.value)} placeholder="0244XXXXXX" />
            </div>
          </div>
        </div>

        {/* Group assignment */}
        <div className="border-t border-line pt-5">
          <h2 className="font-semibold text-ink mb-3 text-sm">Assign to Group</h2>
          <select className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue"
            value={form.group_id} onChange={e => set('group_id', e.target.value)}>
            <option value="">No group (assign later)</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>
                {g.name} — {g.current_members}/{g.max_members} members {g.current_members >= g.max_members ? '(FULL)' : ''}
              </option>
            ))}
          </select>

          {selectedGroup && (
            <div className="mt-3 p-3 bg-tint border border-line rounded-[10px] text-sm space-y-1">
              <div className="flex justify-between"><span className="text-ink-2">Contribution</span><span className="text-ink">GHS {selectedGroup.contribution_amount}/{selectedGroup.contribution_frequency}</span></div>
              <div className="flex justify-between"><span className="text-ink-2">Cashout</span><span className="text-ink font-bold">GHS {Number(selectedGroup.cashout_amount ?? 0).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-ink-2">Payout position</span><span className="text-ink">#{selectedGroup.current_members + 1}</span></div>
              <div className="flex justify-between"><span className="text-ink-2">Registration fee</span><span className="text-ink">GHS {selectedGroup.registration_fee}</span></div>
            </div>
          )}

          {selectedGroup && selectedGroup.registration_fee > 0 && (
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input type="checkbox" checked={form.registration_fee_paid === 'true'}
                onChange={e => set('registration_fee_paid', e.target.checked ? 'true' : 'false')}
                className="w-4 h-4 accent-green" />
              <span className="text-sm text-ink">Registration fee of GHS {selectedGroup.registration_fee} has been paid</span>
            </label>
          )}
        </div>

        <button type="submit" disabled={loading}
          className="w-full py-3.5 bg-blue text-ink font-bold rounded-[10px] hover:brightness-105 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? '…' : <>Create Member & Generate Passcode</>}
        </button>
      </form>
    </div>
  )
}
