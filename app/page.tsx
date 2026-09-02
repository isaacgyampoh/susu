'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, setAdminToken } from '@/lib/supabase'

/**
 * ADMINISTRATOR SIGN-IN — four digits, nothing else.
 *
 * There is no email field and no password field, because there is no longer an
 * email or a password: the server authenticates the PIN alone. Adding an
 * identifier box back here would not just be dead UI, it would be a lie about
 * what the credential is.
 *
 * The PIN lives in component state for the length of one submit and goes
 * nowhere else — not localStorage, not the URL, not a form that a browser would
 * offer to save. What persists after a successful sign-in is the token the
 * server issues, which is the same thing the email login used to leave behind.
 *
 * Entry is a keypad rather than a text input for two reasons. On a phone — how
 * this console is mostly used — a keypad is the correct control and does not
 * depend on the OS surfacing a numeric keyboard. And a keypad has no value to
 * autofill, so no password manager offers to remember four digits that identify
 * the whole administration.
 *
 * A physical keyboard still works: the window-level handler below means a
 * desktop admin types 1-0-2-4 and never touches the mouse.
 */
export default function SignIn() {
  const router = useRouter()
  const [pin, setPin]   = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')
  const [shake, setShake] = useState(false)
  // Guards the auto-submit: without it, a re-render at four digits fires twice.
  const sending = useRef(false)

  useEffect(() => {
    if (localStorage.getItem('admin_token')) router.replace('/admin')
  }, [router])

  const submit = useCallback(async (value: string) => {
    if (sending.current) return
    sending.current = true
    setBusy(true); setErr('')

    const { data, error } = await callFunction<{ token: string; admin: unknown }>(
      'auth-admin-login', { method: 'POST', body: { pin: value } },
    )

    setBusy(false)
    sending.current = false

    if (error) {
      // Clear on failure. Leaving four wrong digits on screen invites the next
      // attempt to be a single-digit edit of a guess that already failed.
      setPin(''); setErr(error); setShake(true)
      setTimeout(() => setShake(false), 400)
      return
    }
    setAdminToken(data!.token)
    localStorage.setItem('admin_user', JSON.stringify(data!.admin))
    router.push('/admin')
  }, [router])

  const push = useCallback((digit: string) => {
    if (busy) return
    setErr('')
    setPin(prev => {
      if (prev.length >= 4) return prev
      const next = prev + digit
      if (next.length === 4) void submit(next)
      return next
    })
  }, [busy, submit])

  const back = useCallback(() => {
    if (busy) return
    setErr('')
    setPin(prev => prev.slice(0, -1))
  }, [busy])

  // Physical keyboard. Deliberately on the window: there is no text input to
  // focus, so there is nothing else for a keystroke to land on.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (/^\d$/.test(e.key))      { e.preventDefault(); push(e.key) }
      else if (e.key === 'Backspace') { e.preventDefault(); back() }
      else if (e.key === 'Escape')    { e.preventDefault(); setPin(''); setErr('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [push, back])

  const key = `h-[62px] rounded-2xl text-[24px] font-medium tabular-nums select-none
               transition-all active:scale-[.96]
               bg-white/[0.08] text-white border border-white/10
               hover:bg-white/[0.14] focus-visible:outline-none
               focus-visible:ring-2 focus-visible:ring-white/60
               lg:bg-surface lg:text-ink lg:border-line lg:hover:bg-ink/[0.05]
               lg:focus-visible:ring-ink/40
               disabled:opacity-40 disabled:pointer-events-none`

  return (
    <div className="relative h-[100dvh] overflow-hidden lg:grid lg:grid-cols-[1fr_460px]">

      <div className="absolute inset-0 lg:relative lg:col-start-1 lg:inset-auto overflow-hidden bg-ink" aria-hidden="true">
        <picture>
          <source srcSet="/cover.webp" type="image/webp" />
          <img src="/cover.jpg" alt="" fetchPriority="high" decoding="async"
            className="absolute inset-0 w-full h-full object-cover" />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-b from-ink/25 via-ink/55 to-ink/80
                        lg:bg-gradient-to-tr lg:from-ink/95 lg:via-ink/55 lg:to-ink/10" />
      </div>

      <div className="hidden lg:flex absolute inset-y-0 left-0 w-[calc(100%-460px)] flex-col justify-between p-12 pointer-events-none z-10">
        <span className="text-[15px] font-semibold tracking-[-.02em] text-white">Abbie Wealth</span>
        <h1 className="text-[38px] font-semibold tracking-[-.03em] leading-[1.06] text-white max-w-[440px]">
          Run your susu with a proper ledger.
        </h1>
        <span className="text-[12px] text-white/40">Administrator access</span>
      </div>

      <div className="relative h-full lg:col-start-2 flex flex-col justify-center overflow-y-auto
                      px-6 py-10 lg:bg-surface lg:border-l lg:border-line">
        <div className="w-full max-w-[320px] mx-auto">

          <p className="lg:hidden text-[16px] font-semibold tracking-[-.02em] text-white mb-8">Abbie Wealth</p>

          <h2 className="text-[28px] lg:text-[26px] font-semibold tracking-[-.02em] text-white lg:text-ink">
            Enter your PIN
          </h2>
          <p className="text-[13px] text-white/50 lg:text-ink-2 mt-1.5">Administrator access</p>

          {/* ── The four digits ──────────────────────────────────────── */}
          <div
            role="group"
            aria-label="4-digit administrator PIN"
            className={`flex justify-center gap-3.5 mt-8 mb-2 ${shake ? 'animate-[shake_.4s_ease-in-out]' : ''}`}
          >
            {[0, 1, 2, 3].map(i => {
              const filled = i < pin.length
              const active = i === pin.length && !busy
              return (
                <span key={i} aria-hidden="true"
                  className={`w-[54px] h-[58px] rounded-2xl border flex items-center justify-center
                              transition-all duration-150
                              ${filled
                                ? 'bg-white border-white lg:bg-ink lg:border-ink'
                                : 'bg-white/[0.06] border-white/20 lg:bg-transparent lg:border-line'}
                              ${active ? 'border-white/70 lg:border-ink/50' : ''}`}>
                  {filled && <span className="w-2.5 h-2.5 rounded-full bg-ink lg:bg-white" />}
                </span>
              )
            })}
          </div>

          {/* Announces progress without ever announcing the digits. */}
          <p className="sr-only" aria-live="polite">
            {busy ? 'Checking your PIN' : `${pin.length} of 4 digits entered`}
          </p>

          <div className="min-h-[42px] flex items-center justify-center">
            {err
              ? <p role="alert" className="text-[12.5px] text-center text-white bg-red/80 lg:bg-red/10 lg:text-red
                                           border border-red/40 rounded-xl px-3.5 py-2">{err}</p>
              : busy
                ? <p className="text-[12.5px] text-white/50 lg:text-ink-3">Signing in…</p>
                : null}
          </div>

          {/* ── Keypad ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2.5 mt-1">
            {['1','2','3','4','5','6','7','8','9'].map(d => (
              <button key={d} type="button" className={key} disabled={busy}
                onClick={() => push(d)} aria-label={d}>{d}</button>
            ))}
            <span aria-hidden="true" />
            <button type="button" className={key} disabled={busy}
              onClick={() => push('0')} aria-label="0">0</button>
            <button type="button" onClick={back} disabled={busy || pin.length === 0}
              aria-label="Delete last digit"
              className={`${key} text-[15px] font-normal`}>
              <span aria-hidden="true">⌫</span>
            </button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%      { transform: translateX(-7px); }
          40%      { transform: translateX(7px); }
          60%      { transform: translateX(-4px); }
          80%      { transform: translateX(4px); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes shake { 0%, 100% { transform: none; } }
        }
      `}</style>
    </div>
  )
}
