'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, setAdminToken } from '@/lib/supabase'

/**
 * ADMINISTRATOR SIGN-IN.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Four digits, typed on the device's own keyboard. `inputMode="numeric"`
 * raises the phone's number pad — the OS keyboard the person already knows —
 * which is why no on-screen keypad is drawn here.
 *
 * ── WHAT THE PIN TOUCHES ────────────────────────────────────────────────
 *
 * One piece of component state, for the length of one submit. Not
 * localStorage, not the URL, not a form a browser would offer to save. Each
 * cell paints a dot and never the digit, so the PIN is neither
 * shoulder-readable nor sitting in the DOM as text, and autocomplete is off on
 * every cell — four digits that open an entire administration are not
 * something a shared browser should remember.
 *
 * ── THE BRAND FIELD ─────────────────────────────────────────────────────
 *
 * A drawing of a hand holding out a note, behind the wordmark, loaded via the
 * `.brand-photo` class. It is a CSS background rather than an <img>, so if the
 * file is ever missing the field simply stays dark: nothing broken to notice.
 * The scrim over it is heavy on the left where the type sits and nearly clear
 * on the right, so the picture survives instead of being washed out.
 *
 * An earlier revision drew a rotation diagram here instead. It was accurate
 * about what a susu is and still read as decoration; a picture of the actual
 * work says it without needing to be explained.
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
    // One field accepts a whole pasted PIN, so pasting works without the person
    // having to land the cursor in the first cell.
    const next = [...pin]
    for (let k = 0; k < digits.length && i + k < CELLS; k++) next[i + k] = digits[k]
    commit(next)
    refs.current[Math.min(i + digits.length, CELLS - 1)]?.focus()
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (busy) return
    if (e.key === 'Backspace') {
      e.preventDefault(); setErr('')
      const next = [...pin]
      // Clears this cell, or steps back into the previous one when this cell is
      // already empty — the absence of which makes segmented inputs infuriating.
      if (next[i]) { next[i] = ''; setPin(next) }
      else if (i > 0) { next[i - 1] = ''; setPin(next); refs.current[i - 1]?.focus() }
      return
    }
    if (e.key === 'ArrowLeft'  && i > 0)         { e.preventDefault(); refs.current[i - 1]?.focus() }
    if (e.key === 'ArrowRight' && i < CELLS - 1) { e.preventDefault(); refs.current[i + 1]?.focus() }
    if (e.key === 'Escape') { setPin(Array(CELLS).fill('')); setErr(''); refs.current[0]?.focus() }
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
  const active = pin.findIndex(d => !d)

  return (
    <main className="min-h-[100dvh] grid grid-rows-[auto_1fr]
                     lg:grid-rows-1 lg:grid-cols-[1.12fr_minmax(440px,.88fr)] bg-[#0C0E12]">

      {/* ══ Brand field ═══════════════════════════════════════════════════
          On a phone this is a band across the top, not a hidden panel: the
          application announces itself before it asks for anything. */}
      <section className="signin-dark relative flex flex-col justify-between overflow-hidden
                          bg-[#0C0E12] text-white
                          px-[1.125rem] sm:px-10 lg:p-14 xl:p-16
                          pt-[max(2rem,calc(env(safe-area-inset-top)+1.25rem))]
                          pb-8 sm:pb-10 lg:pb-14
                          min-h-[38dvh] sm:min-h-[42dvh] lg:min-h-0">

        {/*
          ── THE PICTURE ───────────────────────────────────────────────────
          The same drawing the member sign-in uses — a hand holding out a note —
          so the two screens read as one product.

          A CSS background rather than an <img>: if the file is ever missing the
          dark field simply shows through, with nothing broken to notice.
        */}
        <div aria-hidden="true" className="brand-photo absolute inset-0" />
        <div aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-[#0C0E12] via-[#0C0E12]/75 to-transparent" />

        <div className="relative">
          <span className="font-display font-bold text-white
                           text-[19px] sm:text-[21px] lg:text-[23px]
                           tracking-[-.02em] leading-none">
            Abbie&nbsp;Wealth
          </span>
        </div>

        <div className="relative max-w-[520px] mt-8 lg:mt-0">
          <p className="t-eyebrow !text-white/40 mb-3 lg:mb-5">Susu operations</p>
          <h1 className="font-display font-semibold tracking-[-.032em] text-balance
                         text-[clamp(27px,7.2vw,34px)] leading-[1.08]
                         lg:text-[clamp(34px,3.2vw,46px)] lg:leading-[1.06]">
            Every cedi accounted for,
            <br className="hidden xl:block" /> every slot in its turn.
          </h1>
          <p className="hidden sm:block mt-5 lg:mt-6 text-md text-white/55 leading-relaxed max-w-[430px]">
            Contributions, allocations and payouts — recorded once, by one engine,
            with a trail behind every figure.
          </p>
        </div>

        <div className="relative hidden lg:flex items-end justify-between gap-8">
          <span className="text-xs text-white/35">Administrator console</span>
        </div>
      </section>

      {/* ══ Sign-in surface ═══════════════════════════════════════════════
          Rises to meet the brand field and owns the rest of the viewport.
          A 16px top edge, not a floating rounded card. */}
      {/*
        A grid, not competing auto margins. The column had `my-auto` on the form
        AND `mt-auto` on the footer; the two fought and left the entry sitting
        high with roughly half the panel empty beneath it. Two rows — the form
        centred in whatever is left, the footer pinned — is deterministic at
        every height.
      */}
      <section className="security-paper relative grid grid-rows-[1fr_auto] min-w-0
                          bg-surface lg:border-l lg:border-line
                          rounded-t-2xl lg:rounded-none
                          -mt-4 lg:mt-0
                          px-[1.125rem] sm:px-10 lg:px-14
                          pt-7 sm:pt-10 lg:pt-0
                          pb-[max(1.5rem,env(safe-area-inset-bottom))]">

        {/* No cap and no centring on a phone — see the member sign-in for
            what a fixed column does to a 575px screen. */}
        <div className="flex items-center min-h-0">
         <div className="w-full sm:max-w-[380px] lg:max-w-[360px] lg:mx-auto">
          <span className="block w-8 h-[3px] rounded-full bg-accent mb-5 lg:mb-6" />

          <h2 className="font-display text-2xl font-semibold text-ink tracking-[-.022em]">
            Enter your admin PIN
          </h2>
          <p className="text-sm text-ink-2 mt-2 leading-relaxed">
            Four digits. Five wrong attempts locks this device for fifteen minutes.
          </p>

          <div
            role="group"
            aria-label="Administrator PIN, 4 digits"
            onPaste={onPaste}
            className={`flex gap-2.5 mt-7 ${shake ? 'animate-[shake_.38s_ease-in-out]' : ''}`}
          >
            {pin.map((d, i) => {
              const isActive = i === active && !busy
              return (
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
                    // Value lives in state and is painted as a dot below, so the
                    // digit itself is never drawn on screen.
                    className={`peer w-full h-[64px] sm:h-[68px] rounded-xl bg-surface-2 text-center
                                text-transparent caret-transparent outline-none border
                                transition-[border-color,background-color,box-shadow] duration-150
                                ${err ? 'border-danger/45' : d ? 'border-ink/25' : 'border-line'}
                                focus:border-ink focus:bg-surface focus:ring-[3px] focus:ring-ink/[0.08]
                                disabled:opacity-50`}
                  />
                  <span aria-hidden="true"
                    className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    {d ? (
                      <span className="w-[10px] h-[10px] rounded-full bg-ink animate-[popIn_.16s_ease-out]" />
                    ) : (
                      <span className={`rounded-full bg-ink transition-all duration-200
                                        ${isActive ? 'w-[2px] h-6 opacity-70 animate-[caret_1.1s_steps(1)_infinite]'
                                                   : 'w-[5px] h-[5px] opacity-[0.14]'}`} />
                    )}
                  </span>
                  {/* Fills from the bottom as the digit lands. */}
                  <span aria-hidden="true"
                    className={`pointer-events-none absolute left-3 right-3 bottom-[9px] h-[2px] rounded-full
                                transition-all duration-200
                                ${d ? 'bg-accent opacity-100' : 'bg-ink opacity-0'}`} />
                </div>
              )
            })}
          </div>

          {/* Progress, never the digits. */}
          <p className="sr-only" aria-live="polite">
            {busy ? 'Checking your PIN' : `${filled} of ${CELLS} digits entered`}
          </p>

          <div className="min-h-[54px] mt-4">
            {err ? (
              <p role="alert"
                className="text-sm text-danger bg-danger-soft border border-danger-line
                           rounded-[10px] px-3 py-2.5 animate-[riseIn_.18s_ease-out]">
                {err}
              </p>
            ) : busy ? (
              <p className="text-sm text-ink-3 flex items-center gap-2">
                <span aria-hidden="true"
                  className="w-3.5 h-3.5 rounded-full border-2 border-ink-3/25 border-t-ink-3 animate-spin" />
                Signing in…
              </p>
            ) : null}
          </div>

          {/*
            Security context, which is the one kind of supporting content an
            operations sign-in should carry. Every line is true of THIS endpoint
            — the lockout is check_admin_pin_gate, the record is login_attempts,
            the hash is bcrypt in admin_users. No invented certification, no
            badge, nothing that would stop being true if the code changed
            without this list changing with it.

            From `lg` only: on a phone the form already owns the surface.
          */}
          <ul className="hidden lg:block mt-9 space-y-3.5 border-t border-line pt-6">
            {[
              ['Rate limited',           'Five wrong attempts locks this device for fifteen minutes.'],
              ['Every sign-in recorded', 'Time, outcome and source are kept for each attempt.'],
              ['PIN never stored',       'Only a one-way hash of it is, and it is compared in the database.'],
            ].map(([head, body]) => (
              <li key={head} className="flex gap-3">
                <span aria-hidden="true" className="mt-[9px] w-3.5 h-px bg-accent shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{head}</p>
                  <p className="text-xs text-ink-2 mt-0.5 leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ul>

         </div>
        </div>

        {/* Both claims are true of this endpoint — no invented certification,
            no security badge. */}
        <p className="text-2xs text-ink-3 leading-relaxed pt-7 sm:max-w-[380px] lg:max-w-[360px] lg:mx-auto lg:w-full">
          Sign-in attempts are rate limited and recorded. Changing your PIN signs
          out every device.
        </p>
      </section>

      <style jsx global>{`
        /* Fine grain, so the dark panel reads as a surface rather than a fill. */
        .signin-dark::after {
          content: '';
          position: absolute; inset: 0; pointer-events: none;
          opacity: .035; mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }
        .ring-node { opacity: 0; animation: nodeIn .5s ease-out forwards; }
        @keyframes nodeIn { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
        .ring-node { transform-box: fill-box; transform-origin: center; }
        @keyframes popIn { from { transform: scale(.4); opacity: .4; } to { transform: none; opacity: 1; } }
        @keyframes caret  { 0%, 49% { opacity: .7 } 50%, 100% { opacity: 0 } }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25%      { transform: translateX(-6px); }
          50%      { transform: translateX(6px); }
          75%      { transform: translateX(-3px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ring-node { opacity: 1; animation: none; }
          @keyframes shake  { 0%, 100% { transform: none; } }
          @keyframes popIn  { from, to { transform: none; opacity: 1; } }
          @keyframes caret  { 0%, 100% { opacity: .7 } }
        }
      `}</style>
    </main>
  )
}
