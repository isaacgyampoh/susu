'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, setMemberToken } from '@/lib/supabase'
import { Loader2, ArrowRight, Eye, EyeOff, AlertCircle } from 'lucide-react'

export default function MemberLoginPage() {
  const router = useRouter()
  const [phone, setPhone]       = useState('')
  const [passcode, setPasscode] = useState('')
  const [show, setShow]         = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const { data, error: err } = await callFunction<{ token: string; member: any }>(
      'auth-member-login', { method: 'POST', body: { phone, passcode } }
    )
    setLoading(false)
    if (err) { setError(err); return }
    setMemberToken(data!.token)
    localStorage.setItem('member_user', JSON.stringify(data!.member))
    router.push('/member/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col px-5 max-w-lg mx-auto">
      <div className="flex-1 flex flex-col justify-center py-12 animate-slide-up">
        <div className="w-12 h-12 rounded-2xl bg-forest grid place-items-center mb-8">
          <span className="text-gold font-extrabold text-xl">S</span>
        </div>

        <h1 className="display text-[40px] mb-3">
          Welcome
          <br />
          <span className="text-forest">back</span>
        </h1>
        <p className="text-muted text-[15px] mb-9">Sign in with the phone number and passcode your admin gave you.</p>

        <form onSubmit={signIn} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2.5 p-4 bg-red-50 border border-red-200 rounded-2xl">
              <AlertCircle size={16} className="text-red-600 mt-0.5 shrink-0" />
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          <div>
            <label className="field-label">Phone number</label>
            <input className="field tnum" type="tel" required autoComplete="tel" inputMode="tel"
              value={phone} onChange={e => setPhone(e.target.value)} placeholder="024 000 0000" />
          </div>

          <div>
            <label className="field-label">Passcode</label>
            <div className="relative">
              <input className="field tnum pr-14 tracking-[0.3em] font-semibold"
                type={show ? 'text' : 'password'} required maxLength={6} inputMode="numeric"
                value={passcode} onChange={e => setPasscode(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••" />
              <button type="button" onClick={() => setShow(!show)}
                aria-label={show ? 'Hide passcode' : 'Show passcode'}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors">
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className="pill-ink w-full !py-4 text-[15px] mt-2">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <>Sign in <ArrowRight size={17} /></>}
          </button>
        </form>
      </div>

      <div className="pb-8 text-center space-y-3">
        <p className="text-[13px] text-muted">Lost your passcode? Ask your Susu admin to reset it.</p>
        <Link href="/admin/login" className="text-[13px] text-muted/70 hover:text-ink transition-colors inline-block">
          Admin sign in
        </Link>
      </div>
    </div>
  )
}
