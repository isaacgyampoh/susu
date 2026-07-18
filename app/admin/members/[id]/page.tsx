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
  const [action, setAction]   = useState<'suspend' | 'activate' | null>(null)
  const [forfeitTarget, setForfeitTarget] = useState<any>(null)
  const [forfeitReason, setForfeitReason] = useState('')
  const [forfeiting, setForfeiting] = useState(false)
  const [message, setMessage] = useState('')
  const [processing, setProcessing] = useState(false)
  const [toast, setToast]     = useState('')
  const [editTarget, setEditTarget] = useState<any>(null)
  const [editForm, setEditForm] = useState({ payout_position: '', payout_date: '', payout_amount: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  // Record Payment (this member)
  const [payOpen, setPayOpen]     = useState(false)
  const [unpaid, setUnpaid]       = useState<any[]>([])
  const [unpaidLoading, setUnpaidLoading] = useState(false)
  const [payPicked, setPayPicked] = useState<Set<string>>(new Set())
  const [amountIn, setAmountIn]   = useState('')
  const [payMethod, setPayMethod] = useState<'cash' | 'momo' | 'bank'>('momo')
  const [payNote, setPayNote]     = useState('')
  const [paySms, setPaySms]       = useState(true)
  const [paySaving, setPaySaving] = useState(false)
  // Send message
  const [msgOpen, setMsgOpen]   = useState(false)
  const [msgText, setMsgText]   = useState('')
  const [msgSending, setMsgSending] = useState(false)
  // Danger zone
  const [delOpen, setDelOpen]   = useState(false)
  const [delText, setDelText]   = useState('')
  const [deleting, setDeleting] = useState(false)

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    const token = getAdminToken()
    callFunction<{ member: any }>(`admin-members?id=${id}`, { token: token! })
      .then(({ data }) => setMember(data?.member))
      .finally(() => setLoading(false))
  }, [id])

  function openEdit(gm: any) {
    setEditTarget(gm)
    setEditForm({
      payout_position: gm.payout_position ? String(gm.payout_position) : '',
      payout_date:     gm.payout_date ?? '',
      payout_amount:   gm.payout_amount != null ? String(gm.payout_amount) : '',
    })
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
    setPayOpen(true); setPayPicked(new Set()); setAmountIn(''); setPayNote('')
    setUnpaidLoading(true)
    const token = getAdminToken()
    const [{ data: over }, { data: pend }] = await Promise.all([
      callFunction<{ contributions: any[] }>(`contributions-list?member_id=${id}&status=overdue&sort=asc&page=1`, { token: token! }),
      callFunction<{ contributions: any[] }>(`contributions-list?member_id=${id}&status=pending&sort=asc&page=1`, { token: token! }),
    ])
    const all = [...(over?.contributions ?? []), ...(pend?.contributions ?? [])]
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
    setUnpaid(all)
    setUnpaidLoading(false)
  }

  // Typing the amount received auto-ticks the member's oldest unpaid days
  function applyAmount(v: string) {
    setAmountIn(v)
    const amt = parseFloat(v)
    if (isNaN(amt) || amt <= 0) { setPayPicked(new Set()); return }
    let left = amt
    const next = new Set<string>()
    for (const c of unpaid) {
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
    <div className="p-8 text-center text-ink-2">Member not found. <Link href="/admin/members" className="text-ink underline">Back to members</Link></div>
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
            <button onClick={() => setMsgOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-line text-ink hover:bg-tint rounded-[10px] text-sm font-medium transition-colors">
              Send SMS
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
                    {gm.status === 'active' && !gm.payout_received && (
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
              <p className="text-sm text-ink-2 py-6 text-center">No pending or overdue contributions — fully up to date. 🎉</p>
            ) : (
              <>
                <div>
                  <label className="block text-sm text-ink-2 mb-1.5">Amount received (GHS)</label>
                  <input type="number" min="0" step="0.01" autoFocus value={amountIn} onChange={e => applyAmount(e.target.value)}
                    placeholder="Type the amount — oldest days tick themselves"
                    className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:border-ink" />
                </div>

                <div className="border border-line rounded-[10px] max-h-52 overflow-y-auto divide-y divide-line">
                  {unpaid.map((c: any) => (
                    <label key={c.id} className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-tint">
                      <input type="checkbox" className="w-4 h-4 accent-green" checked={payPicked.has(c.id)}
                        onChange={() => setPayPicked(p => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} />
                      <span className="flex-1 text-sm text-ink">{format(new Date(c.due_date), 'EEE, MMM d')}</span>
                      <span className="text-xs text-ink-2">{c.susu_groups?.name}</span>
                      {c.status === 'overdue' && <span className="badge-red text-[10px]">Overdue</span>}
                      <span className="text-sm font-semibold text-ink tnum">GHS {Number(c.amount).toFixed(2)}</span>
                    </label>
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
          <div className="border border-line rounded-[10px] w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
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
