'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, setAdminToken } from '@/lib/supabase'

/**
 * ADMINISTRATOR SIGN-IN.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Four digits, typed on the device's own keyboard.
 *
 * An earlier revision drew an on-screen 1-2-3 keypad. It worked, but it made a
 * financial operations console look like a cash machine, and on desktop it
 * asked an administrator to click at numbers they could simply type. The
 * keypad is gone. What remains is four cells and a caret.
 *
 * `inputMode="numeric"` is what brings up the phone's number pad — the OS
 * keyboard, which the person already knows, rather than a bespoke one drawn in
 * a div. That is the whole reason a custom keypad was never needed.
 *
 * ── WHAT THE PIN TOUCHES ────────────────────────────────────────────────
 *
 * It lives in one piece of component state for the length of a submit and goes
 * nowhere else: not localStorage, not the URL, not a form a browser would offer
 * to save. Each cell renders a dot, never the digit, so the PIN is not
 * shoulder-readable and not sitting in the DOM as text. Autocomplete is off on
 * every cell — four digits that open an entire administration are not something
 * a shared browser should remember.
 *
 * What persists after a successful sign-in is the token the server issues,
 * which is what the email login used to leave behind too.
 */

const CELLS = 4

export default function SignIn() {
  const router = useRouter()
  const [pin, setPin]     = useState<string[]>(Array(CELLS).fill(''))
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')
  const [shake, setShake] = useState(false)
  const refs = useRef<(HTMLInputElement | null)[]>([])
  // Guards the auto-submit: a re-render at four digits would otherwise fire twice.
  const sending = useRef(false)

  useEffect(() => {
    if (localStorage.getItem('admin_token')) router.replace('/admin')
    else refs.current[0]?.focus()
  }, [router])

  const submit = useCallback(async (value: string) => {
    if (sending.current) return
    sending.current = true
    setBusy(true); setErr('')

    const { data, error } = await callFunction<{ token: string; admin: { must_change_password?: boolean } }>(
      'auth-admin-login', { method: 'POST', body: { pin: value } },
    )

    setBusy(false)
    sending.current = false

    if (error) {
      // Clear on failure. Leaving four wrong digits on screen invites the next
      // attempt to be a one-digit edit of a guess that already failed.
      setPin(Array(CELLS).fill('')); setErr(error); setShake(true)
      setTimeout(() => setShake(false), 380)
      refs.current[0]?.focus()
      return
    }
    setAdminToken(data!.token)
    localStorage.setItem('admin_user', JSON.stringify(data!.admin))
    router.push(data!.admin?.must_change_password ? '/admin/password' : '/admin')
  }, [router])

  const commit = useCallback((next: string[]) => {
    setPin(next)
    const joined = next.join('')
    if (joined.length === CELLS && /^\d{4}$/.test(joined)) void submit(joined)
  }, [submit])

  function onChange(i: number, raw: string) {
    if (busy) return
    setErr('')
    const digits = raw.replace(/\D/g, '')
    if (!digits) return

    // One field accepts a whole pasted PIN, so pasting works without the
    // person having to land the cursor in the first cell.
    const next = [...pin]
    for (let k = 0; k < digits.length && i + k < CELLS; k++) next[i + k] = digits[k]
    const landed = Math.min(i + digits.length, CELLS - 1)
    commit(next)
    refs.current[landed]?.focus()
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (busy) return
    if (e.key === 'Backspace') {
      e.preventDefault()
      setErr('')
      const next = [...pin]
      // Backspace clears this cell, or steps back into the previous one when
      // this cell is already empty — the behaviour every OTP field has, and the
      // absence of which makes segmented inputs infuriating.
      if (next[i]) { next[i] = '' ; setPin(next) }
      else if (i > 0) { next[i - 1] = ''; setPin(next); refs.current[i - 1]?.focus() }
      return
    }
    if (e.key === 'ArrowLeft'  && i > 0)         { e.preventDefault(); refs.current[i - 1]?.focus() }
    if (e.key === 'ArrowRight' && i < CELLS - 1) { e.preventDefault(); refs.current[i + 1]?.focus() }
    if (e.key === 'Escape')                      { setPin(Array(CELLS).fill('')); setErr(''); refs.current[0]?.focus() }
  }

  function onPaste(e: React.ClipboardEvent) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CELLS)
    if (!digits) return
    e.preventDefault()
    const next = Array(CELLS).fill('')
    for (let k = 0; k < digits.length; k++) next[k] = digits[k]
    commit(next)
    refs.current[Math.min(digits.length, CELLS - 1)]?.focus()
  }

  const filled = pin.filter(Boolean).length

  return (
    <main className="min-h-[100dvh] grid lg:grid-cols-[1.05fr_minmax(420px,.85fr)] bg-bg">

      {/* ── Brand side. A flat ink field and a statement — no photograph, no
             gradient, no illustration. The restraint is the identity. ───── */}
      <div className="relative hidden lg:flex flex-col justify-between bg-ink p-14 overflow-hidden">
        {/* One quiet geometric mark, drawn from the rotation the product is
            about: fixed slots, filled in turn. It is not decoration for its own
            sake — it is the thing the business does. */}
        <div aria-hidden="true" className="absolute right-[-90px] bottom-[-90px] opacity-[0.07]">
          <svg width="420" height="420" viewBox="0 0 100 100" fill="none">
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i / 12) * Math.PI * 2 - Math.PI / 2
              return (
                <circle key={i} cx={50 + Math.cos(a) * 34} cy={50 + Math.sin(a) * 34}
                  r={i < 7 ? 5.5 : 4} fill={i < 7 ? '#fff' : 'none'}
                  stroke="#fff" strokeWidth="1" />
              )
            })}
          </svg>
        </div>

        <span className="font-display text-md font-semibold text-white tracking-[-.01em]">
          Abbie Wealth
        </span>

        <div className="relative max-w-[460px]">
          <h1 className="font-display text-[40px] leading-[1.08] font-semibold text-white tracking-[-.03em] text-balance">
            Every cedi accounted for, every slot in its turn.
          </h1>
          <p className="mt-5 text-md text-white/55 leading-relaxed">
            Contributions, allocations and payouts — recorded once, by one engine,
            with a trail behind every figure.
          </p>
        </div>

        <span className="text-xs text-white/35">Administrator console</span>
      </div>

      {/* ── Sign-in side ─────────────────────────────────────────────────── */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-10 lg:px-14
                      bg-surface lg:border-l lg:border-line
                      [padding-top:max(3rem,env(safe-area-inset-top))]
                      [padding-bottom:max(3rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-[340px] mx-auto">

          <span className="lg:hidden font-display text-md font-semibold text-ink tracking-[-.01em]">
            Abbie Wealth
          </span>

          <h2 className="font-display text-2xl font-semibold text-ink tracking-[-.02em] mt-7 lg:mt-0">
            Enter your admin PIN
          </h2>
          <p className="text-sm text-ink-2 mt-2">
            Four digits. Five wrong attempts locks this device for fifteen minutes.
          </p>

          <div
            role="group"
            aria-label="Administrator PIN, 4 digits"
            onPaste={onPaste}
            className={`flex gap-3 mt-8 ${shake ? 'animate-[shake_.38s_ease-in-out]' : ''}`}
          >
            {pin.map((d, i) => (
              <div key={i} className="relative flex-1">
                <input
                  ref={el => { refs.current[i] = el }}
                  value={d}
                  onChange={e => onChange(i, e.target.value)}
                  onKeyDown={e => onKeyDown(i, e)}
                  onFocus={e => e.target.select()}
                  disabled={busy}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={CELLS}
                  aria-label={`Digit ${i + 1} of ${CELLS}`}
                  // The value is kept in state and rendered as a dot below, so
                  // the digit itself is never painted on screen.
                  className={`peer w-full h-[62px] rounded-xl border bg-surface-2 text-center
                              text-transparent caret-ink outline-none
                              transition-[border-color,box-shadow,background-color] duration-150
                              ${err ? 'border-danger/50' : 'border-line'}
                              focus:border-ink focus:bg-surface focus:ring-4 focus:ring-ink/[0.07]
                              disabled:opacity-50`}
                />
                <span aria-hidden="true"
                  className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className={`rounded-full bg-ink transition-all duration-150
                                    ${d ? 'w-[11px] h-[11px] opacity-100' : 'w-[6px] h-[6px] opacity-15'}`} />
                </span>
              </div>
            ))}
          </div>

          {/* Progress, never the digits. */}
          <p className="sr-only" aria-live="polite">
            {busy ? 'Checking your PIN' : `${filled} of ${CELLS} digits entered`}
          </p>

          <div className="min-h-[52px] mt-4">
            {err ? (
              <p role="alert"
                className="text-sm text-danger bg-danger-soft border border-danger-line rounded-lg px-3 py-2.5">
                {err}
              </p>
            ) : busy ? (
              <p className="text-sm text-ink-3 flex items-center gap-2">
                <span aria-hidden="true"
                  className="w-3.5 h-3.5 rounded-full border-2 border-ink-3/30 border-t-ink-3 animate-spin" />
                Signing in…
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25%      { transform: translateX(-6px); }
          50%      { transform: translateX(6px); }
          75%      { transform: translateX(-3px); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes shake { 0%, 100% { transform: none; } }
        }
      `}</style>
    </main>
  )
}
