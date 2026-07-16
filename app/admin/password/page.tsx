'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, getAdminToken, clearAdminAuth } from '@/lib/supabase'

export default function ChangePassword() {
  const router = useRouter()
  const [cur, setCur]   = useState('')
  const [next, setNext] = useState('')
  const [conf, setConf] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')
  const [ok, setOk]     = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (next !== conf)      { setErr('The new passwords do not match'); return }
    if (next.length < 10)   { setErr('Use at least 10 characters'); return }
    if (next === 'Admin@1234') { setErr('That is the shipped default. Choose something else.'); return }

    setBusy(true); setErr('')
    const { error } = await callFunction('admin-change-password', {
      method: 'POST', body: { current_password: cur, new_password: next }, token: getAdminToken()!,
    })
    setBusy(false)
    if (error) { setErr(error); return }

    // The change revoked every session, including this one
    setOk(true)
    setTimeout(() => { clearAdminAuth(); router.push('/') }, 1800)
  }

  if (ok) return (
    <div className="px-5 sm:px-8 py-16 max-w-[420px]">
      <h1 className="t-title">Password changed</h1>
      <p className="t-meta mt-2">Signing you out — all other sessions have ended too.</p>
    </div>
  )

  return (
    <div className="px-5 sm:px-8 py-7 pb-16 max-w-[420px] animate-fade-in">
      <h1 className="t-title">Change password</h1>
      <p className="t-meta mt-1.5 mb-7">
        Changing this signs out every device, including this one.
      </p>

      <form onSubmit={submit} className="space-y-4">
        {err && <p className="text-[12.5px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2.5">{err}</p>}

        <div>
          <label className="in-lbl">Current password</label>
          <input className="in" type="password" required autoComplete="current-password"
            value={cur} onChange={e => setCur(e.target.value)} />
        </div>
        <div>
          <label className="in-lbl">New password</label>
          <input className="in" type="password" required autoComplete="new-password" minLength={10}
            value={next} onChange={e => setNext(e.target.value)} />
          <p className="text-[11.5px] text-ink-3 mt-1.5">At least 10 characters.</p>
        </div>
        <div>
          <label className="in-lbl">Confirm new password</label>
          <input className="in" type="password" required autoComplete="new-password"
            value={conf} onChange={e => setConf(e.target.value)} />
        </div>

        <button type="submit" disabled={busy} className="btn-dark w-full">
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </div>
  )
}
