'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, setMemberToken } from '@/lib/supabase'

/**
 * MEMBER SIGN-IN.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Same product family as the administrator sign-in, different hierarchy: an
 * administrator is opening an operations console, a member is opening their
 * own account. So the brand field is smaller here and the form starts higher —
 * a member came to do one thing, and it should be the first thing on screen.
 *
 * The cover photograph and its gradient are gone. A stock image behind a login
 * is what a website does when it has nothing specific to say; the rotation the
 * susu actually is says something, and it costs a few hundred bytes of SVG
 * rather than a photograph on a Ghanaian mobile connection.
 *
 * ── AUTHENTICATION IS UNCHANGED ─────────────────────────────────────────
 *
 * Phone plus the member's own passcode, posted to `auth-member-login`, which
 * rate limits and records the attempt exactly as before. Nothing about the
 * credential model moved; only its presentation.
 */
export default function MemberSignIn() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [pc, setPc]       = useState('')
  const [show, setShow]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')

  // The installed app launches at "/", which lands here. A member with a live
  // session should go straight to their card — being asked to sign in on every
  // launch is what makes an installed PWA feel like a bookmark.
  useEffect(() => {
    if (localStorage.getItem('member_token')) router.replace('/m/portal/dashboard')
  }, [router])

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

  const field = `w-full h-[52px] px-3.5 rounded-xl text-base bg-surface-2 border border-line
                 text-ink placeholder:text-ink-3 outline-none
                 transition-[border-color,background-color,box-shadow] duration-150
                 focus:border-ink focus:bg-surface focus:ring-[3px] focus:ring-ink/[0.08]`

  return (
    <main className="min-h-[100dvh] grid grid-rows-[auto_1fr]
                     sm:grid-rows-1 sm:grid-cols-[1fr_minmax(400px,.8fr)] bg-[#0C0E12]">

      {/* ══ Brand field ════════════════════════════════════════════════════
          A band on the phone, a column from `sm` up. Shorter than the admin
          screen's: a member is here to sign in, not to be introduced. */}
      <section className="member-dark relative flex flex-col justify-between overflow-hidden
                          bg-[#0C0E12] text-white px-6 sm:px-10
                          pt-[max(1.75rem,calc(env(safe-area-inset-top)+1rem))]
                          pb-7 sm:pb-10 min-h-[26dvh] sm:min-h-0">

        <div aria-hidden="true"
          className="pointer-events-none absolute -right-[26%] -bottom-[62%] w-[min(380px,80%)]
                     sm:-right-[18%] sm:-bottom-[24%] sm:w-[min(560px,80%)] aspect-square opacity-[0.45]">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <circle cx="100" cy="100" r="74" fill="none" stroke="rgb(255 255 255/.10)" strokeWidth="1" />
            <circle cx="100" cy="100" r="52" fill="none" stroke="rgb(255 255 255/.05)" strokeWidth="1" />
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i / 12) * Math.PI * 2 - Math.PI / 2
              const x = 100 + Math.cos(a) * 74, y = 100 + Math.sin(a) * 74
              const settled = i < 7, current = i === 7
              return (
                <circle key={i} cx={x} cy={y} r={current ? 7 : 5.5}
                  fill={current ? '#A7DCC4' : settled ? 'rgb(255 255 255/.92)' : 'transparent'}
                  stroke={current || settled ? 'none' : 'rgb(255 255 255/.30)'} strokeWidth="1.25" />
              )
            })}
          </svg>
        </div>

        <span className="relative font-display text-md font-semibold tracking-[-.01em]">
          Abbie Wealth
        </span>

        <div className="relative mt-7 sm:mt-0 max-w-[420px]">
          <h1 className="font-display font-semibold tracking-[-.03em] text-balance
                         text-[clamp(24px,6.4vw,30px)] leading-[1.1]
                         sm:text-[clamp(30px,3vw,40px)]">
            Your susu, in your pocket.
          </h1>
          <p className="hidden sm:block mt-4 text-md text-white/55 leading-relaxed">
            What you have paid, what is due next, and when your turn to collect
            comes round.
          </p>
        </div>

        <span className="relative hidden sm:block text-xs text-white/35">Member account</span>
      </section>

      {/* ══ Sign-in surface ════════════════════════════════════════════════ */}
      <section className="relative flex flex-col min-w-0 bg-surface
                          sm:border-l sm:border-line rounded-t-2xl sm:rounded-none -mt-4 sm:mt-0
                          px-6 sm:px-10 pt-8 sm:pt-0
                          pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-[380px] sm:my-auto">
          <span className="block w-8 h-[3px] rounded-full bg-accent mb-5" />

          <h2 className="font-display text-2xl font-semibold text-ink tracking-[-.022em]">
            Sign in
          </h2>
          <p className="text-sm text-ink-2 mt-2">
            Your phone number and the passcode your susu admin sent you.
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            {err && (
              <p role="alert"
                className="text-sm text-danger bg-danger-soft border border-danger-line
                           rounded-[10px] px-3 py-2.5">{err}</p>
            )}

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-ink-2 mb-1.5">
                Phone number
              </label>
              <input id="phone" className={`${field} tnum`} type="tel" required
                inputMode="tel" autoComplete="tel" value={phone}
                onChange={e => setPhone(e.target.value)} placeholder="024 000 0000" />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label htmlFor="pc" className="text-sm font-medium text-ink-2">Passcode</label>
                <button type="button" onClick={() => setShow(!show)}
                  className="text-xs font-medium text-ink-3 hover:text-ink transition-colors
                             h-6 px-1 -mr-1 rounded focus-visible:outline-none
                             focus-visible:ring-2 focus-visible:ring-ink/30">
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
              <input id="pc" className={`${field} tnum`} type={show ? 'text' : 'password'} required
                inputMode="numeric" maxLength={6} autoComplete="current-password" value={pc}
                onChange={e => setPc(e.target.value.replace(/\D/g, ''))} placeholder="6 digits" />
            </div>

            <button type="submit" disabled={busy}
              className="w-full h-[52px] rounded-xl text-base font-medium bg-ink text-inverse
                         transition-colors hover:bg-ink/90 active:scale-[.995]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30
                         disabled:opacity-40 disabled:pointer-events-none">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-2xs text-ink-3 leading-relaxed mt-auto pt-8 max-w-[380px]">
          Don&rsquo;t have a passcode? Ask your susu admin — they can send you a new one.
        </p>
      </section>

      <style jsx global>{`
        .member-dark::after {
          content: ''; position: absolute; inset: 0; pointer-events: none;
          opacity: .035; mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }
      `}</style>
    </main>
  )
}
