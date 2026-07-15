'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, setAdminToken } from '@/lib/supabase'
import { Loader2, ChevronLeft, Eye, EyeOff, AlertCircle } from 'lucide-react'

export default function AdminLogin() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [pw, setPw]       = useState('')
  const [show, setShow]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')

  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const { data, error } = await callFunction<any>('auth-admin-login',
      { method: 'POST', body: { email, password: pw } })
    setBusy(false)
    if (error) { setErr(error); return }
    setAdminToken(data.token)
    localStorage.setItem('admin_user', JSON.stringify(data.admin))
    router.push('/admin')
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
        <h1 className="t-h1">Collector Sign In</h1>
        <p className="t-meta mt-2">Manage members, groups and payouts.</p>
      </div>

      <form onSubmit={go} className="space-y-4 animate-slide-up">
        {err && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red/20 rounded-[12px] p-3.5">
            <AlertCircle size={16} className="text-red mt-0.5 shrink-0" />
            <p className="text-[13px] text-red font-medium">{err}</p>
          </div>
        )}
        <div>
          <label className="in-lbl">Email</label>
          <input className="in" type="email" required autoComplete="email"
            value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <label className="in-lbl">Password</label>
          <div className="relative">
            <input className="in pr-12" type={show ? 'text' : 'password'} required autoComplete="current-password"
              value={pw} onChange={e => setPw(e.target.value)} placeholder="Enter password" />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink transition-colors">
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>
        <button type="submit" disabled={busy} className="act-primary w-full !mt-6">
          {busy ? <Loader2 size={17} className="animate-spin" /> : 'Log In'}
        </button>
      </form>

      <div className="flex items-center gap-3 my-7">
        <span className="flex-1 h-px bg-line" />
        <span className="t-meta">OR</span>
        <span className="flex-1 h-px bg-line" />
      </div>
      <Link href="/login" className="act-quiet w-full">Member sign in</Link>
    </div>
  )
}
