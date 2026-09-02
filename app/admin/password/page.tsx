'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, getAdminToken, clearAdminAuth } from '@/lib/supabase'
import { rejectNewPin } from '@/src/domain/admin/pin-policy'

/**
 * CHANGE THE ADMINISTRATOR PIN.
 *
 * The credential is four digits now, so this screen asks for four digits. It
 * previously asked for a 10-character password and enforced that client-side —
 * a rule that, after the sign-in change, would have rejected every PIN that
 * could actually be used to sign in.
 *
 * The rules are NOT decided here. `change_admin_password()` in the database is
 * the authority; `rejectNewPin` is the console's copy, kept in step with it by
 * a test that walks all 10,000 PINs. Checking here only means a refusal can be
 * explained before the round trip rather than after it.
 */

/** A single 4-digit box. `type="password"` so the digits are never on screen. */
function PinField(props: {
  id: string; label: string; value: string; onChange: (v: string) => void; hint?: string
}) {
  return (
    <div>
      <label className="in-lbl" htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        className="in tracking-[.7em] text-center text-[19px] tabular-nums"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        required
        maxLength={4}
        pattern="\d{4}"
        value={props.value}
        // Strip anything that is not a digit as it is typed, so the field can
        // only ever hold something the server would accept.
        onChange={e => props.onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      />
      {props.hint && <p className="text-[11.5px] text-ink-3 mt-1.5">{props.hint}</p>}
    </div>
  )
}

export default function ChangePin() {
  const router = useRouter()
  const [cur, setCur]   = useState('')
  const [next, setNext] = useState('')
  const [conf, setConf] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')
  const [ok, setOk]     = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (next !== conf) { setErr('The two new PINs do not match'); return }
    const bad = rejectNewPin(next, cur)
    if (bad) { setErr(bad); return }

    setBusy(true); setErr('')
    const { error } = await callFunction('admin-change-password', {
      method: 'POST', body: { current_pin: cur, new_pin: next }, token: getAdminToken()!,
    })
    setBusy(false)
    if (error) { setErr(error); return }

    // The change bumped token_version, which revoked every session — this one
    // included. Signing out here is honesty about a token that is already dead.
    setOk(true)
    setTimeout(() => { clearAdminAuth(); router.push('/') }, 1800)
  }

  if (ok) return (
    <div className="px-5 sm:px-8 py-16 max-w-[420px]">
      <h1 className="t-title">PIN changed</h1>
      <p className="t-meta mt-2">Signing you out — all other sessions have ended too.</p>
    </div>
  )

  return (
    <div className="px-5 sm:px-8 py-7 pb-16 max-w-[420px] animate-fade-in">
      <h1 className="t-title">Change PIN</h1>
      <p className="t-meta mt-1.5 mb-7">
        Your PIN is how you sign in. Changing it signs out every device, including this one.
      </p>

      <form onSubmit={submit} className="space-y-4">
        {err && <p role="alert" className="text-[12.5px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2.5">{err}</p>}

        <PinField id="cur"  label="Current PIN" value={cur}  onChange={setCur} />
        <PinField id="next" label="New PIN"     value={next} onChange={setNext}
          hint="Four digits. Not a run like 1234, and not the same digit repeated." />
        <PinField id="conf" label="Confirm new PIN" value={conf} onChange={setConf} />

        <button type="submit" disabled={busy} className="btn-dark w-full">
          {busy ? 'Changing…' : 'Change PIN'}
        </button>
      </form>
    </div>
  )
}
