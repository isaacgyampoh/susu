'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, setMemberToken } from '@/lib/supabase'

/**
 * Member sign-in. Reachable only via the private link an admin shares — this
 * page is never linked from the console.
 */
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

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 py-12 bg-bg">
      <div className="w-full max-w-[340px] mx-auto animate-fade-in">
        <p className="text-[15px] font-semibold tracking-[-.02em] mb-8">Susu</p>
        <h1 className="t-title">Your account</h1>
        <p className="t-meta mt-1.5 mb-8">Sign in with the phone number and passcode your admin gave you.</p>

        <form onSubmit={submit} className="space-y-4">
          {err && <p className="text-[12.5px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2.5">{err}</p>}

          <div>
            <label htmlFor="phone" className="in-lbl">Phone number</label>
            <input id="phone" className="in tnum" type="tel" required inputMode="tel" autoComplete="tel"
              value={phone} onChange={e => setPhone(e.target.value)} placeholder="024 000 0000" />
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label htmlFor="pc" className="text-[12.5px] font-medium text-ink-2">Passcode</label>
              <button type="button" onClick={() => setShow(!show)}
                className="text-[12px] font-medium text-ink-3 hover:text-ink transition-colors">
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
            <input id="pc" className="in tnum" type={show ? 'text' : 'password'} required inputMode="numeric" maxLength={6}
              value={pc} onChange={e => setPc(e.target.value.replace(/\D/g, ''))} placeholder="6 digits" />
          </div>

          <button type="submit" disabled={busy} className="btn-dark btn-lg w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-[12px] text-ink-3 mt-8">Lost your passcode? Ask your susu admin to reset it.</p>
      </div>
    </div>
  )
}
