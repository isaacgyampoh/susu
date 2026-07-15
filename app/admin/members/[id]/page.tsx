'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { format } from 'date-fns'
import { Loader2, ArrowLeft, UserCheck, UserX, CheckCircle, AlertCircle, Clock, Ban, AlertTriangle } from 'lucide-react'

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

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    const token = getAdminToken()
    callFunction<{ member: any }>(`admin-members?id=${id}`, { token: token! })
      .then(({ data }) => setMember(data?.member))
      .finally(() => setLoading(false))
  }, [id])

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
    <div className="flex justify-center py-32"><Loader2 className="animate-spin text-ink" size={32} /></div>
  )

  if (!member) return (
    <div className="p-8 text-center text-ink-2">Member not found. <Link href="/admin/members" className="text-ink underline">Back to members</Link></div>
  )

  const paid    = member.contributions?.filter((c: any) => c.status === 'paid').length ?? 0
  const pending = member.contributions?.filter((c: any) => c.status !== 'paid').length ?? 0

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto pb-12 animate-fade-in">
      {toast && <div className="fixed top-4 right-4 z-50 bg-paper text-ink px-5 py-3 rounded-[3px]  text-sm">{toast}</div>}

      <Link href="/admin/members" className="flex items-center gap-2 text-ink-2 hover:text-ink text-sm mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Members
      </Link>

      {/* Header */}
      <div className="border border-line rounded-[3px] p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-[3px] bg-brand-green flex items-center justify-center">
              <span className="text-ink font-extrabold text-xl">{member.full_name[0]}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-ink">{member.full_name}</h1>
              <p className="text-ink-2 text-sm">{member.member_id} · {member.phone}</p>
              <span className={`inline-block mt-1 text-xs font-semibold px-2.5 py-1 rounded-[3px] ${member.status === 'active' ? 'bg-wash text-ink' : member.status === 'suspended' ? 'bg-wash text-alert' : 'bg-wash text-ink-2'}`}>
                {member.status}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {member.status === 'active' && (
              <button onClick={() => setAction('suspend')} className="flex items-center gap-1.5 px-3 py-2 bg-wash text-alert hover:bg-wash rounded-[3px] text-sm font-medium transition-colors">
                <UserX size={14} /> Suspend
              </button>
            )}
            {member.status === 'suspended' && (
              <button onClick={() => setAction('activate')} className="flex items-center gap-1.5 px-3 py-2 bg-wash text-ink hover:bg-wash rounded-[3px] text-sm font-medium transition-colors">
                <UserCheck size={14} /> Re-activate
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action confirm */}
      {action && (
        <div className="border border-line rounded-[3px] p-5 mb-6 animate-slide-up">
          <h3 className="font-semibold text-ink mb-3">{action === 'suspend' ? 'Suspend member' : 'Re-activate member'}</h3>
          <textarea
            className="w-full px-3 py-2 bg-wash border border-line text-ink rounded-[3px] text-sm focus:outline-none focus:ring-0 focus:border-ink mb-3"
            rows={2} placeholder="Optional message to send the member via SMS…"
            value={message} onChange={e => setMessage(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={() => handleStatusChange(action === 'suspend' ? 'suspended' : 'active')} disabled={processing}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 font-semibold rounded-[3px] text-sm transition-colors ${action === 'suspend' ? 'bg-alert text-paper' : 'bg-ink text-paper'}`}>
              {processing ? <Loader2 size={15} className="animate-spin" /> : 'Confirm'}
            </button>
            <button onClick={() => setAction(null)} className="px-4 py-2.5 bg-wash text-ink-2 hover:text-ink rounded-[3px] text-sm transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Personal info */}
        <div className="border border-line rounded-[3px] p-5 space-y-3">
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
              { label: 'Contributions Paid',   value: paid,    icon: CheckCircle, color: 'text-ink' },
              { label: 'Contributions Pending', value: pending, icon: Clock,       color: 'text-ink-2'   },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="border border-line rounded-[3px] p-4">
                <Icon size={18} className={`${color} mb-2`} />
                <div className="text-2xl font-bold text-ink">{value}</div>
                <div className="text-xs text-ink-2 mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* Groups */}
          {member.group_memberships?.length > 0 && (
            <div className="border border-line rounded-[3px] p-5">
              <h2 className="font-bold text-ink mb-3">Susu Groups</h2>
              <div className="space-y-2">
                {member.group_memberships.map((gm: any) => (
                  <div key={gm.id} className={`p-3 rounded-[3px] ${gm.status === 'defaulted' ? 'bg-wash border border-alert/40' : 'bg-wash'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-ink text-sm font-medium">{gm.susu_groups?.name}</p>
                        <p className="text-ink-2 text-xs">
                          Position #{gm.payout_position}
                          {gm.status === 'defaulted' && <span className="text-alert font-semibold"> · FORFEITED</span>}
                        </p>
                      </div>
                      <div className="text-right">
                        {gm.payout_date && <p className="text-ink-2 text-xs">{format(new Date(gm.payout_date), 'MMM d, yyyy')}</p>}
                        {gm.payout_amount && <p className="text-ink text-sm font-bold">GHS {Number(gm.payout_amount).toLocaleString()}</p>}
                      </div>
                    </div>
                    {gm.status === 'defaulted' && gm.forfeit_reason && (
                      <p className="text-xs text-alert mt-2 pt-2 border-t border-alert/40">Reason: {gm.forfeit_reason}</p>
                    )}
                    {gm.status === 'active' && !gm.payout_received && (
                      <button onClick={() => setForfeitTarget(gm)}
                        className="mt-2 pt-2 border-t border-line w-full flex items-center justify-center gap-1.5 text-xs text-alert hover:text-alert transition-colors">
                        <Ban size={12} /> Forfeit this slot
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Forfeit modal */}
      {forfeitTarget && (
        <div className="fixed inset-0 z-50 bg-ink/20 flex items-center justify-center p-4" onClick={() => setForfeitTarget(null)}>
          <div className="border border-line rounded-[3px] w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[3px] bg-wash flex items-center justify-center">
                <AlertTriangle size={20} className="text-alert" />
              </div>
              <div>
                <h2 className="font-bold text-ink text-lg">Forfeit Slot</h2>
                <p className="text-ink-2 text-xs">{forfeitTarget.susu_groups?.name} · Position #{forfeitTarget.payout_position}</p>
              </div>
            </div>

            <div className="p-3 bg-wash border border-alert/40 rounded-[3px]">
              <p className="text-alert text-sm font-medium">This will permanently:</p>
              <ul className="text-alert/80 text-xs mt-2 space-y-1 list-disc list-inside">
                <li>Cancel all remaining contributions</li>
                <li>Cancel their upcoming payout</li>
                <li>Suspend their member account</li>
                <li>Free up the slot in this group</li>
                <li>Notify the member by SMS</li>
              </ul>
              <p className="text-alert text-xs mt-2 font-medium">Per platform rules, no refund applies.</p>
            </div>

            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Reason for forfeiture *</label>
              <textarea rows={2} value={forfeitReason} onChange={e => setForfeitReason(e.target.value)}
                className="w-full px-3 py-2 bg-wash border border-line text-ink rounded-[3px] text-sm focus:outline-none focus:ring-0 focus:ring-red-500 resize-none"
                placeholder="e.g. Defaulted on 12 consecutive contributions" />
            </div>

            <button onClick={handleForfeit} disabled={forfeiting || !forfeitReason.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 bg-alert text-paper font-bold rounded-[3px] transition-colors disabled:opacity-40">
              {forfeiting ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
              Confirm Forfeiture
            </button>
            <button onClick={() => setForfeitTarget(null)} className="w-full text-ink-2 text-sm hover:text-ink py-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Recent transactions */}
      {member.transactions?.length > 0 && (
        <div className="border border-line rounded-[3px] p-5 mt-6">
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
