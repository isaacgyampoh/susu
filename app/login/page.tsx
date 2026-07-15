'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, setMemberToken } from '@/lib/supabase'
import { Loader2, Eye, EyeOff } from 'lucide-react'

export default function MemberLogin() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [pc, setPc]       = useState('')
  const [show, setShow]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')

  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const { data, error } = await callFunction<any>('auth-member-login', { method: 'POST', body: { phone, passcode: pc } })
    setBusy(false)
    if (error) { setErr(error); return }
    setMemberToken(data.token)
    localStorage.setItem('member_user', JSON.stringify(data.member))
    router.push('/member/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col justify-center max-w-[380px] mx-auto px-6">
      <p className="t-label mb-3">Susu</p>
      <h1 className="t-display mb-9">Open your card</h1>

      <form onSubmit={go} className="space-y-4">
        {err && <p className="text-[13px] text-alert font-medium">{err}</p>}
        <div>
          <label className="in-lbl">Phone number</label>
          <input className="in tnum" type="tel" required inputMode="tel" autoComplete="tel"
            value={phone} onChange={e => setPhone(e.target.value)} placeholder="024 000 0000" />
        </div>
        <div>
          <label className="in-lbl">Passcode</label>
          <div className="relative">
            <input className="in tnum pr-11 tracking-[.3em] font-semibold" maxLength={6} required inputMode="numeric"
              type={show ? 'text' : 'password'} value={pc}
              onChange={e => setPc(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide passcode' : 'Show passcode'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink transition-colors">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <button type="submit" disabled={busy} className="act-accent w-full !h-12">
          {busy ? <Loader2 size={16} className="animate-spin" /> : 'Sign in'}
        </button>
      </form>

      <div className="mt-8 space-y-2 text-center">
        <p className="t-meta">Lost your passcode? Ask your collector to reset it.</p>
        <Link href="/admin/login" className="t-meta hover:text-ink transition-colors inline-block">Collector sign in</Link>
      </div>
    </div>
  )
}
