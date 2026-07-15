'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, setMemberToken } from '@/lib/supabase'
import { Loader2, Eye, EyeOff, ChevronLeft, AlertCircle } from 'lucide-react'

export default function MemberLogin() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [pc, setPc]       = useState('')
  const [show, setShow]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')

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
    <div className="min-h-screen max-w-[420px] mx-auto px-5 pb-10">
      <div className="pt-5">
        <Link href="/" aria-label="Back"
          className="w-10 h-10 rounded-full bg-green-50 grid place-items-center text-green hover:bg-line transition-colors">
          <ChevronLeft size={19} />
        </Link>
      </div>

      <div className="text-center mt-8 mb-7">
        <h1 className="t-h1">Sign In</h1>
        <p className="t-meta mt-2 max-w-[280px] mx-auto leading-relaxed">
          Log in to see your plan, pay your contributions and track your collection date.
        </p>
      </div>

      <form onSubmit={go} className="space-y-4 animate-slide-up">
        {err && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red/20 rounded-[12px] p-3.5">
            <AlertCircle size={16} className="text-red mt-0.5 shrink-0" />
            <p className="text-[13px] text-red font-medium">{err}</p>
          </div>
        )}

        <div>
          <label className="in-lbl">Phone Number</label>
          <input className="in tnum" type="tel" required inputMode="tel" autoComplete="tel"
            value={phone} onChange={e => setPhone(e.target.value)} placeholder="024 000 0000" />
        </div>

        <div>
          <label className="in-lbl">Passcode</label>
          <div className="relative">
            <input className={`in tnum pr-12 font-semibold ${pc ? 'tracking-[.3em]' : ''}`} maxLength={6} required inputMode="numeric"
              type={show ? 'text' : 'password'} value={pc}
              onChange={e => setPc(e.target.value.replace(/\D/g, ''))} placeholder="Enter passcode" />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide passcode' : 'Show passcode'}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink transition-colors">
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>

        <button type="submit" disabled={busy} className="act-primary w-full !mt-6">
          {busy ? <Loader2 size={17} className="animate-spin" /> : 'Log In'}
        </button>
      </form>

      <p className="text-center t-meta mt-7">
        Lost your passcode? <span className="font-semibold text-ink">Ask your collector to reset it.</span>
      </p>

      <div className="flex items-center gap-3 my-7">
        <span className="flex-1 h-px bg-line" />
        <span className="t-meta">OR</span>
        <span className="flex-1 h-px bg-line" />
      </div>

      <Link href="/admin/login" className="act-quiet w-full">Collector sign in</Link>
    </div>
  )
}
