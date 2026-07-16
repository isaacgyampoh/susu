'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, setAdminToken } from '@/lib/supabase'

/**
 * The root of this deployment is the administrator sign-in. Nothing else lives
 * here — members reach their portal by private link only.
 */
export default function SignIn() {
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
    <div className="relative min-h-[100dvh] lg:grid lg:grid-cols-[1fr_480px]">

      {/* The engraving sits behind everything on mobile, and in the left panel
          on desktop. One image, two roles — no blank white phone screen. */}
      <div
        className="absolute inset-0 lg:relative lg:col-start-1 overflow-hidden bg-ink"
        aria-hidden="true"
      >
        <img src="/cover.jpg" alt="" className="w-full h-full object-cover" />
        {/* Scrim: heavier on mobile because the form sits on top of it */}
        <div className="absolute inset-0 bg-gradient-to-b from-ink/75 via-ink/85 to-ink lg:from-ink/30 lg:via-ink/55 lg:to-ink/95" />
      </div>

      {/* Desktop-only wordmark + line, placed over the image */}
      <div className="hidden lg:flex absolute inset-y-0 left-0 w-[calc(100%-480px)] flex-col justify-between p-12 pointer-events-none">
        <span className="text-[15px] font-semibold tracking-[-.02em] text-white">Susu</span>
        <h1 className="text-[38px] font-semibold tracking-[-.03em] leading-[1.06] text-white max-w-[440px]">
          Run your susu with a proper ledger.
        </h1>
        <span className="text-[12px] text-white/45">Administrator access</span>
      </div>

      {/* Form. On mobile it floats on the image; on desktop it's a solid panel. */}
      <div className="relative min-h-[100dvh] lg:min-h-0 lg:col-start-2 flex flex-col justify-center px-6 py-12 lg:bg-surface lg:border-l lg:border-line">
        <div className="w-full max-w-[340px] mx-auto">

          <p className="lg:hidden text-[15px] font-semibold tracking-[-.02em] text-white mb-10">Susu</p>

          <h2 className="text-[26px] font-semibold tracking-[-.02em] text-white lg:text-ink">Sign in</h2>
          <p className="text-[13px] text-white/55 lg:text-ink-2 mt-1.5 mb-8">Administrator access</p>

          <form onSubmit={submit} className="space-y-4">
            {err && (
              <p className="text-[12.5px] text-white bg-red/85 lg:bg-red/10 lg:text-red border border-red/40 rounded-lg px-3 py-2.5">
                {err}
              </p>
            )}

            <div>
              <label htmlFor="email" className="block text-[12.5px] font-medium text-white/70 lg:text-ink-2 mb-1.5">Email</label>
              <input id="email" type="email" required autoComplete="email"
                value={email} onChange={e => setEmail(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg text-[14px] transition-all
                           bg-white/10 border border-white/20 text-white placeholder-white/35
                           focus:outline-none focus:border-white/60 focus:bg-white/15
                           lg:bg-surface lg:border-line lg:text-ink lg:placeholder-ink-3
                           lg:focus:border-ink lg:focus:ring-2 lg:focus:ring-ink/10"
                placeholder="you@example.com" />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label htmlFor="pw" className="text-[12.5px] font-medium text-white/70 lg:text-ink-2">Password</label>
                <button type="button" onClick={() => setShow(!show)}
                  className="text-[12px] font-medium text-white/50 hover:text-white lg:text-ink-3 lg:hover:text-ink transition-colors">
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
              <input id="pw" type={show ? 'text' : 'password'} required autoComplete="current-password"
                value={pw} onChange={e => setPw(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg text-[14px] transition-all
                           bg-white/10 border border-white/20 text-white placeholder-white/35
                           focus:outline-none focus:border-white/60 focus:bg-white/15
                           lg:bg-surface lg:border-line lg:text-ink lg:placeholder-ink-3
                           lg:focus:border-ink lg:focus:ring-2 lg:focus:ring-ink/10"
                placeholder="••••••••" />
            </div>

            <button type="submit" disabled={busy}
              className="w-full h-12 rounded-lg text-[14px] font-medium transition-colors
                         bg-white text-ink hover:bg-white/90
                         lg:bg-ink lg:text-white lg:hover:bg-ink/90
                         disabled:opacity-40 disabled:pointer-events-none">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
