'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, setAdminToken } from '@/lib/supabase'

/**
 * The root of this deployment IS the admin sign-in.
 *
 * This application is the management console — nothing else lives here. Member
 * sign-in is deliberately not linked or reachable from this site: each member
 * receives their own portal link when the admin creates their account. Two
 * doors on one building is an attack surface, not a convenience.
 */
export default function AdminSignIn() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [pw, setPw]       = useState('')
  const [show, setShow]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const { data, error } = await callFunction<any>('auth-admin-login', {
      method: 'POST', body: { email, password: pw },
    })
    setBusy(false)
    if (error) { setErr(error); return }
    setAdminToken(data.token)
    localStorage.setItem('admin_user', JSON.stringify(data.admin))
    router.push('/admin')
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_460px]">
      {/* Left: photograph. Hands and cash — the actual subject of the product,
          not an abstraction of it. Dark scrim so white type stays legible. */}
      <div className="hidden lg:flex relative flex-col justify-between p-12 overflow-hidden bg-ink">
        <img
          src="/cover.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/70 to-ink/35" aria-hidden="true" />

        <span className="relative text-[15px] font-semibold tracking-[-.02em] text-white">Susu</span>

        <div className="relative">
          <h1 className="text-[36px] font-semibold tracking-[-.03em] leading-[1.08] text-white max-w-[420px]">
            Run your susu with a proper ledger.
          </h1>
          <p className="text-[13.5px] text-white/70 mt-4 max-w-[380px] leading-relaxed">
            Members, groups, contributions and payouts — recorded, reconciled and
            auditable. Contributions close at 6:00 PM. Late payments are flagged
            automatically.
          </p>
        </div>

        <p className="relative text-[12px] text-white/50">Administrator access only.</p>
      </div>

      {/* Right: the form */}
      <div className="flex flex-col justify-center px-6 sm:px-10 py-12 bg-bg">
        <div className="w-full max-w-[340px] mx-auto animate-fade-in">
          <p className="lg:hidden text-[15px] font-semibold tracking-[-.02em] mb-8">Susu</p>

          <h2 className="t-title">Sign in</h2>
          <p className="t-meta mt-1.5 mb-8">Administrator access to the management console.</p>

          <form onSubmit={submit} className="space-y-4">
            {err && (
              <p className="text-[12.5px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2.5">{err}</p>
            )}

            <div>
              <label htmlFor="email" className="in-lbl">Email</label>
              <input id="email" className="in" type="email" required autoComplete="email"
                value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label htmlFor="pw" className="text-[12.5px] font-medium text-ink-2">Password</label>
                <button type="button" onClick={() => setShow(!show)}
                  className="text-[12px] font-medium text-ink-3 hover:text-ink transition-colors">
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
              <input id="pw" className="in" type={show ? 'text' : 'password'} required autoComplete="current-password"
                value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••" />
            </div>

            <button type="submit" disabled={busy} className="btn-dark btn-lg w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-[12px] text-ink-3 mt-8 leading-relaxed">
            Members do not sign in here. Each member receives a private portal
            link when their account is created.
          </p>
        </div>
      </div>
    </div>
  )
}
