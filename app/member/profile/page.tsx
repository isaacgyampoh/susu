'use client'
import { useEffect, useState } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard } from '@/types'
import { format } from 'date-fns'
const n2 = (v: any) => Number(v ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n0 = (v: any) => Number(v ?? 0).toLocaleString('en-GH', { maximumFractionDigits: 0 })

function Row({ k, v }: { k: string; v?: string | null }) {
  if (!v) return null
  return (
    <tr>
      <td className="py-3 pr-4 t-meta whitespace-nowrap align-top">{k}</td>
      <td className="py-3 text-[13.5px] font-medium text-right">{v}</td>
    </tr>
  )
}

export default function Profile() {
  const [d, setD]         = useState<MemberDashboard | null>(null)
  const [loading, setL]   = useState(true)
  const [open, setOpen]   = useState(false)
  const [subj, setSubj]   = useState('')
  const [msg, setMsg]     = useState('')
  const [busy, setBusy]   = useState(false)
  const [sent, setSent]   = useState(false)

  async function load() {
    const { data } = await callFunction<MemberDashboard>('member-profile', { token: getMemberToken()! })
    setD(data); setL(false)
  }
  useEffect(() => { load() }, [])

  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const { error } = await callFunction('contact-admin', { method: 'POST', body: { subject: subj, message: msg }, token: getMemberToken()! })
    setBusy(false)
    if (error) return alert(error)
    setSent(true); setSubj(''); setMsg(''); load()
    setTimeout(() => setSent(false), 5000)
  }

  if (loading) return <div className="grid place-items-center h-[60vh]">'…'</div>
  if (!d)      return <div className="p-10 text-center t-meta">Could not load your profile.</div>

  const { member, plans, payouts, myMessages } = d

  return (
    <div className="max-w-[440px] mx-auto px-5 py-7 pb-16 animate-fade-in">
      <p className="t-label">{member.member_id}</p>
      <h1 className="t-h1 mt-1.5">{member.full_name}</h1>
      <p className="t-meta mt-2">{member.phone} — <span className="pill-on">{member.status}</span></p>

      {plans.length > 0 && (
        <section className="py-8 border-t border-line mt-7">
          <h2 className="t-label !text-ink mb-4">Your plans</h2>
          <div className="divide-y divide-line border-y border-line">
            {plans.map(p => {
              const g = p.susu_groups!
              const cashout = Number(p.payout_amount ?? g.cashout_amount ?? 0) + Number(g.registration_fee ?? 0)
              return (
                <div key={p.id} className="py-4 flex items-baseline justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold truncate">{g.name}</p>
                    <p className="t-meta">
                      Slot {p.payout_position} of {g.max_members} — GHS {n0(g.contribution_amount)} {g.contribution_frequency}
                    </p>
                    {p.payout_date && <p className="t-meta">Collects {format(new Date(p.payout_date), 'd MMM yyyy')}</p>}
                  </div>
                  <p className="text-[16px] font-extrabold tnum whitespace-nowrap">{n0(cashout)}</p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {payouts.filter(p => p.status === 'paid').length > 0 && (
        <section className="py-8 border-t border-line">
          <h2 className="t-label !text-ink mb-4">Collected</h2>
          <table className="w-full">
            <tbody className="divide-y divide-line border-y border-line">
              {payouts.filter(p => p.status === 'paid').map(p => (
                <tr key={p.id}>
                  <td className="py-3 pr-3 text-[13.5px] font-medium">{p.susu_groups?.name}</td>
                  <td className="py-3 pr-3 t-meta">{p.paid_at ? format(new Date(p.paid_at), 'd MMM yyyy') : ''}</td>
                  <td className="py-3 text-right text-[14px] font-bold tnum">{n0(p.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="py-8 border-t border-line">
        <h2 className="t-label !text-ink mb-3">Your details</h2>
        <table className="w-full">
          <tbody className="divide-y divide-line border-y border-line">
            <Row k="Phone"        v={member.phone} />
            <Row k="Email"        v={member.email} />
            <Row k="MoMo"         v={member.mobile_money_number ? `${member.mobile_money_provider ?? ''} ${member.mobile_money_number}`.trim() : null} />
            <Row k="Occupation"   v={member.occupation} />
            <Row k="Address"      v={member.residential_address} />
            <Row k="Member since" v={format(new Date(member.created_at), 'd MMMM yyyy')} />
          </tbody>
        </table>
        <p className="t-meta mt-3">To change anything, message your collector below.</p>
      </section>

      <section className="py-8 border-t border-line">
        <button onClick={() => setOpen(!open)} className="w-full flex items-baseline justify-between group">
          <div className="text-left">
            <p className="text-[15px] font-bold group-hover:underline underline-offset-4">Message your collector</p>
            <p className="t-meta mt-0.5">Questions about your plan or collection</p>
          </div>
          <span className="t-label">{open ? 'Close' : 'Open'}</span>
        </button>

        {open && (
          <div className="mt-5 animate-fade-in">
            {sent && <p className="text-[13px] font-medium mb-4">Sent. Your collector will reply here.</p>}
            <form onSubmit={send} className="space-y-3">
              <input className="in" required value={subj} onChange={e => setSubj(e.target.value)} placeholder="Subject" />
              <textarea className="in-area" required rows={3} value={msg} onChange={e => setMsg(e.target.value)} placeholder="Your message" />
              <button type="submit" disabled={busy} className="act-primary w-full">
                {busy ? '…' : 'Send'}
              </button>
            </form>

            {myMessages.length > 0 && (
              <div className="mt-7 divide-y divide-line border-t border-line">
                {myMessages.map(m => (
                  <div key={m.id} className="py-4">
                    <div className="flex justify-between gap-3">
                      <p className="text-[13px] font-bold">{m.subject}</p>
                      <span className="t-meta whitespace-nowrap">{format(new Date(m.created_at), 'd MMM')}</span>
                    </div>
                    <p className="t-meta mt-1">{m.message}</p>
                    {m.reply_text && (
                      <div className="mt-3 pl-3 border-l-2 border-blue">
                        <p className="t-label !text-ink">Reply</p>
                        <p className="text-[13px] mt-1">{m.reply_text}</p>
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
