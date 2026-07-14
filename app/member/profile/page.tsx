'use client'
import { useEffect, useState } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard, ContactMessage } from '@/types'
import { format } from 'date-fns'
import { Loader2, User, Phone, Mail, MapPin, CreditCard, Building2, Calendar, Shield, MessageCircle, Send, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react'

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-brand-green-light flex items-center justify-center shrink-0">
        <Icon size={15} className="text-brand-green" />
      </div>
      <div><p className="text-xs text-gray-400 font-medium">{label}</p><p className="text-gray-800 font-medium mt-0.5">{value}</p></div>
    </div>
  )
}

export default function ProfilePage() {
  const [data, setData]             = useState<MemberDashboard | null>(null)
  const [loading, setLoading]       = useState(true)
  const [showContact, setShowContact] = useState(false)
  const [subject, setSubject]       = useState('')
  const [message, setMessage]       = useState('')
  const [sending, setSending]       = useState(false)
  const [sentOk, setSentOk]         = useState(false)
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null)

  useEffect(() => {
    const token = getMemberToken()
    callFunction<MemberDashboard>('member-profile', { token: token! })
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
  }, [])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !message.trim()) return
    setSending(true)
    const token = getMemberToken()
    const { error } = await callFunction('contact-admin', {
      method: 'POST', body: { subject, message }, token: token!,
    })
    setSending(false)
    if (error) { alert(error); return }
    setSentOk(true)
    setSubject(''); setMessage('')
    setTimeout(() => setSentOk(false), 4000)
  }

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="animate-spin text-brand-green" size={32} /></div>
  if (!data)   return <div className="p-8 text-center text-gray-500">Could not load profile.</div>

  const { member, plans, payouts, myMessages } = data

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-12 animate-fade-in">

      {/* Header */}
      <div className="card p-6 mb-6 bg-gradient-to-r from-brand-green to-brand-green-mid text-white">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-brand-gold flex items-center justify-center">
            <span className="text-brand-green font-extrabold text-2xl">{member.full_name[0]}</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">{member.full_name}</h1>
            <p className="text-green-200 text-sm">{member.member_id}</p>
            <p className="text-green-200 text-sm">{member.phone}</p>
            <span className="inline-block mt-1 px-2.5 py-0.5 text-xs font-semibold bg-brand-gold text-brand-green rounded-full capitalize">{member.status}</span>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Personal info */}
        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><User size={17} className="text-brand-green" /> Personal Details</h2>
          <InfoRow icon={Phone}    label="Phone Number"  value={member.phone} />
          <InfoRow icon={Mail}     label="Email"         value={member.email} />
          <InfoRow icon={MapPin}   label="Address"       value={member.residential_address} />
          <InfoRow icon={Building2} label="Occupation"   value={member.occupation} />
          <InfoRow icon={Calendar} label="Member Since"  value={format(new Date(member.created_at), 'MMMM d, yyyy')} />
        </div>

        {/* Payment info */}
        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><CreditCard size={17} className="text-brand-green" /> Payout Details</h2>
          <InfoRow icon={Phone}     label="Mobile Money Number"   value={member.mobile_money_number} />
          <InfoRow icon={Building2} label="Mobile Money Provider" value={member.mobile_money_provider} />
          <InfoRow icon={Building2} label="Bank Name"             value={member.bank_name} />
          <InfoRow icon={CreditCard} label="Account Number"       value={member.bank_account_number} />
          <InfoRow icon={User}      label="Account Name"          value={member.bank_account_name} />
          <p className="text-xs text-gray-400 mt-3">To update your payout details, contact admin.</p>
        </div>
      </div>

      {/* Active plans + payout schedule */}
      {plans.length > 0 && (
        <div className="card p-5 mt-6">
          <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Shield size={17} className="text-brand-green" /> My Susu Plans & Payout Schedule</h2>
          <div className="space-y-3">
            {plans.map((m) => (
              <div key={m.id} className="p-4 bg-brand-green-light rounded-xl">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-brand-green">{m.susu_groups?.name}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Position #{m.payout_position} · GHS {m.susu_groups?.contribution_amount}/{m.susu_groups?.contribution_frequency}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">Joined {format(new Date(m.joined_at), 'MMM d, yyyy')}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {m.payout_date && (
                      <p className="text-xs text-gray-500">Payout date</p>
                    )}
                    {m.payout_date && (
                      <p className="font-semibold text-brand-green text-sm">{format(new Date(m.payout_date), 'MMM d, yyyy')}</p>
                    )}
                    {m.payout_amount && (
                      <p className="font-bold text-brand-gold">GHS {Number(m.payout_amount).toLocaleString()}</p>
                    )}
                    <span className={m.payout_received ? 'badge-green' : 'badge-blue'}>{m.payout_received ? 'Received ✓' : 'Upcoming'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payout history */}
      {payouts.filter(p => p.status === 'paid').length > 0 && (
        <div className="card p-5 mt-6">
          <h2 className="font-bold text-gray-800 mb-4">Cashout History</h2>
          <div className="space-y-2">
            {payouts.filter(p => p.status === 'paid').map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-emerald-50">
                <div>
                  <p className="text-sm font-medium text-gray-800">{p.susu_groups?.name}</p>
                  <p className="text-xs text-gray-400">Paid {p.paid_at ? format(new Date(p.paid_at), 'MMM d, yyyy') : '—'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-emerald-700">GHS {Number(p.total_amount).toLocaleString()}</span>
                  <CheckCircle size={16} className="text-emerald-500" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contact Admin */}
      <div className="card p-5 mt-6">
        <button
          onClick={() => setShowContact(!showContact)}
          className="w-full flex items-center justify-between font-bold text-gray-800"
        >
          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-brand-green" /> Contact Admin
          </div>
          {showContact ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {showContact && (
          <div className="mt-4 animate-slide-up">
            <p className="text-sm text-gray-500 mb-4">Have a question or need help? Send a message directly to the admin. We'll respond as soon as possible.</p>

            {sentOk && (
              <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm mb-4">
                <CheckCircle size={16} /> Message sent! Admin will respond shortly.
              </div>
            )}

            <form onSubmit={sendMessage} className="space-y-3">
              <div>
                <label className="label">Subject</label>
                <input className="input" required value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Question about my payout date" />
              </div>
              <div>
                <label className="label">Message</label>
                <textarea className="input resize-none" required rows={3} value={message} onChange={e => setMessage(e.target.value)} placeholder="Write your message here…" />
              </div>
              <button type="submit" disabled={sending} className="btn-secondary flex items-center gap-2">
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Send Message
              </button>
            </form>

            {/* Previous messages */}
            {myMessages.length > 0 && (
              <div className="mt-5 border-t pt-5">
                <h3 className="font-semibold text-gray-700 text-sm mb-3">Your Previous Messages</h3>
                <div className="space-y-3">
                  {myMessages.map((msg: ContactMessage) => (
                    <div key={msg.id} className="p-3 bg-gray-50 rounded-xl">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-gray-800">{msg.subject}</p>
                        <span className="text-xs text-gray-400">{format(new Date(msg.created_at), 'MMM d')}</span>
                      </div>
                      <p className="text-xs text-gray-500">{msg.message}</p>
                      {msg.reply_text && (
                        <div className="mt-2 p-2 bg-brand-green-light rounded-lg">
                          <p className="text-xs font-semibold text-brand-green">Admin reply:</p>
                          <p className="text-xs text-gray-700 mt-0.5">{msg.reply_text}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
