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
 * ── WHY THE LEFT PANEL LOOKS LIKE THAT ──────────────────────────────────
 *
 * A susu is a rotation: a fixed ring of slots, everyone paying in, one member
 * collecting per turn. That is the whole product, and it happens to be a
 * shape. So the ring is drawn properly and at scale — seven slots settled, one
 * lit as the current turn, the rest still ahead — rather than used as abstract
 * circles in a corner. It is the one image on this screen, it means something
 * specific, and it is the reason the page needs no stock photography, no
 * gradient and no padlock illustration.
 */

const CELLS = 4

/* Rotation state. Static: this is the sign-in screen, so there is no member
   and nothing real to read. It illustrates the idea, and claims no figures. */
const SLOTS = 12
const SETTLED = 7
const CURRENT = 7

function RotationRing() {
  const R = 74
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" aria-hidden="true">
      <circle cx="100" cy="100" r={R}      fill="none" stroke="rgb(255 255 255 / .10)" strokeWidth="1" />
      <circle cx="100" cy="100" r={R - 22} fill="none" stroke="rgb(255 255 255 / .05)" strokeWidth="1" />
      <circle cx="100" cy="100" r={R + 22} fill="none" stroke="rgb(255 255 255 / .04)" strokeWidth="1" />

      {Array.from({ length: SLOTS }).map((_, i) => {
        const a = (i / SLOTS) * Math.PI * 2 - Math.PI / 2
        const x = 100 + Math.cos(a) * R
        const y = 100 + Math.sin(a) * R
        const settled = i < SETTLED
        const current = i === CURRENT
        return (
          <g key={i} className="ring-node" style={{ animationDelay: `${i * 55}ms` }}>
            {current && (
              <circle cx={x} cy={y} r="13" fill="none" stroke="#A7DCC4" strokeWidth="1" opacity=".45" />
            )}
            <circle
              cx={x} cy={y} r={current ? 7 : 5.5}
              fill={current ? '#A7DCC4' : settled ? 'rgb(255 255 255 / .92)' : 'transparent'}
              stroke={current ? 'none' : settled ? 'none' : 'rgb(255 255 255 / .30)'}
              strokeWidth="1.25"
            />
          </g>
        )
      })}
    </svg>
  )
}

/** Ring with a settled arc — the rotation, small enough to sit beside a name. */
function Mark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity=".28" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="3" r="2.1" fill="currentColor" />
    </svg>
  )
}

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

        <div aria-hidden="true"
          className="pointer-events-none absolute
                     -right-[22%] -bottom-[46%] w-[min(460px,86%)]
                     sm:-right-[16%] sm:-bottom-[52%] sm:w-[min(560px,70%)]
                     lg:-right-[14%] lg:-bottom-[18%] lg:w-[min(760px,78%)]
                     aspect-square opacity-[0.5]">
          <RotationRing />
        </div>

        <div className="relative flex items-center gap-2.5">
          <Mark className="w-[18px] h-[18px] lg:w-[19px] lg:h-[19px] text-[#A7DCC4]" />
          <span className="font-display text-md font-semibold tracking-[-.01em]">Abbie Wealth</span>
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
          <span className="flex items-center gap-2.5 text-xs text-white/35">
            <span className="w-1.5 h-1.5 rounded-full bg-[#A7DCC4]" />
            Slot {CURRENT + 1} of {SLOTS} · {SETTLED} settled
          </span>
        </div>
      </section>

      {/* ══ Sign-in surface ═══════════════════════════════════════════════
          Rises to meet the brand field and owns the rest of the viewport.
          A 16px top edge, not a floating rounded card. */}
      <section className="relative flex flex-col min-w-0
                          bg-surface lg:border-l lg:border-line
                          rounded-t-2xl lg:rounded-none
                          -mt-4 lg:mt-0
                          px-[1.125rem] sm:px-10 lg:px-14
                          pt-7 sm:pt-10 lg:pt-0
                          pb-[max(1.5rem,env(safe-area-inset-bottom))]">

        {/* No cap and no centring on a phone — see the member sign-in for
            what a fixed column does to a 575px screen. */}
        <div className="w-full sm:max-w-[380px] lg:max-w-[336px] my-auto">
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
                  {/* Fills from the bottom, the way a slot in the ring fills. */}
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
        </div>

        {/* Anchored to the foot of the surface. Both claims are true of this
            endpoint — no invented certification, no security badge. */}
        <p className="text-2xs text-ink-3 leading-relaxed mt-auto pt-7 sm:max-w-[380px] lg:max-w-[336px]">
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
