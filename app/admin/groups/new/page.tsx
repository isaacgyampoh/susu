'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, getAdminToken } from '@/lib/supabase'
import Link from 'next/link'

export default function NewGroupPage() {
  const router  = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [form, setForm] = useState({
    name: '', description: '',
    contribution_amount: '', contribution_frequency: 'daily',
    cycle_days: '', max_members: '',
    registration_fee: '110',
    cashout_amount: '',           // admin manually sets this
    payment_deadline: '18:00',
    penalty_per_late_day: '',
    s: '', admin_notes: '',
  })

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  /*
   * One turn at a time. Everyone pays for the length of a turn, and exactly ONE
   * member collects at the end of it. Comparing a turn's collection against
   * every member's payout is the mistake — it makes a sound group look
   * catastrophic.
   *
   * None of this decides the cashout. It shows the pool you are deciding from.
   */
  const n     = parseInt(form.max_members) || 0
  const days  = parseInt(form.cycle_days) || 0
  const rate  = parseFloat(form.contribution_amount) || 0
  const cash  = parseFloat(form.cashout_amount) || 0
  const fee   = parseFloat(form.registration_fee) || 0

  const perTurnCollected = rate && n && days ? rate * n * days : null
  const perTurnMargin    = perTurnCollected !== null && cash ? perTurnCollected - cash : null
  const rotationMargin   = perTurnMargin !== null ? perTurnMargin * n : null
  const commission       = fee * n
  const pool             = perTurnCollected

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.cashout_amount) { setError('Please set the cashout amount members will receive.'); return }
    setLoading(true)
    setError('')
    const token = getAdminToken()
    const { error: err } = await callFunction('groups-create', {
      method: 'POST', body: form, token: token!,
    })
    setLoading(false)
    if (err) { setError(err); return }
    router.push('/admin/groups')
  }

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <Link href="/admin/groups" className="flex items-center gap-2 text-ink-2 hover:text-ink text-sm mb-6 transition-colors">
        Back to Groups
      </Link>
      <h1 className="text-2xl font-extrabold text-ink mb-1">Create New Susu Group</h1>
      <p className="text-ink-2 text-sm mb-8">You set everything — contribution, cashout, deadline, penalty. Members see the cashout amount only.</p>

      {error && <div className="p-3 bg-tint border border-red/40 rounded-[10px] text-red text-sm mb-5">{error}</div>}

      <form onSubmit={handleSubmit} className="border border-line rounded-[10px] p-6 space-y-5">

        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm text-ink-2 mb-1.5">Group Name *</label>
            <input className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
              required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Gold Circle – Daily 55" />
          </div>

          <div>
            <label className="block text-sm text-ink-2 mb-1.5">Daily Contribution (GHS) *</label>
            <input className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
              required type="number" min="1" step="0.01" value={form.contribution_amount}
              onChange={e => set('contribution_amount', e.target.value)} placeholder="55.00" />
          </div>

          <div>
            <label className="block text-sm text-ink-2 mb-1.5">Frequency</label>
            <select className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
              value={form.contribution_frequency} onChange={e => set('contribution_frequency', e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-ink-2 mb-1.5">Number of Members *</label>
            <input className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
              required type="number" min="2" value={form.max_members}
              onChange={e => set('max_members', e.target.value)} placeholder="11" />
          </div>

          <div>
            <label className="block text-sm text-ink-2 mb-1.5">Cycle Days (per member) *</label>
            <input className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
              required type="number" min="1" value={form.cycle_days}
              onChange={e => set('cycle_days', e.target.value)} placeholder="30" />
          </div>

          <div>
            <label className="block text-sm text-ink-2 mb-1.5">Registration Fee (GHS) *</label>
            <input className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
              required type="number" min="0" step="0.01" value={form.registration_fee}
              onChange={e => set('registration_fee', e.target.value)} placeholder="110.00" />
          </div>

          <div>
            <label className="block text-sm text-ink-2 mb-1.5">Payment Deadline</label>
            <input type="time" className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
              value={form.payment_deadline} onChange={e => set('payment_deadline', e.target.value)} />
            <p className="text-xs text-ink-2 mt-1">Payments after this time are flagged as LATE</p>
          </div>

          <div>
            <label className="block text-sm text-ink-2 mb-1.5">Late Penalty per Day (GHS)</label>
            <input className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
              type="number" min="0" step="0.01" value={form.penalty_per_late_day}
              onChange={e => set('penalty_per_late_day', e.target.value)} placeholder="0.00" />
          </div>
        </div>

        {/* The pool you are deciding from. Never a suggested payout. */}
        {pool !== null && (
          <div className="p-4 bg-tint border border-line rounded-lg">
            <p className="t-label mb-3">One turn — {days} days</p>
            <table className="w-full">
              <tbody className="divide-y divide-line border-y border-line">
                <tr>
                  <td className="py-2 text-[12.5px] text-ink-2">
                    The group collects
                    <span className="block text-[11px] text-ink-3 tnum">
                      {rate} × {n} members × {days} days
                    </span>
                  </td>
                  <td className="py-2 text-right text-[13.5px] font-medium tnum align-top">GHS {pool.toLocaleString()}</td>
                </tr>
                {cash > 0 && (
                  <>
                    <tr>
                      <td className="py-2 text-[12.5px] text-ink-2">
                        One member collects
                        <span className="block text-[11px] text-ink-3">the cashout you set</span>
                      </td>
                      <td className="py-2 text-right text-[13.5px] font-medium tnum align-top">−GHS {cash.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-[12.5px] font-medium">Left, per turn</td>
                      <td className={`py-2 text-right text-[14px] font-semibold tnum ${perTurnMargin !== null && perTurnMargin < 0 ? 'text-red' : ''}`}>
                        GHS {(perTurnMargin ?? 0).toLocaleString()}
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>

            {cash > 0 && (
              <>
                <p className="t-label mt-5 mb-3">Full rotation — {n} turns, {days * n} days</p>
                <table className="w-full">
                  <tbody className="divide-y divide-line border-y border-line">
                    <tr>
                      <td className="py-2 text-[12.5px] text-ink-2">
                        From contributions
                        <span className="block text-[11px] text-ink-3 tnum">{(perTurnMargin ?? 0).toLocaleString()} × {n} turns</span>
                      </td>
                      <td className="py-2 text-right text-[13.5px] font-medium tnum align-top">GHS {(rotationMargin ?? 0).toLocaleString()}</td>
                    </tr>
                    {commission > 0 && (
                      <tr>
                        <td className="py-2 text-[12.5px] text-ink-2">
                          Registration commission
                          <span className="block text-[11px] text-ink-3 tnum">{fee} × {n} members</span>
                        </td>
                        <td className="py-2 text-right text-[13.5px] font-medium tnum align-top">GHS {commission.toLocaleString()}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="py-2 text-[12.5px] font-medium">Total to you</td>
                      <td className="py-2 text-right text-[15px] font-semibold tnum">
                        GHS {((rotationMargin ?? 0) + commission).toLocaleString()}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}

            {perTurnMargin !== null && perTurnMargin < 0 && (
              <p className="text-[12px] text-red mt-3">
                The cashout is GHS {Math.abs(perTurnMargin).toLocaleString()} more than a turn collects.
                You would lose money on every turn.
              </p>
            )}
            <p className="text-[11.5px] text-ink-3 mt-3">
              The cashout is yours to decide — nothing here calculates it.
            </p>
          </div>
        )}

        {/* CASHOUT AMOUNT — the key field */}
        <div className="p-4 bg-tint border border-line rounded-[10px]">
          <label className="block text-sm font-semibold text-ink-2 mb-1.5">
            Member Cashout Amount (GHS) * — this is what members will receive and see
          </label>
          <input className="w-full px-4 py-3 bg-tint border border-ink text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink text-lg font-bold"
            required type="number" min="1" step="0.01" value={form.cashout_amount}
            onChange={e => set('cashout_amount', e.target.value)} placeholder="16430.00" />
          <p className="text-xs text-ink-2 mt-2">
            This is exactly what the member receives and sees. The registration fee is
            your commission and is kept separate — it is never added to this figure.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm text-ink-2 mb-1.5">Description (shown to public)</label>
          <input className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
            value={form.description} onChange={e => set('description', e.target.value)} placeholder="Short description for the plans page" />
        </div>

        <div>
          <label className="block text-sm text-ink-2 mb-1.5">Additional Rules (optional)</label>
          <textarea className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink resize-none"
            rows={2} value={form.s} onChange={e => set('s', e.target.value)} placeholder="Any group-specific s…" />
        </div>

        <div>
          <label className="block text-sm text-ink-2 mb-1.5">Admin Notes (private — not shown to members)</label>
          <textarea className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink resize-none"
            rows={2} value={form.admin_notes} onChange={e => set('admin_notes', e.target.value)} placeholder="Internal notes, cut calculations, etc." />
        </div>

        <button type="submit" disabled={loading}
          className="w-full py-3.5 bg-ink text-white font-bold rounded-[10px] hover:brightness-105 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? '…' : 'Create Group'}
        </button>
      </form>
    </div>
  )
}
