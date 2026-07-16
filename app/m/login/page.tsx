'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, setMemberToken } from '@/lib/supabase'

/** Member sign-in. Reached only by the private link an admin shares. */
export default function MemberSignIn() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [pc, setPc]       = useState('')
  const [show, setShow]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const { data, error } = await callFunction<any>('auth-member-login', {
      method: 'POST', body: { phone, passcode: pc },
    })
    setBusy(false)
    if (error) { setErr(error); return }
    setMemberToken(data.token)
    localStorage.setItem('member_user', JSON.stringify(data.member))
    router.push('/m/portal/dashboard')
  }

  const field = `w-full h-11 px-3.5 rounded-lg text-[14px] transition-all
                 bg-white/10 border border-white/20 text-white placeholder-white/35
                 focus:outline-none focus:border-white/60 focus:bg-white/15`

  return (
    <div className="relative h-[100dvh] overflow-hidden flex flex-col justify-center px-6 py-10">
      <div className="absolute inset-0 overflow-hidden bg-ink" aria-hidden="true">
        <picture>
          <source srcSet="/cover.webp" type="image/webp" />
          <img src="/cover.jpg" alt="" fetchPriority="high" decoding="async"
            className="absolute inset-0 w-full h-full object-cover" />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-b from-ink/25 via-ink/55 to-ink/80" />
      </div>

      <div className="relative w-full max-w-[360px] mx-auto overflow-y-auto">
        <p className="text-[15px] font-semibold tracking-[-.02em] text-white mb-10">Abbie Wealth</p>
        <h1 className="text-[26px] font-semibold tracking-[-.02em] text-white">Your account</h1>
        <p className="text-[13px] text-white/55 mt-1.5 mb-8">Sign in with your phone and passcode</p>

        <form onSubmit={submit} className="space-y-4">
          {err && <p className="text-[12.5px] text-white bg-red/85 border border-red/40 rounded-lg px-3 py-2.5">{err}</p>}

          <div>
            <label htmlFor="phone" className="block text-[12.5px] font-medium text-white/70 mb-1.5">Phone number</label>
            <input id="phone" className={`${field} tnum`} type="tel" required inputMode="tel" autoComplete="tel"
              value={phone} onChange={e => setPhone(e.target.value)} placeholder="024 000 0000" />
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label htmlFor="pc" className="text-[12.5px] font-medium text-white/70">Passcode</label>
              <button type="button" onClick={() => setShow(!show)}
                className="text-[12px] font-medium text-white/50 hover:text-white transition-colors">
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
            <input id="pc" className={`${field} tnum`} type={show ? 'text' : 'password'} required
              inputMode="numeric" maxLength={6} value={pc}
              onChange={e => setPc(e.target.value.replace(/\D/g, ''))} placeholder="6 digits" />
          </div>

          <button type="submit" disabled={busy}
            className="w-full h-12 rounded-lg text-[14px] font-medium bg-white text-ink hover:bg-white/90 transition-colors disabled:opacity-40 disabled:pointer-events-none">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
