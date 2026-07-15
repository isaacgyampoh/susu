'use client'
import { useEffect, useState } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard } from '@/types'
import { format } from 'date-fns'
import RotationRing from '@/components/susu/rotation-ring'
import { Loader2, Send, Check, ChevronDown, MessageCircle, Phone, Copy } from 'lucide-react'

const ghs = (n: any) => Number(n ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <span className="text-[13px] text-muted shrink-0">{label}</span>
      <span className="text-[14px] font-medium text-right">{value}</span>
    </div>
  )
}

export default function ProfilePage() {
  const [data, setData]       = useState<MemberDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen]       = useState(false)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)
  const [copied, setCopied]   = useState(false)

  async function load() {
    const token = getMemberToken()
    const { data } = await callFunction<MemberDashboard>('member-profile', { token: token! })
    setData(data); setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    const token = getMemberToken()
    const { error } = await callFunction('contact-admin',
      { method: 'POST', body: { subject, message }, token: token! })
    setSending(false)
    if (error) { alert(error); return }
    setSent(true); setSubject(''); setMessage('')
    load()
    setTimeout(() => setSent(false), 5000)
  }

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="animate-spin text-forest" size={26} /></div>
  if (!data)   return <div className="px-5 py-20 text-center text-muted">Couldn't load your profile.</div>

  const { member, plans, payouts, myMessages } = data

  return (
    <div className="px-5 pt-6 pb-28 max-w-lg mx-auto animate-fade-in">

      {/* Identity */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-full bg-forest grid place-items-center shrink-0">
          <span className="text-gold font-extrabold text-2xl">{member.full_name[0]}</span>
        </div>
        <div className="min-w-0">
          <h1 className="display text-[26px] truncate">{member.full_name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[13px] text-muted font-mono">{member.member_id}</span>
            <button onClick={() => { navigator.clipboard.writeText(member.member_id); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              aria-label="Copy member ID" className="text-muted hover:text-ink transition-colors">
              {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
            </button>
            <span className={member.status === 'active' ? 'chip-paid' : 'chip-late'}>{member.status}</span>
          </div>
        </div>
      </div>

      {/* Plans with their rotations */}
      {plans.length > 0 && (
        <section className="mb-6">
          <h2 className="font-bold text-[15px] mb-3 px-1">Your plans</h2>
          <div className="space-y-3">
            {plans.map(p => {
              const g = p.susu_groups!
              const cashout = Number(p.payout_amount ?? g.cashout_amount ?? 0) + Number(g.registration_fee ?? 0)
              return (
                <div key={p.id} className="sheet p-5 flex items-center gap-5">
                  <RotationRing total={g.max_members} position={p.payout_position} size={84} thickness={5}>
                    <span className="display text-[16px] tnum">{p.payout_position}</span>
                    <span className="text-[9px] text-muted -mt-0.5">of {g.max_members}</span>
                  </RotationRing>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[15px] truncate">{g.name}</p>
                    <p className="text-[12px] text-muted mt-0.5">
                      GHS {ghs(g.contribution_amount)} {g.contribution_frequency}
                    </p>
                    {p.payout_date && (
                      <p className="text-[12px] text-muted">
                        Collects {format(new Date(p.payout_date), 'd MMM yyyy')}
                      </p>
                    )}
                    <p className="display text-[18px] text-forest tnum mt-1.5">GHS {ghs(cashout)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Cashouts received */}
      {payouts.filter(p => p.status === 'paid').length > 0 && (
        <section className="mb-6">
          <h2 className="font-bold text-[15px] mb-3 px-1">Cashouts received</h2>
          <div className="sheet divide-y divide-hairline overflow-hidden">
            {payouts.filter(p => p.status === 'paid').map(p => (
              <div key={p.id} className="flex items-center gap-3.5 p-4">
                <div className="w-9 h-9 rounded-full bg-gold/15 grid place-items-center shrink-0">
                  <Check size={15} className="text-forest" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[14px] truncate">{p.susu_groups?.name}</p>
                  <p className="text-[12px] text-muted">{p.paid_at ? format(new Date(p.paid_at), 'd MMM yyyy') : ''}</p>
                </div>
                <p className="font-bold text-[15px] tnum text-forest shrink-0">GHS {ghs(p.total_amount)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Details */}
      <section className="sheet p-5 mb-6">
        <h2 className="font-bold text-[15px] mb-1">Your details</h2>
        <div className="divide-y divide-hairline">
          <Row label="Phone"       value={member.phone} />
          <Row label="Email"       value={member.email} />
          <Row label="MoMo"        value={member.mobile_money_number ? `${member.mobile_money_provider ?? ''} ${member.mobile_money_number}`.trim() : null} />
          <Row label="Occupation"  value={member.occupation} />
          <Row label="Address"     value={member.residential_address} />
          <Row label="Member since" value={format(new Date(member.created_at), 'd MMMM yyyy')} />
        </div>
        <p className="text-[12px] text-muted mt-4">Need a change? Message your admin below.</p>
      </section>

      {/* Contact admin */}
      <section className="sheet overflow-hidden">
        <button onClick={() => setOpen(!open)} className="w-full p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-canvas grid place-items-center">
              <MessageCircle size={16} className="text-forest" />
            </div>
            <div className="text-left">
              <p className="font-bold text-[15px]">Message your admin</p>
              <p className="text-[12px] text-muted">Questions about your plan or payout</p>
            </div>
          </div>
          <ChevronDown size={18} className={`text-muted transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="px-5 pb-5 animate-slide-up">
            {sent && (
              <div className="flex items-center gap-2 p-3.5 bg-emerald-50 rounded-2xl mb-4">
                <Check size={15} className="text-emerald-600 shrink-0" />
                <p className="text-emerald-800 text-[13px]">Sent. Your admin will reply here.</p>
              </div>
            )}

            <form onSubmit={send} className="space-y-3">
              <input className="field !py-3.5" required value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="What's this about?" />
              <textarea className="field !py-3.5 resize-none" required rows={3} value={message}
                onChange={e => setMessage(e.target.value)} placeholder="Write your message" />
              <button type="submit" disabled={sending} className="pill-ink w-full">
                {sending ? <Loader2 size={16} className="animate-spin" /> : <><Send size={15} /> Send message</>}
              </button>
            </form>

            {myMessages.length > 0 && (
              <div className="mt-6 pt-5 border-t border-hairline space-y-3">
                <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">Previous</p>
                {myMessages.map(m => (
                  <div key={m.id} className="bg-canvas rounded-2xl p-4">
                    <div className="flex justify-between gap-3 mb-1">
                      <p className="font-semibold text-[13px]">{m.subject}</p>
                      <span className="text-[11px] text-muted shrink-0">{format(new Date(m.created_at), 'd MMM')}</span>
                    </div>
                    <p className="text-[12px] text-muted">{m.message}</p>
                    {m.reply_text && (
                      <div className="mt-3 pt-3 border-t border-hairline">
                        <p className="text-[11px] font-bold text-forest mb-1">Admin replied</p>
                        <p className="text-[12px]">{m.reply_text}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
