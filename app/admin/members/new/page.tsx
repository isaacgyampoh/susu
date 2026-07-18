'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { memberSignInUrl, credentialsMessage, whatsappLink } from '@/lib/member-link'
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
    assignments: { group_id: string; group_name: string; payout_position: number }[]
  } | null>(null)

  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', whatsapp_number: '',
    ghana_card_number: '', date_of_birth: '', occupation: '', residential_address: '',
    mobile_money_number: '', mobile_money_provider: 'MTN',
    bank_name: '', bank_account_number: '', bank_account_name: '',
    registration_fee_paid: 'true',
  })
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [payoutDates, setPayoutDates] = useState<Record<string, string>>({})
  const [slotCounts, setSlotCounts]   = useState<Record<string, number>>({})

  const toggleGroup = (id: string) =>
    setGroupIds(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id])

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
    if (groupIds.length) {
      fd.append('group_ids', groupIds.join(','))
      fd.append('group_settings', JSON.stringify(
        groupIds.map(id => ({ group_id: id, payout_date: payoutDates[id] || undefined, slots: slotCounts[id] || 1 }))
      ))
    }
    if (frontFile) fd.append('ghana_card_front', frontFile)
    if (backFile)  fd.append('ghana_card_back', backFile)

    const token = getAdminToken()
    const { data, error: err } = await callFunction<{
      member: { member_id: string; full_name: string; phone: string }
      passcode: string; payout_position: number | null
      assignments?: { group_id: string; group_name: string; payout_position: number }[]
    }>('admin-add-member', { method: 'POST', body: fd, token: token! })

    setLoading(false)
    if (err) { setError(err); return }

    setCreated({
      member_id:       data!.member.member_id,
      full_name:       data!.member.full_name,
      phone:           data!.member.phone,
      passcode:        data!.passcode,
      payout_position: data!.payout_position,
      assignments:     data!.assignments ?? [],
    })
  }

  const selectedGroups = groups.filter(g => groupIds.includes(g.id))
  const totalRegFee    = selectedGroups.reduce((s, g) => s + Number(g.registration_fee || 0) * (slotCounts[g.id] || 1), 0)

  // Success screen
  const portalUrl = memberSignInUrl()

  const shareText = created
    ? credentialsMessage({
        full_name: created.full_name,
        member_id: created.member_id,
        phone:     created.phone,
        passcode:  created.passcode,
      })
    : ''

  function copyAll() {
    navigator.clipboard.writeText(shareText)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  function shareWhatsApp() {
    if (!created) return
    window.open(whatsappLink(created.phone, shareText), '_blank')
  }

  // Success: the admin's job here is to send the member their link.
  if (created) {
    return (
      <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 max-w-[560px] animate-fade-in">
        <p className="t-label">Member created</p>
        <h1 className="t-title mt-1.5">{created.full_name}</h1>
        <p className="t-meta mt-1">Send them the link and credentials below. They cannot sign in until you do.</p>

        <div className="card p-5 mt-6">
          <p className="t-h2 mb-4">Their sign-in details</p>

          <div className="scroll-x">

            <table className="w-full min-w-[560px] lg:min-w-0">
            <tbody className="divide-y divide-line">
              <tr>
                <td className="py-2.5 text-[12.5px] text-ink-2">Portal link</td>
                <td className="py-2.5 text-right text-[12.5px] font-medium break-all">{portalUrl}</td>
              </tr>
              <tr>
                <td className="py-2.5 text-[12.5px] text-ink-2">Phone</td>
                <td className="py-2.5 text-right text-[13px] font-medium tnum">{created.phone}</td>
              </tr>
              <tr>
                <td className="py-2.5 text-[12.5px] text-ink-2">Passcode</td>
                <td className="py-2.5 text-right text-[20px] font-semibold tnum tracking-[.12em]">{created.passcode}</td>
              </tr>
              <tr>
                <td className="py-2.5 text-[12.5px] text-ink-2">Member ID</td>
                <td className="py-2.5 text-right text-[13px] font-medium">{created.member_id}</td>
              </tr>
              {created.assignments.map(a => (
                <tr key={a.group_id}>
                  <td className="py-2.5 text-[12.5px] text-ink-2">{a.group_name}</td>
                  <td className="py-2.5 text-right text-[13px] font-medium">Payout position #{a.payout_position}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>

          <p className="text-[11.5px] text-ink-3 mt-4">
            This passcode is shown once. If it is lost, reset it from the member&apos;s page.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={shareWhatsApp} className="btn-dark">Send on WhatsApp</button>
          <button onClick={copyAll} className="btn-line">{copied ? 'Copied' : 'Copy message'}</button>
        </div>

        <div className="flex flex-wrap gap-2 mt-8 pt-6 border-t border-line">
          <button onClick={() => { setCreated(null); setFrontFile(null); setBackFile(null)
            setForm({ ...form, full_name: '', phone: '', email: '', ghana_card_number: '', mobile_money_number: '' }) }}
            className="btn-line btn-sm">Add another member</button>
          <button onClick={() => router.push('/admin/members')} className="btn-ghost btn-sm">Back to members</button>
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
        <div className="w-10 h-10 rounded-[10px] bg-ink/20 flex items-center justify-center">
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
              <input required className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
                value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="As on Ghana Card" />
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Phone Number * <span className="text-ink-3">(used to login)</span></label>
              <input required type="tel" className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
                value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="0244XXXXXX" />
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Ghana Card Number *</label>
              <input required className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
                value={form.ghana_card_number} onChange={e => set('ghana_card_number', e.target.value)} placeholder="GHA-XXXXXXXXX-X" />
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Date of Birth</label>
              <input type="date" className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
                value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Email</label>
              <input type="email" className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
                value={form.email} onChange={e => set('email', e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Occupation</label>
              <input className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
                value={form.occupation} onChange={e => set('occupation', e.target.value)} placeholder="e.g. Trader" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-ink-2 mb-1.5">Residential Address</label>
              <input className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
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
              <select className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
                value={form.mobile_money_provider} onChange={e => set('mobile_money_provider', e.target.value)}>
                <option value="MTN">MTN Mobile Money</option>
                <option value="Vodafone">Vodafone Cash</option>
                <option value="AirtelTigo">AirtelTigo Money</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">MoMo Number</label>
              <input type="tel" className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
                value={form.mobile_money_number} onChange={e => set('mobile_money_number', e.target.value)} placeholder="0244XXXXXX" />
            </div>
          </div>
        </div>

        {/* Group assignment — a member can join several groups at once */}
        <div className="border-t border-line pt-5">
          <h2 className="font-semibold text-ink mb-1 text-sm">Assign to Groups</h2>
          <p className="text-xs text-ink-3 mb-3">Tick every group this member should join. Leave all unticked to assign later.</p>

          <div className="space-y-2">
            {groups.map(g => {
              const full    = g.current_members >= g.max_members
              const checked = groupIds.includes(g.id)
              return (
                <label key={g.id}
                  className={`flex items-start gap-3 p-3 border rounded-[10px] transition-colors ${
                    full && !checked ? 'opacity-50 cursor-not-allowed border-line'
                    : checked ? 'border-ink bg-tint cursor-pointer' : 'border-line hover:border-ink/40 cursor-pointer'}`}>
                  <input type="checkbox" className="w-4 h-4 mt-0.5 accent-green"
                    checked={checked} disabled={full && !checked}
                    onChange={() => toggleGroup(g.id)} />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-ink">
                      {g.name} {full ? <span className="text-red font-normal">(FULL)</span> : ''}
                    </span>
                    <span className="block text-xs text-ink-2 mt-0.5">
                      GHS {g.contribution_amount}/{g.contribution_frequency} · Cashout GHS {Number(g.cashout_amount ?? 0).toLocaleString()} ·
                      {' '}{g.current_members}/{g.max_members} members · Reg. fee GHS {g.registration_fee}
                    </span>
                    {checked && (
                      <span className="block mt-2" onClick={e => e.preventDefault()}>
                        <span className="flex items-center gap-2 mb-1.5" onClick={e => e.stopPropagation()}>
                          <span className="text-xs text-ink-2">Slots:</span>
                          {[1,2,3,4,5].map(n => (
                            <button key={n} type="button"
                              onClick={() => setSlotCounts(prev => ({ ...prev, [g.id]: n }))}
                              disabled={g.current_members + n > g.max_members}
                              className={`w-7 h-7 rounded-[8px] text-xs font-bold transition-all disabled:opacity-30 ${
                                (slotCounts[g.id] || 1) === n ? 'bg-ink text-white' : 'bg-white border border-line text-ink-2 hover:text-ink'}`}>
                              {n}
                            </button>
                          ))}
                          {(slotCounts[g.id] || 1) > 1 && (
                            <span className="text-[11px] text-ink-3">= pays GHS {(Number(g.contribution_amount) * (slotCounts[g.id] || 1)).toLocaleString()}/day, {slotCounts[g.id]} payouts</span>
                          )}
                        </span>
                        <span className="block text-xs text-ink mb-1.5">Payout position: next free slot (~#{g.current_members + 1}){(slotCounts[g.id] || 1) > 1 ? ' — extra slots take the following free positions' : ''}</span>
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-ink-2">Payout date:</span>
                          <input type="date" value={payoutDates[g.id] ?? ''}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setPayoutDates(prev => ({ ...prev, [g.id]: e.target.value }))}
                            className="px-3 py-1.5 bg-white border border-line text-ink rounded-[8px] text-xs focus:outline-none focus:border-ink" />
                          <span className="text-[11px] text-ink-3">when they'll receive GHS {Number(g.cashout_amount ?? 0).toLocaleString()}</span>
                        </span>
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
            {groups.length === 0 && <p className="text-sm text-ink-3">No open groups available.</p>}
          </div>

          {totalRegFee > 0 && (
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input type="checkbox" checked={form.registration_fee_paid === 'true'}
                onChange={e => set('registration_fee_paid', e.target.checked ? 'true' : 'false')}
                className="w-4 h-4 accent-green" />
              <span className="text-sm text-ink">
                Registration fee{selectedGroups.length > 1 ? 's' : ''} totalling GHS {totalRegFee.toLocaleString()} ha{selectedGroups.length > 1 ? 've' : 's'} been paid
              </span>
            </label>
          )}
        </div>

        <button type="submit" disabled={loading}
          className="w-full py-3.5 bg-ink text-white font-bold rounded-[10px] hover:brightness-105 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? '…' : <>Create Member & Generate Passcode</>}
        </button>
      </form>
    </div>
  )
}
