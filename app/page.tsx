'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, setAdminToken } from '@/lib/supabase'

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

  const field = `w-full h-12 px-4 rounded-xl text-[15px] transition-all
                 bg-white/[0.07] border border-white/15 text-white placeholder-white/30
                 focus:outline-none focus:border-white/50 focus:bg-white/[0.12]
                 lg:h-11 lg:text-[14px] lg:bg-surface lg:border-line lg:text-ink lg:placeholder-ink-3
                 lg:focus:border-ink lg:focus:ring-2 lg:focus:ring-ink/10`

  return (
    // h-[100dvh] + overflow-hidden: this screen is exactly one viewport, never more
    <div className="relative h-[100dvh] overflow-hidden lg:grid lg:grid-cols-[1fr_460px]">

      {/* The image is positioned, not flowed — so it can never dictate page height.
          That was the scroll bug: h-full had no definite parent to resolve against,
          so the img rendered at its natural 1600x2200 aspect. */}
      <div className="absolute inset-0 lg:relative lg:col-start-1 lg:inset-auto overflow-hidden bg-ink" aria-hidden="true">
        <picture>
          <source srcSet="/cover.webp" type="image/webp" />
          <img src="/cover.jpg" alt="" fetchPriority="high" decoding="async"
            className="absolute inset-0 w-full h-full object-cover" />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-b from-ink/25 via-ink/55 to-ink/80
                        lg:bg-gradient-to-tr lg:from-ink/95 lg:via-ink/55 lg:to-ink/10" />
      </div>

      {/* Desktop wordmark + line */}
      <div className="hidden lg:flex absolute inset-y-0 left-0 w-[calc(100%-460px)] flex-col justify-between p-12 pointer-events-none z-10">
        <span className="text-[15px] font-semibold tracking-[-.02em] text-white">Susu</span>
        <h1 className="text-[38px] font-semibold tracking-[-.03em] leading-[1.06] text-white max-w-[440px]">
          Run your susu with a proper ledger.
        </h1>
        <span className="text-[12px] text-white/40">Administrator access</span>
      </div>

      {/* Form column — scrolls internally if a small phone in landscape needs it */}
      <div className="relative h-full lg:col-start-2 flex flex-col justify-center overflow-y-auto
                      px-6 py-10 lg:bg-surface lg:border-l lg:border-line">
        <div className="w-full max-w-[360px] mx-auto">

          <p className="lg:hidden text-[16px] font-semibold tracking-[-.02em] text-white mb-8">Susu</p>

          <h2 className="text-[28px] lg:text-[26px] font-semibold tracking-[-.02em] text-white lg:text-ink">Sign in</h2>
          <p className="text-[13px] text-white/50 lg:text-ink-2 mt-1.5 mb-7">Administrator access</p>

          <form onSubmit={submit} className="space-y-4">
            {err && (
              <p className="text-[12.5px] text-white bg-red/80 lg:bg-red/10 lg:text-red border border-red/40 rounded-xl px-3.5 py-3">
                {err}
              </p>
            )}

            <div>
              <label htmlFor="email" className="block text-[13px] font-medium text-white/70 lg:text-ink-2 mb-2">Email</label>
              <input id="email" type="email" required autoComplete="email" className={field}
                value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-2">
                <label htmlFor="pw" className="text-[13px] font-medium text-white/70 lg:text-ink-2">Password</label>
                <button type="button" onClick={() => setShow(!show)}
                  className="text-[12.5px] font-medium text-white/45 hover:text-white lg:text-ink-3 lg:hover:text-ink transition-colors">
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
              <input id="pw" type={show ? 'text' : 'password'} required autoComplete="current-password" className={field}
                value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••" />
            </div>

            <button type="submit" disabled={busy}
              className="w-full h-12 rounded-xl text-[15px] font-medium transition-colors
                         bg-white text-ink hover:bg-white/90 active:scale-[.99]
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
