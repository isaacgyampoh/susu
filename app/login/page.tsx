'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, setMemberToken } from '@/lib/supabase'
import { Loader2, ArrowRight, Eye, EyeOff, AlertTriangle } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [phone, setPhone]   = useState('')
  const [pc, setPc]         = useState('')
  const [show, setShow]     = useState(false)
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')

  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const { data, error } = await callFunction<any>('auth-member-login',
      { method: 'POST', body: { phone, passcode: pc } })
    setBusy(false)
    if (error) { setErr(error); return }
    setMemberToken(data.token)
    localStorage.setItem('member_user', JSON.stringify(data.member))
    router.push('/member/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col max-w-[430px] mx-auto px-[18px]">
      <div className="flex-1 flex flex-col justify-center py-12 animate-slide-up">
        <p className="stencil text-dim-field mb-3">Members</p>
        <h1 className="text-[40px] font-black tracking-[-.04em] leading-[.92] mb-9">
          Open<br /><span className="text-gold">your card.</span>
        </h1>

        <form onSubmit={go} className="space-y-4">
          {err && (
            <div className="flex items-start gap-2.5 bg-stamp/15 border border-stamp/30 rounded-[3px] p-3.5">
              <AlertTriangle size={15} className="text-stamp mt-0.5 shrink-0" />
              <p className="text-[13px] font-medium">{err}</p>
            </div>
          )}
          <div>
            <label className="field-lbl">Phone number</label>
            <input className="field-in tnum" type="tel" required inputMode="tel" autoComplete="tel"
              value={phone} onChange={e => setPhone(e.target.value)} placeholder="024 000 0000" />
          </div>
          <div>
            <label className="field-lbl">Passcode</label>
            <div className="relative">
              <input className="field-in tnum pr-12 tracking-[.3em] font-bold" maxLength={6} required inputMode="numeric"
                type={show ? 'text' : 'password'} value={pc}
                onChange={e => setPc(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide passcode' : 'Show passcode'}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-dim hover:text-ink transition-colors">
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
          <button type="submit" disabled={busy} className="btn-gold w-full !py-4 mt-2">
            {busy ? <Loader2 size={17} className="animate-spin" /> : <>Sign in <ArrowRight size={16} /></>}
          </button>
        </form>
      </div>
      <div className="pb-8 text-center space-y-2.5">
        <p className="text-[12px] font-medium text-dim-field">Lost your passcode? Ask your collector to reset it.</p>
        <Link href="/admin/login" className="text-[12px] font-bold text-dim-field/60 hover:text-card transition-colors inline-block">
          Collector sign in
        </Link>
      </div>
    </div>
  )
}
