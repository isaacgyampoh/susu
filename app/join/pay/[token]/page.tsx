'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, Clock, ShieldCheck, AlertTriangle, Smartphone } from 'lucide-react'
import { callFunction } from '@/lib/supabase'
import { ghs2 } from '@/lib/money'
import {
  Badge, Button, Card, DetailList, DetailRow, Field, Input, Select,
  LoadingBlock, Notice, useToast,
} from '@/components/ui'

/**
 * REGISTRATION FEE — the applicant's payment page.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The only screen in this application that a person can reach without an
 * account. Its authority is the token in the URL, which the server hashes and
 * matches; nothing here sends an application id, and nothing here sends an
 * amount. The fee shown is the fee the server computed from the group
 * configuration when the form was submitted.
 *
 * WHAT THIS PAGE MAY NOT SAY
 *
 * It may not say "Paid" because a prompt was raised. `initiate` succeeding
 * means a request reached somebody's phone; whether they approved it is a
 * separate fact that only NaloPay can report. So the state after initiating is
 * "Awaiting confirmation", and it becomes "Paid" only when the server has
 * asked NaloPay and NaloPay has confirmed the full amount.
 *
 * And paying does not approve the application. The final state is deliberately
 * two lines — fee received, approval still pending — because conflating them
 * is how someone ends up believing they are a member when nobody has reviewed
 * their Ghana Card.
 */

type State = 'payment_required' | 'awaiting_confirmation' | 'paid' | 'no_fee' | 'failed' | 'short'

interface Reg {
  applicant: { name: string; phone: string }
  groups: { name: string; registration_fee: number; contribution_amount: number; frequency: string; slots: number }[]
  fee: number
  charged: number
  service_charge_pct: number
  payment_state: State
  registration_status: string
  submitted_at: string
  link_expires: string | null
  reference: string | null
  next_step: string
  sign_in_url: string
}

const NETWORKS = ['MTN', 'VODAFONE', 'AIRTELTIGO']

export default function RegistrationPaymentPage() {
  const { token } = useParams<{ token: string }>()
  const toast = useToast()

  const [reg, setReg]         = useState<Reg | null>(null)
  const [loading, setLoading] = useState(true)
  const [gone, setGone]       = useState<string | null>(null)
  const [busy, setBusy]       = useState(false)
  const [state, setState]     = useState<State | null>(null)
  const [reference, setRef]   = useState<string | null>(null)
  const [ussd, setUssd]       = useState<string | null>(null)
  const [note, setNote]       = useState<string | null>(null)

  const [number, setNumber]   = useState('')
  const [network, setNetwork] = useState('MTN')

  const polling = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await callFunction<Reg>(`registration-payment?token=${token}`)
    if (error) { setGone(error); setLoading(false); return }
    setReg(data)
    setState(data?.payment_state ?? null)
    setRef(data?.reference ?? null)
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  // While a prompt is outstanding, ask the server — which asks NaloPay — every
  // five seconds. The page never decides for itself that a payment landed.
  const verify = useCallback(async (quiet = false) => {
    const { data, error } = await callFunction<{ status: State; message: string; amount?: number }>(
      'registration-payment', { method: 'POST', body: { token, action: 'verify' } })
    if (error) { if (!quiet) toast.error({ title: 'Could not check', body: error }); return }
    if (!data) return
    setState(data.status)
    setNote(data.message)
    if (data.status === 'paid' || data.status === 'failed' || data.status === 'short') {
      if (polling.current) { clearInterval(polling.current); polling.current = null }
      if (data.status === 'paid') load()
    }
  }, [token, toast, load])

  useEffect(() => {
    if (state !== 'awaiting_confirmation' || !reference) return
    polling.current = setInterval(() => verify(true), 5000)
    return () => { if (polling.current) clearInterval(polling.current) }
  }, [state, reference, verify])

  async function pay() {
    setBusy(true); setNote(null); setUssd(null)
    const { data, error } = await callFunction<{
      status: State; reference: string; amount_charged: number; ussd?: string; message: string
    }>('registration-payment', {
      method: 'POST', body: { token, action: 'initiate', pay_number: number, pay_network: network },
    })
    setBusy(false)
    if (error) { toast.error({ title: 'Could not start the payment', body: error }); return }
    if (!data) return
    setState(data.status); setRef(data.reference); setUssd(data.ussd ?? null); setNote(data.message)
  }

  if (loading) return <LoadingBlock label="Loading your registration" className="min-h-[70vh]" />

  if (gone) return (
    <Shell>
      <Card pad="lg" className="text-center">
        <AlertTriangle size={30} strokeWidth={1.7} className="mx-auto text-warning" aria-hidden="true" />
        <h1 className="t-h2 mt-3">This link isn&rsquo;t valid</h1>
        <p className="text-sm text-ink-2 mt-2">{gone}</p>
        <p className="text-xs text-ink-3 mt-4">
          Payment links expire. Ask your susu admin to send you a new one.
        </p>
      </Card>
    </Shell>
  )
  if (!reg) return null

  const paid = state === 'paid'
  const waiting = state === 'awaiting_confirmation'

  return (
    <Shell>
      <header className="mb-5">
        <p className="t-eyebrow">Abbie Wealth Susu</p>
        <h1 className="text-2xl font-semibold text-ink mt-1">Registration</h1>
        <p className="text-sm text-ink-2 mt-1">
          {reg.applicant.name} · <span className="font-mono text-xs">{reg.applicant.phone}</span>
        </p>
      </header>

      <Card pad="lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="t-h2">
            {reg.groups.length === 1 ? 'Group' : `${reg.groups.length} groups`}
          </h2>
          {paid
            ? <Badge tone="good"><CheckCircle2 size={11} strokeWidth={2.6} aria-hidden="true" />Fee paid</Badge>
            : waiting
              ? <Badge tone="warn"><Clock size={11} strokeWidth={2.6} aria-hidden="true" />Awaiting confirmation</Badge>
              : <Badge tone="warn">Payment required</Badge>}
        </div>

        <div className="mt-3 divide-y divide-line-2 border-y border-line-2">
          {reg.groups.map(g => (
            <div key={g.name} className="flex items-baseline justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-ink truncate">{g.name}</p>
                <p className="text-2xs text-ink-3 tnum">
                  GHS {ghs2(g.contribution_amount)} {g.frequency}
                  {g.slots > 1 && ` · ${g.slots} slots`}
                </p>
              </div>
              <span className="text-sm text-ink-2 tnum shrink-0">GHS {ghs2(g.registration_fee)}</span>
            </div>
          ))}
        </div>

        <DetailList className="mt-4">
          <DetailRow label="Registration fee"><strong>GHS {ghs2(reg.fee)}</strong></DetailRow>
          {reg.charged > reg.fee && (
            <DetailRow label={`Charged (incl. ${reg.service_charge_pct}% service charge)`}>
              GHS {ghs2(reg.charged)}
            </DetailRow>
          )}
          <DetailRow label="Status">
            {paid ? 'Received' : waiting ? 'Awaiting confirmation' : 'Payment required'}
          </DetailRow>
        </DetailList>
      </Card>

      {/* ── Paid ───────────────────────────────────────────────────────── */}
      {paid && (
        <Card pad="lg" className="mt-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={22} strokeWidth={2} className="text-success shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="t-h2">Registration fee paid</h2>
              <p className="text-2xl font-semibold text-ink tnum mt-1">GHS {ghs2(reg.fee)}</p>
              {/* Deliberately separate. Paying is not being approved. */}
              <p className="text-sm text-ink-2 mt-3">
                <strong className="text-ink">Registration: awaiting approval.</strong>{' '}
                We&rsquo;ll review your application and text your sign-in details once it is approved.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── Short payment — never silently accepted ─────────────────────── */}
      {state === 'short' && (
        <Notice tone="warn" title="We received less than the fee" className="mt-4">
          {note} Nothing has been marked paid.
        </Notice>
      )}

      {/* ── Awaiting the provider ───────────────────────────────────────── */}
      {waiting && (
        <Card pad="lg" className="mt-4">
          <div className="flex items-start gap-3">
            <Clock size={20} strokeWidth={2} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="t-h2">Payment initiated</h2>
              {reference && (
                <p className="text-xs text-ink-3 mt-1">
                  Reference <span className="font-mono">{reference}</span>
                </p>
              )}
              <p className="text-sm text-ink-2 mt-2">{note ?? 'Approve the prompt on your phone.'}</p>
              {ussd && (
                <p className="text-sm text-ink mt-2">
                  If no prompt arrives, dial <span className="font-mono font-semibold">{ussd}</span>.
                </p>
              )}
              <p className="text-xs text-ink-3 mt-3">
                This page checks with your provider every few seconds. It will only say
                paid once the provider confirms it.
              </p>
              <Button variant="outline" className="mt-3" onClick={() => verify()}>Check now</Button>
            </div>
          </div>
        </Card>
      )}

      {/* ── Pay ────────────────────────────────────────────────────────── */}
      {!paid && !waiting && reg.fee > 0 && (
        <Card pad="lg" className="mt-4">
          <h2 className="t-h2">Pay registration fee</h2>
          <p className="text-sm text-ink-2 mt-1">
            You&rsquo;ll get a prompt on this number to approve GHS {ghs2(reg.charged)}.
          </p>
          {state === 'failed' && note && <Notice tone="warn" className="mt-3">{note}</Notice>}

          <div className="grid gap-3 mt-4">
            <Field label="Mobile money number">
              {ids => (
                <Input {...ids}
                  value={number} onChange={e => setNumber(e.target.value)}
                  inputMode="tel" autoComplete="tel" placeholder="0244 123 456"
                />
              )}
            </Field>
            <Field label="Network">
              {ids => (
                <Select {...ids} value={network} onChange={e => setNetwork(e.target.value)}>
                  {NETWORKS.map(n => <option key={n} value={n}>{n}</option>)}
                </Select>
              )}
            </Field>
          </div>

          <Button
            className="w-full mt-4" icon={Smartphone}
            loading={busy} disabled={busy || number.trim().length < 10}
            onClick={pay}
          >
            Pay GHS {ghs2(reg.charged)}
          </Button>
        </Card>
      )}

      <p className="flex items-center justify-center gap-1.5 text-2xs text-ink-3 mt-5">
        <ShieldCheck size={12} strokeWidth={2.2} aria-hidden="true" />
        This link is personal to your application and expires
        {reg.link_expires ? ` on ${new Date(reg.link_expires).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}.
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-bg px-5 py-8">
      <div className="max-w-md mx-auto animate-fade-in">{children}</div>
    </div>
  )
}
