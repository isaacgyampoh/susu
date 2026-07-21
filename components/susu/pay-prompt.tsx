'use client'
import { useEffect, useState, useCallback } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'

type Stage = 'prompted' | 'otp' | 'paid' | 'failed'

/**
 * Moolre pushes a prompt to the member's phone; they approve with their PIN and
 * never leave this screen. Two consequences:
 *
 *  - There is no redirect to come back from, so we poll until Moolre confirms.
 *  - Some networks ask for an SMS code first, and that is a step in the flow,
 *    not an error.
 *
 * Polling stops at 90 seconds. Leaving a spinner running forever would tell a
 * member their money is in limbo, which is worse than telling them to check
 * with their admin.
 */
export default function PayPrompt({
  reference, amount, phone, initial, message, ussd, onDone, onClose,
}: {
  reference: string
  amount: number
  phone?: string
  initial: 'prompted' | 'otp_required'
  message?: string
  ussd?: string
  onDone: () => void
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>(initial === 'otp_required' ? 'otp' : 'prompted')
  const [note, setNote]   = useState(message ?? '')
  const [otp, setOtp]     = useState('')
  const [busy, setBusy]   = useState(false)
  const [waited, setWaited] = useState(0)

  const check = useCallback(async () => {
    const { data } = await callFunction<{ status: string; message: string }>(
      'payments-verify', { method: 'POST', body: { reference }, token: getMemberToken()! }
    )
    if (data?.status === 'paid')   { setStage('paid');   setNote(data.message); return true }
    if (data?.status === 'failed') { setStage('failed'); setNote(data.message); return true }
    return false
  }, [reference])

  useEffect(() => {
    if (stage !== 'prompted') return
    let stop = false
    const t = setInterval(async () => {
      if (stop) return
      setWaited(w => w + 3)
      const done = await check()
      if (done) clearInterval(t)
    }, 3000)
    return () => { stop = true; clearInterval(t) }
  }, [stage, check])

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { data, error } = await callFunction<{ status: string; message: string }>(
      'payments-otp', { method: 'POST', body: { reference, otp }, token: getMemberToken()! }
    )
    setBusy(false)
    if (error) { setNote(error); return }
    if (data?.status === 'prompted') { setStage('prompted'); setNote(data.message); setWaited(0) }
  }

  const gaveUp = stage === 'prompted' && waited >= 90

  return (
    <div className="fixed inset-0 z-50 bg-ink/30 flex items-end sm:items-center justify-center" onClick={stage === 'paid' ? onDone : undefined}>
      <div className="bg-surface w-full sm:max-w-[380px] rounded-t-2xl sm:rounded-2xl p-6 animate-fade-in" onClick={e => e.stopPropagation()}>

        {stage === 'otp' && (
          <>
            <h2 className="text-[19px] font-semibold tracking-[-.02em]">Enter the code</h2>
            <p className="text-[13px] text-ink-2 mt-1.5">{note || 'Your network sent a verification code by SMS.'}</p>
            <form onSubmit={submitOtp} className="mt-5 space-y-3">
              <input className="in tnum text-center tracking-[.3em] font-semibold" inputMode="numeric"
                autoFocus value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
              <button type="submit" disabled={busy || !otp} className="btn-dark w-full">
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </form>
            <button onClick={onClose} className="btn-ghost w-full mt-2">Cancel</button>
          </>
        )}

        {stage === 'prompted' && (
          <>
            <h2 className="text-[19px] font-semibold tracking-[-.02em]">
              {ussd ? 'Dial to approve' : 'Approve on your phone'}
            </h2>
            <p className="text-[13px] text-ink-2 mt-1.5">
              {ussd
                ? `To pay GHS ${amount.toFixed(2)}, dial the code below on ${phone ?? 'your phone'} and follow the steps.`
                : (note || `Enter your MoMo PIN on ${phone ?? 'your phone'} to pay GHS ${amount.toFixed(2)}.`)}
            </p>

            {ussd && (
              <a href={`tel:${encodeURIComponent(ussd)}`}
                 className="mt-4 block text-center py-4 rounded-lg bg-ink text-white font-bold text-[20px] tracking-wide tnum active:brightness-110">
                {ussd}
              </a>
            )}
            {ussd && (
              <button
                onClick={() => { navigator.clipboard?.writeText(ussd).catch(() => {}) }}
                className="btn-line w-full mt-2 text-[13px]">
                Copy code
              </button>
            )}

            <div className="mt-5 p-4 rounded-lg bg-bg border border-line">
              <p className="text-[12.5px] text-ink-2">
                {gaveUp
                  ? 'Still not confirmed. If you approved it, your admin can check — do not pay twice.'
                  : ussd ? 'After you approve on your phone, this updates automatically…' : 'Waiting for your approval…'}
              </p>
              {!gaveUp && (
                <div className="h-1 bg-line rounded-full overflow-hidden mt-3">
                  <div className="h-full bg-ink rounded-full transition-all duration-1000"
                       style={{ width: `${Math.min((waited / 90) * 100, 100)}%` }} />
                </div>
              )}
            </div>

            <button onClick={gaveUp ? onClose : onDone} className="btn-line w-full mt-4">
              {gaveUp ? 'Close' : 'I have approved it'}
            </button>
            {!gaveUp && !ussd && (
              <p className="text-[11.5px] text-ink-3 mt-3 text-center">
                No prompt? Dial *170# and check your approvals.
              </p>
            )}
          </>
        )}

        {stage === 'paid' && (
          <>
            <h2 className="text-[19px] font-semibold tracking-[-.02em]">Payment received</h2>
            <p className="text-[13px] text-ink-2 mt-1.5">{note || 'Thank you. Your contribution is recorded.'}</p>
            <button onClick={onDone} className="btn-dark w-full mt-5">Done</button>
          </>
        )}

        {stage === 'failed' && (
          <>
            <h2 className="text-[19px] font-semibold tracking-[-.02em]">Not completed</h2>
            <p className="text-[13px] text-ink-2 mt-1.5">{note || 'The payment was not completed. You can try again.'}</p>
            <button onClick={onClose} className="btn-dark w-full mt-5">Try again</button>
          </>
        )}
      </div>
    </div>
  )
}
