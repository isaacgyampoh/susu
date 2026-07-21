'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'

/*
 * Payment provider self-test. Shows which provider is live and lets the
 * admin fire a tiny real MoMo prompt to a phone to validate the mapping
 * before trusting live contributions.
 */
export default function PaymentSettingsPage() {
  const [status, setStatus]   = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [phone, setPhone]     = useState('')
  const [network, setNetwork] = useState('MTN')
  const [amount, setAmount]   = useState('1')
  const [firing, setFiring]   = useState(false)
  const [test, setTest]       = useState<any>(null)
  const [checking, setChecking] = useState(false)
  const [check, setCheck]     = useState<any>(null)

  async function loadStatus() {
    setLoading(true)
    const token = getAdminToken()
    const { data } = await callFunction<any>('admin-payment-test', {
      method: 'POST', token: token!, body: { action: 'status' },
    })
    setStatus(data)
    setLoading(false)
  }
  useEffect(() => { loadStatus() }, [])

  async function fire() {
    if (!phone.trim()) return
    setFiring(true); setCheck(null); setTest(null)
    const token = getAdminToken()
    const { data, error } = await callFunction<any>('admin-payment-test', {
      method: 'POST', token: token!,
      body: { action: 'prompt', phone: phone.trim(), network, amount: parseFloat(amount || '1') },
    })
    setFiring(false)
    if (error) { alert(error); return }
    setTest(data)
  }

  async function recheck() {
    if (!test?.reference) return
    setChecking(true)
    const token = getAdminToken()
    const { data } = await callFunction<any>('admin-payment-test', {
      method: 'POST', token: token!, body: { action: 'check', reference: test.order_id ?? test.reference },
    })
    setChecking(false)
    setCheck(data)
  }

  const field = "w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:border-ink"
  const live = status?.provider && status.provider !== 'none'

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 max-w-[640px] animate-fade-in">
      <h1 className="text-2xl font-extrabold text-ink mb-1">Payment Provider</h1>
      <p className="text-ink-2 text-sm mb-6">Confirm the live provider and test it with a small real prompt.</p>

      {loading ? <p className="text-ink-2">Checking…</p> : (
        <div className={`card p-5 border ${live ? 'border-green/40' : 'border-gold/50'}`}>
          <p className="t-label">Live provider</p>
          <p className="text-xl font-bold text-ink mt-1 capitalize">{status?.provider ?? 'none'}</p>
          <p className="text-sm text-ink-2 mt-2">{status?.note}</p>
        </div>
      )}

      {live && status?.provider !== 'paystack' && (
        <div className="card p-5 mt-5">
          <h2 className="font-semibold text-ink mb-1">Fire a test prompt</h2>
          <p className="text-xs text-ink-3 mb-4">
            Sends a real MoMo prompt (GHS 0.10–5). Use your own number to confirm credentials and field mapping.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-sm text-ink-2 mb-1.5">Phone (your own)</label>
              <input className={field} value={phone} onChange={e => setPhone(e.target.value)} placeholder="0244XXXXXX" />
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Network</label>
              <select className={field} value={network} onChange={e => setNetwork(e.target.value)}>
                <option value="MTN">MTN</option>
                <option value="VODAFONE">Telecel / Vodafone</option>
                <option value="AIRTELTIGO">AirtelTigo</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Amount (GHS)</label>
              <input className={field} type="number" min="0.1" max="5" step="0.1" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
          </div>
          <button onClick={fire} disabled={firing || !phone.trim()}
            className="mt-4 w-full py-3 bg-ink text-white font-bold rounded-[10px] hover:brightness-105 transition-all disabled:opacity-50">
            {firing ? 'Sending prompt…' : 'Send test prompt'}
          </button>

          {test && (
            <div className="mt-4 p-3 bg-tint border border-line rounded-[10px] text-sm">
              <p className="font-semibold text-ink">Result: {test.result?.kind}</p>
              {test.result?.kind === 'prompted' && <p className="text-ink-2 mt-1">Approve the prompt on your phone, then tap Re-check below.</p>}
              {test.result?.kind === 'otp_required' && <p className="text-ink-2 mt-1">{test.result.message}</p>}
              {test.result?.kind === 'failed' && <p className="text-red mt-1">{test.result.code}: {test.result.message}</p>}
              {test.result?.raw && (
                <pre className="mt-2 p-2 bg-white border border-line rounded text-[10px] text-ink-2 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(test.result.raw, null, 2)}</pre>
              )}
              <p className="text-[11px] text-ink-3 mt-2 font-mono break-all">ref: {test.reference}</p>
              <button onClick={recheck} disabled={checking}
                className="mt-2 px-3 py-1.5 border border-line rounded-[8px] text-xs font-semibold text-ink hover:bg-white transition-colors">
                {checking ? 'Checking…' : 'Re-check status'}
              </button>
              {check && (
                <p className="mt-2 text-xs text-ink-2">
                  Status: {check.status ? (check.status.settled ? '✅ settled' : check.status.pending ? '⏳ pending' : '❌ not settled') : 'no status yet'}
                  {check.status?.amount ? ` · GHS ${check.status.amount}` : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {live && status?.provider === 'paystack' && (
        <p className="text-sm text-ink-2 mt-5">Paystack uses a redirect checkout — test it from the member portal's pay flow.</p>
      )}
    </div>
  )
}
