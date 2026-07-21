'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { format } from 'date-fns'
export default function MemberDetailPage() {
  const { id }            = useParams<{ id: string }>()
  const router            = useRouter()
  const [member, setMember] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [action, setAction]   = useState<'suspend' | 'activate' | null>(null)
  const [forfeitTarget, setForfeitTarget] = useState<any>(null)
  const [forfeitReason, setForfeitReason] = useState('')
  const [forfeiting, setForfeiting] = useState(false)
  const [message, setMessage] = useState('')
  const [processing, setProcessing] = useState(false)
  const [toast, setToast]     = useState('')
  const [editTarget, setEditTarget] = useState<any>(null)
  const [editForm, setEditForm] = useState({ payout_position: '', payout_date: '', payout_amount: '', payout_received: false })
  const [savingEdit, setSavingEdit] = useState(false)
  const [pairCands, setPairCands]   = useState<any[] | null>(null)
  const [pairPicked, setPairPicked] = useState<Set<string>>(new Set())
  const [pairing, setPairing]       = useState(false)
  // Record Payment (this member)
  const [payOpen, setPayOpen]     = useState(false)
  const [unpaid, setUnpaid]       = useState<any[]>([])
  const [payPlans, setPayPlans]   = useState<any[]>([])
  const [unpaidLoading, setUnpaidLoading] = useState(false)
  const [payPicked, setPayPicked] = useState<Set<string>>(new Set())
  const [amountIn, setAmountIn]   = useState('')
  const [payFilter, setPayFilter] = useState<string>('all')   // membership_id or 'all'
  const [payMethod, setPayMethod] = useState<'cash' | 'momo' | 'bank'>('momo')
  const [payNote, setPayNote]     = useState('')
  const [paySms, setPaySms]       = useState(true)
  const [paySaving, setPaySaving] = useState(false)
  // Send message
  const [msgOpen, setMsgOpen]   = useState(false)
  const [portalOpen, setPortalOpen] = useState(false)
  const [portalData, setPortalData] = useState<any>(null)
  const [portalBusy, setPortalBusy] = useState(false)

  async function openPortal() {
    setPortalOpen(true); setPortalData(null)
    const { data } = await callFunction<any>(`admin-members?id=${id}`, {
      method: 'POST', token: getAdminToken()!, body: { action: 'portal_link' } })
    setPortalData(data)
  }
  async function resetPasscode(sendSms: boolean) {
    setPortalBusy(true)
    const { data, error } = await callFunction<any>(`admin-members?id=${id}`, {
      method: 'POST', token: getAdminToken()!, body: { action: 'reset_passcode', send_sms: sendSms } })
    setPortalBusy(false)
    if (error) { alert(error); return }
    setPortalData(data)
  }
  function copyText(t: string) { navigator.clipboard?.writeText(t).catch(() => {}); showToast('Copied') }
  const [msgText, setMsgText]   = useState('')
  const [msgSending, setMsgSending] = useState(false)
  // Add to group
  const [addOpen, setAddOpen]     = useState(false)
  const [allGroups, setAllGroups] = useState<any[]>([])
  const [addPicked, setAddPicked] = useState<Set<string>>(new Set())
  const [addSlots, setAddSlots]   = useState<Record<string, number>>({})
  const [addFracs, setAddFracs]   = useState<Record<string, number>>({})
  const [addDates, setAddDates]   = useState<Record<string, string>>({})   // key `${groupId}:${slotIndex}`
  const [adding, setAdding]       = useState(false)
  // Danger zone
  const [delOpen, setDelOpen]   = useState(false)
  const [delText, setDelText]   = useState('')
  const [deleting, setDeleting] = useState(false)

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    const token = getAdminToken()
    callFunction<{ member: any }>(`admin-members?id=${id}`, { token: token! })
      .then(({ data, error }) => {
        setLoadErr(error ?? '')
        setMember(data?.member ?? null)
      })
      .finally(() => setLoading(false))
  }, [id])

  function openEdit(gm: any) {
    setEditTarget(gm)
    setPairCands(null); setPairPicked(new Set())
    const token = getAdminToken()
    callFunction<{ candidates: any[] }>(`admin-members?membership_id=${gm.id}`, { token: token! })
      .then(({ data }) => setPairCands(data?.candidates ?? []))
    setEditForm({
      payout_position: gm.payout_position ? String(gm.payout_position) : '',
      payout_date:     gm.payout_date ?? '',
      payout_amount:   gm.payout_amount != null ? String(gm.payout_amount) : '',
      payout_received: !!gm.payout_received,
    })
  }

  async function savePair() {
    if (!editTarget || pairPicked.size === 0) return
    setPairing(true)
    const token = getAdminToken()
    const { data, error } = await callFunction<{ message: string }>(
      `admin-members?membership_id=${editTarget.id}`,
      { method: 'PATCH', token: token!, body: {
        pair_with: Array.from(pairPicked),
        payout_date: editForm.payout_date || undefined,
      }})
    setPairing(false)
    if (error) { alert(error); return }
    setEditTarget(null)
    showToast(data?.message ?? 'Slots paired')
    refreshMember()
  }

  async function unpair() {
    if (!editTarget) return
    setPairing(true)
    const token = getAdminToken()
    const { error } = await callFunction<{ message: string }>(
      `admin-members?membership_id=${editTarget.id}`,
      { method: 'PATCH', token: token!, body: { unpair: true } })
    setPairing(false)
    if (error) { alert(error); return }
    setEditTarget(null)
    showToast('Slot unpaired')
    refreshMember()
  }

  async function saveEdit() {
    if (!editTarget) return
    setSavingEdit(true)
    const token = getAdminToken()
    const { error } = await callFunction<{ message: string }>(
      `admin-members?membership_id=${editTarget.id}`,
      { method: 'PATCH', token: token!, body: {
        payout_position: editForm.payout_position || undefined,
        payout_date:     editForm.payout_date,           // '' clears the date
        payout_amount:   editForm.payout_amount || undefined,
        payout_received: editForm.payout_received,
      }})
    setSavingEdit(false)
    if (error) { alert(error); return }
    setEditTarget(null)
    showToast('Payout details updated')
    // Refresh the member so the card shows the new details
    const { data } = await callFunction<{ member: any }>(`admin-members?id=${id}`, { token: token! })
    if (data?.member) setMember(data.member)
  }

  async function refreshMember() {
    const token = getAdminToken()
    const { data } = await callFunction<{ member: any }>(`admin-members?id=${id}`, { token: token! })
    if (data?.member) setMember(data.member)
  }

  async function openPay() {
    setPayOpen(true); setPayPicked(new Set()); setAmountIn(''); setPayNote(''); setPayFilter('all')
    setUnpaidLoading(true)
    const token = getAdminToken()
    // Collection mode: everything owed, across every group and slot
    const { data } = await callFunction<{ contributions: any[]; plans: any[] }>(
      `contributions-list?member_id=${id}&collection=1`, { token: token! })
    setUnpaid(data?.contributions ?? [])
    setPayPlans(data?.plans ?? [])
    setUnpaidLoading(false)
  }

  // One section per membership (per slot), in a stable order
  const paySections = (() => {
    const map = new Map<string, { key: string; label: string; freq: string; rows: any[] }>()
    for (const c of unpaid) {
      const key = c.membership_id
      if (!map.has(key)) {
        const pos = c.group_memberships?.payout_position
        map.set(key, {
          key,
          label: `${c.susu_groups?.name ?? 'Group'}${pos ? ` — slot #${pos}` : ''}`,
          freq: c.susu_groups?.contribution_frequency ?? 'daily',
          rows: [],
        })
      }
      map.get(key)!.rows.push(c)
    }
    return Array.from(map.values())
  })()
  const visibleUnpaid = payFilter === 'all' ? unpaid : unpaid.filter(c => c.membership_id === payFilter)

  // Typing the amount received auto-ticks the oldest unpaid days —
  // within the chosen group/slot when one is selected
  function applyAmount(v: string, filterOverride?: string) {
    setAmountIn(v)
    const f = filterOverride ?? payFilter
    const pool = f === 'all' ? unpaid : unpaid.filter(c => c.membership_id === f)
    const amt = parseFloat(v)
    if (isNaN(amt) || amt <= 0) { setPayPicked(new Set()); return }
    let left = amt
    const next = new Set<string>()
    for (const c of pool) {
      const a = Number(c.amount)
      if (left >= a - 0.001) { next.add(c.id); left -= a } else break
    }
    setPayPicked(next)
  }

  async function submitPay() {
    setPaySaving(true)
    const token = getAdminToken()
    const { data, error } = await callFunction<{ message: string }>('payments-manual', {
      method: 'POST', token: token!,
      body: { contribution_ids: Array.from(payPicked), method: payMethod, note: payNote || undefined, no_sms: !paySms },
    })
    setPaySaving(false)
    if (error) { alert(error); return }
    setPayOpen(false)
    showToast(data?.message ?? 'Payment recorded')
    refreshMember()
  }

  async function sendMessage() {
    if (!msgText.trim()) return
    setMsgSending(true)
    const token = getAdminToken()
    const { error } = await callFunction<{ message: string }>(`admin-members?id=${id}`, {
      method: 'PATCH', token: token!, body: { message: msgText.trim() },
    })
    setMsgSending(false)
    if (error) { alert(error); return }
    setMsgOpen(false); setMsgText('')
    showToast('SMS sent to ' + member.full_name.split(' ')[0])
  }

  async function openAdd() {
    setAddOpen(true); setAddPicked(new Set()); setAddSlots({}); setAddDates({})
    if (allGroups.length === 0) {
      const token = getAdminToken()
      const { data } = await callFunction<{ groups: any[] }>('groups-create', { token: token! })
      setAllGroups(data?.groups ?? [])
    }
  }

  async function submitAdd() {
    if (addPicked.size === 0) return
    setAdding(true)
    const token = getAdminToken()
    const today = new Date().toISOString().split('T')[0]
    const { data, error } = await callFunction<any>('admin-onboard-member', {
      method: 'POST', token: token!,
      body: {
        member_id: id,
        plans: Array.from(addPicked).map(gid => ({
          group_id: gid,
          slots: addSlots[gid] || 1,
          fraction: addFracs[gid] ?? 1,
          start_date: today,
          amount_paid: 0,
          payout_date: addDates[gid] || undefined,
        })),
      },
    })
    setAdding(false)
    if (error) { alert(error); return }
    setAddOpen(false)
    showToast(`Added to ${data?.plans?.length ?? addPicked.size} group(s)`)
    refreshMember()
  }

  async function deleteMember() {
    setDeleting(true)
    const token = getAdminToken()
    const { data, error } = await callFunction<{ message: string }>(`admin-members?id=${id}`, {
      method: 'DELETE', token: token!,
    })
    setDeleting(false)
    if (error) { alert(error); return }
    alert(data?.message ?? 'Member deleted')
    router.push('/admin/members')
  }

  async function handleStatusChange(status: string) {
    setProcessing(true)
    const token = getAdminToken()
    const { error } = await callFunction(`admin-members?id=${id}`, {
      method: 'PATCH', body: { status, message }, token: token!,
    })
    setProcessing(false)
    if (error) { alert(error); return }
    showToast(`Member ${status}`)
    setMember((prev: any) => ({ ...prev, status }))
    setAction(null)
    setMessage('')
  }

  async function handleForfeit() {
    if (!forfeitTarget || !forfeitReason.trim()) { alert('Please enter a reason'); return }
    setForfeiting(true)
    const token = getAdminToken()
    const { error } = await callFunction('admin-forfeit', {
      method: 'POST',
      body: { membership_id: forfeitTarget.id, reason: forfeitReason, notify: true },
      token: token!,
    })
    setForfeiting(false)
    if (error) { alert(error); return }
    showToast('Slot forfeited — member notified')
    setForfeitTarget(null); setForfeitReason('')
    window.location.reload()
  }

  if (loading) return (
    <div className="flex justify-center py-32">Loading…</div>
  )

  if (!member) return (
    <div className="p-8 text-center text-ink-2">{loadErr ? `Could not load member: ${loadErr}` : 'Member not found.'} <Link href="/admin/members" className="text-ink underline">Back to members</Link></div>
  )

  const paid    = member.contributions?.filter((c: any) => c.status === 'paid').length ?? 0
  const pending = member.contributions?.filter((c: any) => c.status !== 'paid').length ?? 0

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      {toast && <div className="fixed top-4 right-4 z-50 bg-paper text-ink px-5 py-3 rounded-[10px]  text-sm">{toast}</div>}

      <Link href="/admin/members" className="flex items-center gap-2 text-ink-2 hover:text-ink text-sm mb-6 transition-colors">
        Back to Members
      </Link>

      {/* Header */}
      <div className="border border-line rounded-[10px] p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-[10px] bg-brand-green flex items-center justify-center">
              <span className="text-ink font-extrabold text-xl">{member.full_name[0]}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-ink">{member.full_name}</h1>
              <p className="text-ink-2 text-sm">{member.member_id} · {member.phone}</p>
              <span className={`inline-block mt-1 text-xs font-semibold px-2.5 py-1 rounded-[10px] ${member.status === 'active' ? 'bg-tint text-ink' : member.status === 'suspended' ? 'bg-tint text-red' : 'bg-tint text-ink-2'}`}>
                {member.status}
              </span>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={openPay}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-ink text-white rounded-[10px] text-sm font-semibold hover:brightness-105 transition-colors">
              Record Payment
            </button>
            <button onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-2 border border-line text-ink hover:bg-tint rounded-[10px] text-sm font-medium transition-colors">
              Add to Group
            </button>
            <button onClick={() => setMsgOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-line text-ink hover:bg-tint rounded-[10px] text-sm font-medium transition-colors">
              Send SMS
            </button>
            <button onClick={openPortal}
              className="flex items-center gap-1.5 px-3 py-2 border border-line text-ink hover:bg-tint rounded-[10px] text-sm font-medium transition-colors">
              Portal &amp; Passcode
            </button>
            <a href={`https://wa.me/${String(member.phone).replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 border border-line text-ink hover:bg-tint rounded-[10px] text-sm font-medium transition-colors">
              WhatsApp
            </a>
            {member.status === 'active' && (
              <button onClick={() => setAction('suspend')} className="flex items-center gap-1.5 px-3 py-2 bg-tint text-red hover:bg-tint rounded-[10px] text-sm font-medium transition-colors">
                Suspend
              </button>
            )}
            {member.status === 'suspended' && (
              <button onClick={() => setAction('activate')} className="flex items-center gap-1.5 px-3 py-2 bg-tint text-ink hover:bg-tint rounded-[10px] text-sm font-medium transition-colors">
                Re-activate
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action confirm */}
      {action && (
        <div className="border border-line rounded-[10px] p-5 mb-6 animate-slide-up">
          <h3 className="font-semibold text-ink mb-3">{action === 'suspend' ? 'Suspend member' : 'Re-activate member'}</h3>
          <textarea
            className="w-full px-3 py-2 bg-tint border border-line text-ink rounded-[10px] text-sm focus:outline-none focus:ring-0 focus:border-ink mb-3"
            rows={2} placeholder="Optional message to send the member via SMS…"
            value={message} onChange={e => setMessage(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={() => handleStatusChange(action === 'suspend' ? 'suspended' : 'active')} disabled={processing}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 font-semibold rounded-[10px] text-sm transition-colors ${action === 'suspend' ? 'bg-red text-white' : 'bg-ink text-white'}`}>
              {processing ? '…' : 'Confirm'}
            </button>
            <button onClick={() => setAction(null)} className="px-4 py-2.5 bg-tint text-ink-2 hover:text-ink rounded-[10px] text-sm transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Personal info */}
        <div className="border border-line rounded-[10px] p-5 space-y-3">
          <h2 className="font-bold text-ink mb-1">Personal Details</h2>
          {[
            ['Email',     member.email ?? '—'],
            ['WhatsApp',  member.whatsapp_number ?? '—'],
            ['Address',   member.residential_address ?? '—'],
            ['Occupation', member.occupation ?? '—'],
            ['Ghana Card', member.ghana_card_number],
            ['MoMo',      `${member.mobile_money_provider ?? ''} ${member.mobile_money_number ?? '—'}`],
            ['Bank',      member.bank_name ? `${member.bank_name} · ${member.bank_account_number}` : '—'],
            ['Member Since', format(new Date(member.created_at), 'MMM d, yyyy')],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-line pb-2 text-sm">
              <span className="text-ink-2">{k}</span>
              <span className="text-gray-200 font-medium text-right max-w-xs">{v}</span>
            </div>
          ))}
          {member.ghana_card_front_url && (
            <div className="flex gap-3 pt-1">
              <a href={member.ghana_card_front_url} target="_blank" className="text-ink text-xs underline">Ghana Card Front</a>
              {member.ghana_card_back_url && <a href={member.ghana_card_back_url} target="_blank" className="text-ink text-xs underline">Back</a>}
            </div>
          )}
        </div>

        {/* Groups + stats */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Contributions Paid',   value: paid, color: 'text-ink' },
              { label: 'Contributions Pending', value: pending,       color: 'text-ink-2'   },
            ].map(({ label, value, color }) => (
              <div key={label} className="border border-line rounded-[10px] p-4">
                <div className="text-2xl font-bold text-ink">{value}</div>
                <div className="text-xs text-ink-2 mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* Groups */}
          {member.group_memberships?.length > 0 && (
            <div className="border border-line rounded-[10px] p-5">
              <h2 className="font-bold text-ink mb-3">Susu Groups</h2>
              <div className="space-y-2">
                {member.group_memberships.map((gm: any) => (
                  <div key={gm.id} className={`p-3 rounded-[10px] ${gm.status === 'defaulted' ? 'bg-tint border border-red/40' : 'bg-tint'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-ink text-sm font-medium">{gm.susu_groups?.name}</p>
                        <p className="text-ink-2 text-xs">
                          Position #{gm.payout_position}
                          {gm.status === 'defaulted' && <span className="text-red font-semibold"> · FORFEITED</span>}
                        </p>
                      </div>
                      <div className="text-right">
                        {gm.payout_date && <p className="text-ink-2 text-xs">{format(new Date(gm.payout_date), 'MMM d, yyyy')}</p>}
                        {gm.payout_amount && <p className="text-ink text-sm font-bold">GHS {Number(gm.payout_amount).toLocaleString()}</p>}
                      </div>
                    </div>
                    {gm.status === 'defaulted' && gm.forfeit_reason && (
                      <p className="text-xs text-red mt-2 pt-2 border-t border-red/40">Reason: {gm.forfeit_reason}</p>
                    )}
                    {gm.status === 'active' && !gm.payout_received && !gm.payout_date && (
                      <p className="text-[11px] text-gold mt-1.5">No payout date set yet</p>
                    )}
                    {(gm.shared_with?.length ?? 0) > 0 && (
                      <p className="text-[11px] text-ink mt-1">🤝 Shared turn with {gm.shared_with.join(', ')} — dates move together</p>
                    )}
                    {Number(gm.slot_fraction ?? 1) < 1 && (
                      <p className="text-[11px] text-ink-2 mt-1">{Number(gm.slot_fraction) === 0.25 ? 'Quarter' : 'Half'} slot — pays and collects {Number(gm.slot_fraction) === 0.25 ? '¼' : '½'} of the group amounts</p>
                    )}
                    {gm.status === 'active' && (
                      <button onClick={() => openEdit(gm)}
                        className="mt-2 pt-2 border-t border-line w-full flex items-center justify-center gap-1.5 text-xs text-ink-2 hover:text-ink transition-colors">
                        Edit payout date / position / amount
                      </button>
                    )}
                    {gm.status === 'active' && !gm.payout_received && (
                      <button onClick={() => setForfeitTarget(gm)}
                        className="mt-2 pt-2 border-t border-line w-full flex items-center justify-center gap-1.5 text-xs text-red hover:text-red transition-colors">
                        Forfeit this slot
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add to Group modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setAddOpen(false)}>
          <div className="bg-white shadow-xl border border-line rounded-[10px] w-full max-w-lg p-6 space-y-4 animate-slide-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="font-bold text-ink text-lg">Add to Group</h2>
              <p className="text-ink-2 text-sm mt-0.5">{member.full_name} — tick groups, choose slots, optionally set a payout date.</p>
            </div>

            {allGroups.length === 0 ? (
              <p className="text-sm text-ink-3 py-6 text-center">Loading groups…</p>
            ) : (
              <div className="space-y-2.5">
                {allGroups.map((g: any) => {
                  const inGroup = (member.group_memberships ?? []).filter((gm: any) => gm.group_id === g.id && gm.status === 'active').length
                  const spotsLeft = g.max_members - g.current_members
                  const checked = addPicked.has(g.id)
                  return (
                    <label key={g.id}
                      className={`block p-3.5 border rounded-[10px] transition-colors ${
                        spotsLeft <= 0 && !checked ? 'opacity-50' : 'cursor-pointer'} ${checked ? 'border-ink bg-tint' : 'border-line hover:border-ink/40'}`}>
                      <span className="flex items-start gap-3">
                        <input type="checkbox" className="w-4 h-4 mt-0.5 accent-green" checked={checked} disabled={spotsLeft <= 0 && !checked}
                          onChange={() => setAddPicked(p2 => { const n = new Set(p2); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n })} />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-ink">{g.name}</span>
                            <span className="text-[11px] text-ink-3 shrink-0">
                              {inGroup > 0 ? `already ${inGroup} slot${inGroup > 1 ? 's' : ''} · ` : ''}{spotsLeft} left
                            </span>
                          </span>
                          <span className="block text-xs text-ink-2 mt-0.5">
                            GHS {Number(g.contribution_amount).toLocaleString()}/{g.contribution_frequency} · Cashout GHS {Number(g.cashout_amount ?? 0).toLocaleString()}
                          </span>
                          {checked && (
                            <span className="block mt-2 space-y-2" onClick={e => e.preventDefault()}>
                              <span className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <span className="text-xs text-ink-2">Size:</span>
                                {([[0.25,'¼'],[0.5,'½'],[1,'Full']] as [number,string][]).map(([f, lbl]) => (
                                  <button key={f} type="button"
                                    onClick={() => setAddFracs(prev => ({ ...prev, [g.id]: f }))}
                                    className={`px-2 h-7 rounded-[8px] text-[11px] font-bold transition-all ${
                                      (addFracs[g.id] ?? 1) === f ? 'bg-ink text-white' : 'bg-white border border-line text-ink-2'}`}>
                                    {lbl}
                                  </button>
                                ))}
                                <span className="text-xs text-ink-2 ml-1">Slots:</span>
                                {[1,2,3,4,5].map(n => (
                                  <button key={n} type="button"
                                    onClick={() => setAddSlots(prev => ({ ...prev, [g.id]: n }))}
                                    disabled={n > spotsLeft}
                                    className={`w-7 h-7 rounded-[8px] text-xs font-bold transition-all disabled:opacity-30 ${
                                      (addSlots[g.id] || 1) === n ? 'bg-ink text-white' : 'bg-white border border-line text-ink-2'}`}>
                                    {n}
                                  </button>
                                ))}
                              </span>
                              {Array.from({ length: addSlots[g.id] || 1 }, (_, i) => (
                                <span key={i} className="flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                                  <span className="text-xs text-ink-2 w-28">
                                    {(addSlots[g.id] || 1) > 1 ? `Slot ${i + 1} payout:` : 'Payout date:'}
                                  </span>
                                  <input type="date" value={addDates[`${g.id}:${i}`] ?? ''}
                                    onChange={e => setAddDates(prev => ({ ...prev, [`${g.id}:${i}`]: e.target.value }))}
                                    className="px-3 py-1.5 bg-white border border-line text-ink rounded-[8px] text-xs focus:outline-none focus:border-ink" />
                                  <span className="text-[11px] text-ink-3">optional</span>
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            <button onClick={submitAdd} disabled={adding || addPicked.size === 0}
              className="w-full py-3.5 bg-ink text-white font-bold rounded-[10px] hover:brightness-105 transition-all disabled:opacity-50">
              {adding ? 'Adding…' : addPicked.size === 0 ? 'Tick at least one group' : `Add to ${addPicked.size} group${addPicked.size > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* Record Payment modal — this member only */}
      {payOpen && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setPayOpen(false)}>
          <div className="bg-white border border-line rounded-[10px] w-full max-w-lg p-6 space-y-4 animate-slide-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="font-bold text-ink text-lg">Record Payment</h2>
              <p className="text-ink-2 text-sm mt-0.5">{member.full_name} · {member.member_id}</p>
            </div>

            {unpaidLoading ? (
              <p className="text-sm text-ink-3 py-6 text-center">Loading unpaid days…</p>
            ) : unpaid.length === 0 ? (
              <div className="py-4 space-y-3">
                {payPlans.length === 0 ? (
                  <p className="text-sm text-ink-2 text-center">Not in any group yet — use Add to Group first.</p>
                ) : (
                  <>
                    <p className="text-sm text-ink-2 text-center">No payment days found. Here's why, per plan:</p>
                    {payPlans.map((pl: any) => (
                      <div key={pl.id} className="border border-line rounded-[10px] p-3.5">
                        <p className="text-sm font-semibold text-ink">
                          {pl.susu_groups?.name} — slot #{pl.payout_position}
                        </p>
                        {pl.susu_groups?.status !== 'active' ? (
                          <p className="text-xs text-gold mt-1.5">
                            This group is not activated yet ({pl.susu_groups?.status}). Payment days only exist once the group
                            is activated — set its start date and activate it on the Groups page, then come back here.
                          </p>
                        ) : (
                          <>
                            <p className="text-xs text-ink-2 mt-1.5">
                              The group is running but this slot has no payment days yet.
                            </p>
                            <button onClick={async () => {
                                const token = getAdminToken()
                                const { data, error } = await callFunction<{ message: string }>(
                                  `admin-members?membership_id=${pl.id}`,
                                  { method: 'PATCH', token: token!, body: { regenerate: true } })
                                if (error) { alert(error); return }
                                alert(data?.message ?? 'Done')
                                openPay()
                              }}
                              className="mt-2 px-3 py-1.5 bg-ink text-white text-xs font-semibold rounded-[8px] hover:brightness-105 transition-colors">
                              Generate payment days
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm text-ink-2 mb-1.5">Which plan is this payment for?</label>
                  <select value={payFilter}
                    onChange={e => { setPayFilter(e.target.value); setPayPicked(new Set()); if (amountIn) applyAmount(amountIn, e.target.value) }}
                    className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:border-ink">
                    <option value="all">All groups & slots ({unpaid.length} unpaid days)</option>
                    {paySections.map(sec => (
                      <option key={sec.key} value={sec.key}>
                        {sec.label} · {sec.freq} · {sec.rows.length} unpaid — GHS {sec.rows.reduce((t: number, r: any) => t + Number(r.amount), 0).toLocaleString()} owed
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-ink-2 mb-1.5">Amount received (GHS)</label>
                  <input type="number" min="0" step="0.01" autoFocus value={amountIn} onChange={e => applyAmount(e.target.value)}
                    placeholder="Type the amount — oldest days tick themselves"
                    className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:border-ink" />
                </div>

                <div className="border border-line rounded-[10px] max-h-60 overflow-y-auto">
                  {paySections.filter(sec => payFilter === 'all' || sec.key === payFilter).map(sec => (
                    <div key={sec.key}>
                      <div className="sticky top-0 bg-tint px-3.5 py-2 border-b border-line flex items-center justify-between">
                        <span className="text-xs font-bold text-ink">{sec.label}</span>
                        <span className="text-[11px] text-ink-2">{sec.freq} · {sec.rows.length} unpaid</span>
                      </div>
                      <div className="divide-y divide-line">
                        {sec.rows.map((c: any) => (
                          <label key={c.id} className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-tint">
                            <input type="checkbox" className="w-4 h-4 accent-green" checked={payPicked.has(c.id)}
                              onChange={() => setPayPicked(p => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} />
                            <span className="flex-1 text-sm text-ink">{format(new Date(c.due_date), 'EEE, MMM d')}</span>
                            {c.status === 'overdue' && <span className="badge-red text-[10px]">Overdue</span>}
                            <span className="text-sm font-semibold text-ink tnum">GHS {Number(c.amount).toFixed(2)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block text-sm text-ink-2 mb-1.5">How was it paid?</label>
                  <div className="flex gap-2">
                    {(['momo', 'cash', 'bank'] as const).map(m => (
                      <button key={m} type="button" onClick={() => setPayMethod(m)}
                        className={`flex-1 py-2.5 rounded-[10px] text-sm font-semibold capitalize transition-all ${
                          payMethod === m ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink border border-line'}`}>
                        {m === 'momo' ? 'MoMo' : m}
                      </button>
                    ))}
                  </div>
                </div>
                <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="Reference / note — e.g. MoMo TXN ID (optional)"
                  className="w-full px-4 py-2.5 bg-tint border border-line text-ink rounded-[10px] text-sm focus:outline-none focus:border-ink" />
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={paySms} onChange={e => setPaySms(e.target.checked)} className="w-4 h-4 accent-green" />
                  <span className="text-sm text-ink">Send SMS receipt</span>
                </label>

                <button onClick={submitPay} disabled={paySaving || payPicked.size === 0}
                  className="w-full py-3.5 bg-ink text-white font-bold rounded-[10px] hover:brightness-105 transition-all disabled:opacity-50">
                  {paySaving ? 'Saving…'
                    : payPicked.size === 0 ? 'Tick the days being paid for'
                    : `Confirm GHS ${unpaid.filter((c: any) => payPicked.has(c.id)).reduce((s: number, c: any) => s + Number(c.amount), 0).toLocaleString()} · ${payPicked.size} day${payPicked.size > 1 ? 's' : ''}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Portal & Passcode modal */}
      {portalOpen && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setPortalOpen(false)}>
          <div className="bg-white shadow-xl border border-line rounded-[10px] w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="font-bold text-ink text-lg">Portal &amp; Passcode</h2>
              <p className="text-ink-2 text-sm mt-0.5">{member.full_name} · {member.member_id}</p>
            </div>

            {!portalData ? (
              <p className="text-sm text-ink-3 py-6 text-center">Loading…</p>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-tint border border-line rounded-[10px]">
                  <p className="text-xs text-ink-2 mb-1">Portal link</p>
                  <p className="text-sm text-ink font-mono break-all">{portalData.portal_url}</p>
                  {portalData.passcode && (
                    <p className="text-sm text-ink mt-2"><span className="text-ink-2">New passcode: </span><span className="font-bold text-lg tnum">{portalData.passcode}</span></p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button onClick={() => copyText(portalData.whatsapp_text)}
                    className="flex-1 py-2.5 border border-line text-ink text-sm font-semibold rounded-[10px] hover:bg-tint transition-colors">
                    Copy message
                  </button>
                  {portalData.whatsapp_link && (
                    <a href={portalData.whatsapp_link} target="_blank" rel="noopener noreferrer"
                      onClick={() => copyText(portalData.whatsapp_text)}
                      className="flex-1 py-2.5 bg-ink text-white text-sm font-semibold rounded-[10px] text-center hover:brightness-105 transition-all">
                      Open WhatsApp
                    </a>
                  )}
                </div>
                <p className="text-[11px] text-ink-3">Tip: tap "Open WhatsApp" (message is copied) then paste it to the member.</p>

                <div className="border-t border-line pt-3">
                  <p className="text-xs text-ink-2 mb-2">Member lost their passcode?</p>
                  <div className="flex gap-2">
                    <button onClick={() => resetPasscode(true)} disabled={portalBusy}
                      className="flex-1 py-2.5 bg-ink text-white text-sm font-semibold rounded-[10px] hover:brightness-105 transition-all disabled:opacity-50">
                      {portalBusy ? 'Resetting…' : 'Reset &amp; SMS new passcode'}
                    </button>
                    <button onClick={() => resetPasscode(false)} disabled={portalBusy}
                      className="py-2.5 px-3 border border-line text-ink text-sm font-medium rounded-[10px] hover:bg-tint transition-colors disabled:opacity-50">
                      Reset only
                    </button>
                  </div>
                </div>
              </div>
            )}
            <button onClick={() => setPortalOpen(false)} className="w-full text-ink-2 text-sm hover:text-ink transition-colors py-1">Close</button>
          </div>
        </div>
      )}

      {/* Send SMS modal */}
      {msgOpen && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setMsgOpen(false)}>
          <div className="bg-white border border-line rounded-[10px] w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="font-bold text-ink text-lg">Send SMS</h2>
              <p className="text-ink-2 text-sm mt-0.5">To {member.full_name} · {member.phone}</p>
            </div>
            <textarea autoFocus rows={4} value={msgText} onChange={e => setMsgText(e.target.value)}
              placeholder={`Hi ${member.full_name.split(' ')[0]}, …`}
              className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] text-sm focus:outline-none focus:border-ink resize-none" />
            <p className="text-[11px] text-ink-3 -mt-2 text-right">{msgText.length} characters{msgText.length > 160 ? ` · ${Math.ceil(msgText.length / 153)} SMS` : ''}</p>
            <div className="flex gap-3">
              <button onClick={() => setMsgOpen(false)} className="flex-1 py-3 border border-line text-ink font-semibold rounded-[10px] hover:bg-tint transition-colors">Cancel</button>
              <button onClick={sendMessage} disabled={msgSending || !msgText.trim()}
                className="flex-1 py-3 bg-ink text-white font-semibold rounded-[10px] hover:brightness-105 transition-colors disabled:opacity-50">
                {msgSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit payout modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setEditTarget(null)}>
          <div className="bg-white border border-line rounded-[10px] w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="font-bold text-ink text-lg">Edit payout details</h2>
              <p className="text-ink-2 text-xs mt-0.5">{editTarget.susu_groups?.name}</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Payout position</label>
                <input type="number" min="1" value={editForm.payout_position}
                  onChange={e => setEditForm(p => ({ ...p, payout_position: e.target.value }))}
                  className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:border-ink" />
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Payout date</label>
                <input type="date" value={editForm.payout_date}
                  onChange={e => setEditForm(p => ({ ...p, payout_date: e.target.value }))}
                  className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:border-ink" />
                <p className="text-[11px] text-ink-3 mt-1">Clearing this removes the scheduled payout.</p>
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Payout amount (GHS)</label>
                <input type="number" min="0" step="0.01" value={editForm.payout_amount}
                  onChange={e => setEditForm(p => ({ ...p, payout_amount: e.target.value }))}
                  className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:border-ink" />
              </div>

              {/* Shared payout turn */}
              <div className="border-t border-line pt-3">
                <p className="text-sm font-semibold text-ink">Share this payout turn</p>
                {editTarget.shared_slot_key ? (
                  <div className="mt-1.5">
                    <p className="text-xs text-ink-2">
                      Shared with {editTarget.shared_with?.join(', ') || 'other slot(s)'} — dates move together.
                    </p>
                    <button type="button" onClick={unpair} disabled={pairing}
                      className="mt-2 text-xs text-red hover:underline underline-offset-2 disabled:opacity-50">
                      {pairing ? '…' : 'Unpair this slot'}
                    </button>
                  </div>
                ) : pairCands === null ? (
                  <p className="text-xs text-ink-3 mt-1.5">Loading partners…</p>
                ) : pairCands.length === 0 ? (
                  <p className="text-xs text-ink-3 mt-1.5">No other members hold slots in this group yet.</p>
                ) : (
                  <>
                    <p className="text-xs text-ink-3 mt-1">Tick who shares this turn — everyone gets the same payout date, each collecting their own fraction.</p>
                    <div className="mt-2 max-h-36 overflow-y-auto border border-line rounded-[10px] divide-y divide-line">
                      {pairCands.map((c: any) => (
                        <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-tint">
                          <input type="checkbox" className="w-4 h-4 accent-green" checked={pairPicked.has(c.id)}
                            onChange={() => setPairPicked(p => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} />
                          <span className="flex-1 text-sm text-ink">{c.full_name}</span>
                          <span className="text-[11px] text-ink-3">
                            #{c.payout_position}{Number(c.slot_fraction) < 1 ? ` · ${Number(c.slot_fraction) === 0.25 ? '¼' : '½'}` : ''}{c.payout_date ? ` · ${c.payout_date}` : ''}
                          </span>
                        </label>
                      ))}
                    </div>
                    {pairPicked.size > 0 && (
                      <button type="button" onClick={savePair} disabled={pairing}
                        className="mt-2 w-full py-2.5 border border-ink text-ink text-sm font-semibold rounded-[10px] hover:bg-tint transition-colors disabled:opacity-50">
                        {pairing ? 'Pairing…' : `Pair with ${pairPicked.size} slot${pairPicked.size > 1 ? 's' : ''}${editForm.payout_date ? ` on ${editForm.payout_date}` : ''}`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditTarget(null)} className="flex-1 py-3 border border-line text-ink font-semibold rounded-[10px] hover:bg-tint transition-colors">Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit}
                className="flex-1 py-3 bg-ink text-white font-semibold rounded-[10px] hover:brightness-105 transition-colors disabled:opacity-50">
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Danger zone */}
      <div className="border border-red/40 rounded-[10px] p-5 mt-6">
        <h2 className="font-bold text-red text-sm">Danger zone</h2>
        <p className="text-ink-2 text-xs mt-1.5 leading-relaxed">
          Permanently delete this member and every record attached to them — memberships, contributions,
          scheduled payouts, transactions and notifications. This is for members created <strong>by mistake</strong>.
          If a real member is leaving, suspend them instead so their money history survives.
        </p>
        <button onClick={() => { setDelOpen(true); setDelText('') }}
          className="mt-3 px-4 py-2 border border-red/50 text-red text-sm font-semibold rounded-[10px] hover:bg-red hover:text-white transition-colors">
          Delete this member permanently
        </button>
      </div>

      {/* Delete confirm modal */}
      {delOpen && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setDelOpen(false)}>
          <div className="bg-white border border-line rounded-[10px] w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="font-bold text-red text-lg">Delete {member.full_name}?</h2>
              <p className="text-ink-2 text-sm mt-1.5 leading-relaxed">
                This erases their account and all attached records. It cannot be undone.
                Members who have already received a payout cannot be deleted.
              </p>
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">
                Type <span className="font-mono font-semibold text-ink">{member.member_id}</span> to confirm
              </label>
              <input autoFocus value={delText} onChange={e => setDelText(e.target.value)}
                placeholder={member.member_id}
                className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] font-mono focus:outline-none focus:border-red" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDelOpen(false)} className="flex-1 py-3 border border-line text-ink font-semibold rounded-[10px] hover:bg-tint transition-colors">Cancel</button>
              <button onClick={deleteMember} disabled={deleting || delText.trim() !== member.member_id}
                className="flex-1 py-3 bg-red text-white font-semibold rounded-[10px] hover:brightness-105 transition-colors disabled:opacity-40">
                {deleting ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forfeit modal */}
      {forfeitTarget && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setForfeitTarget(null)}>
          <div className="bg-white shadow-xl border border-line rounded-[10px] w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[10px] bg-tint flex items-center justify-center">
                </div>
              <div>
                <h2 className="font-bold text-ink text-lg">Forfeit Slot</h2>
                <p className="text-ink-2 text-xs">{forfeitTarget.susu_groups?.name} · Position #{forfeitTarget.payout_position}</p>
              </div>
            </div>

            <div className="p-3 bg-tint border border-red/40 rounded-[10px]">
              <p className="text-red text-sm font-medium">This will permanently:</p>
              <ul className="text-red/80 text-xs mt-2 space-y-1 list-disc list-inside">
                <li>Cancel all remaining contributions</li>
                <li>Cancel their upcoming payout</li>
                <li>Suspend their member account</li>
                <li>Free up the slot in this group</li>
                <li>Notify the member by SMS</li>
              </ul>
              <p className="text-red text-xs mt-2 font-medium">Per platform s, no refund applies.</p>
            </div>

            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Reason for forfeiture *</label>
              <textarea rows={2} value={forfeitReason} onChange={e => setForfeitReason(e.target.value)}
                className="w-full px-3 py-2 bg-tint border border-line text-ink rounded-[10px] text-sm focus:outline-none focus:ring-0 focus:ring-red-500 resize-none"
                placeholder="e.g. Defaulted on 12 consecutive contributions" />
            </div>

            <button onClick={handleForfeit} disabled={forfeiting || !forfeitReason.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 bg-red text-white font-bold rounded-[10px] transition-colors disabled:opacity-40">
              {forfeiting ? 'Forfeiting…' : 'Confirm forfeiture'}
              Confirm Forfeiture
            </button>
            <button onClick={() => setForfeitTarget(null)} className="w-full text-ink-2 text-sm hover:text-ink py-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Recent transactions */}
      {member.transactions?.length > 0 && (
        <div className="border border-line rounded-[10px] p-5 mt-6">
          <h2 className="font-bold text-ink mb-4">Recent Transactions</h2>
          <div className="space-y-2">
            {member.transactions.slice(0, 10).map((t: any) => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-line last:border-0 text-sm">
                <div>
                  <p className="text-ink capitalize">{t.type.replace('_', ' ')}</p>
                  <p className="text-ink-3 text-xs font-mono">{t.reference}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${t.type === 'payout' ? 'text-ink' : 'text-ink'}`}>GHS {Number(t.amount).toFixed(2)}</span>
                  <span className={t.status === 'success' ? 'badge-green' : t.status === 'pending' ? 'badge-gold' : 'badge-red'}>{t.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
