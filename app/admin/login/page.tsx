'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, setAdminToken } from '@/lib/supabase'
import { Loader2 } from 'lucide-react'

export default function AdminLogin() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [pw, setPw]       = useState('')
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')

  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const { data, error } = await callFunction<any>('auth-admin-login', { method: 'POST', body: { email, password: pw } })
    setBusy(false)
    if (error) { setErr(error); return }
    setAdminToken(data.token)
    localStorage.setItem('admin_user', JSON.stringify(data.admin))
    router.push('/admin')
  }

  return (
    <div className="min-h-screen flex flex-col justify-center max-w-[380px] mx-auto px-6">
      <p className="t-label mb-3">Susu — Console</p>
      <h1 className="t-display mb-9">Sign in</h1>

      <form onSubmit={go} className="space-y-4">
        {err && <p className="text-[13px] text-alert font-medium">{err}</p>}
        <div>
          <label className="in-lbl">Email</label>
          <input className="in" type="email" required autoComplete="email"
            value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="in-lbl">Password</label>
          <input className="in" type="password" required autoComplete="current-password"
            value={pw} onChange={e => setPw(e.target.value)} />
        </div>
        <button type="submit" disabled={busy} className="act-primary w-full !h-12">
          {busy ? <Loader2 size={16} className="animate-spin" /> : 'Sign in'}
        </button>
      </form>

      <Link href="/login" className="t-meta hover:text-ink transition-colors mt-8 text-center">
        Member sign in
      </Link>
    </div>
  )
}
