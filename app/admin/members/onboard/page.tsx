'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { memberSignInUrl, credentialsMessage, whatsappLink } from '@/lib/member-link'
import type { SusuGroup } from '@/types'

/*
 * Onboard a member who was already running susu before this system.
 * The admin records what has ALREADY happened — amount paid so far, start
 * date, payout position/date — and the system backfills the ledger so the
 * member's balance and stamp card match reality from day one.
 * One member can be set up in several groups at once.
 */

type PlanForm = {
  group_id: string
  slots: string
  start_date: string
  amount_paid: string
  payout_position: string
  payout_date: string
  payout_amount: string
  payout_received: boolean
}

const emptyPlan = (): PlanForm => ({
  group_id: '', slots: '1', start_date: '', amount_paid: '',
  payout_position: '', payout_date: '', payout_amount: '', payout_received: false,
})

export default function OnboardMemberPage() {
  const router = useRouter()
  const [groups, setGroups]   = useState<SusuGroup[]>([])
  const [mode, setMode]       = useState<'existing' | 'new'>('existing')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [copied, setCopied]   = useState(false)

  // Existing-member search
  const [search, setSearch]       = useState('')
  const [searching, setSearching] = useState(false)
  const [matches, setMatches]     = useState<any[]>([])
  const [selected, setSelected]   = useState<any>(null)

  // New-member minimal details
  const [newMember, setNewMember] = useState({
    full_name: '', phone: '', ghana_card_number: '',
    mobile_money_number: '', mobile_money_provider: 'MTN', email: '',
  })

  const [plans, setPlans] = useState<PlanForm[]>([emptyPlan()])
  const [done, setDone]   = useState<any>(null)

  useEffect(() => {
    const token = getAdminToken()
    callFunction<{ groups: SusuGroup[] }>('groups-create', { token: token! })
      .then(({ data }) => setGroups(data?.groups ?? []))
  }, [])

  // Debounced member search
  useEffect(() => {
    if (mode !== 'existing' || search.trim().length < 2) { setMatches([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const token = getAdminToken()
      const { data } = await callFunction<{ members: any[] }>(
        `admin-members?status=all&search=${encodeURIComponent(search.trim())}`, { token: token! })
      setMatches(data?.members ?? [])
      setSearching(false)
    }, 350)
    return () => clearTimeout(t)
  }, [search, mode])

  const setPlan = (i: number, patch: Partial<PlanForm>) =>
    setPlans(p => p.map((pl, idx) => idx === i ? { ...pl, ...patch } : pl))

  const groupFor = (id: string) => groups.find(g => g.id === id)

  function daysPaid(plan: PlanForm): number | null {
    const g = groupFor(plan.group_id)
    const amt = parseFloat(plan.amount_paid)
    if (!g || !g.contribution_amount || isNaN(amt)) return null
    return Math.floor(amt / g.contribution_amount)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (mode === 'existing' && !selected) { setError('Search and select an existing member first.'); return }
    if (mode === 'new' && (!newMember.full_name || !newMember.phone || !newMember.ghana_card_number)) {
      setError('New member needs at least a full name, phone and Ghana Card number.'); return
    }
    for (const p of plans) {
      if (!p.group_id)   { setError('Every plan needs a group selected.'); return }
      if (!p.start_date) { setError('Every plan needs the date the member started contributing.'); return }
    }

    setLoading(true)
    const token = getAdminToken()
    const body: any = {
      plans: plans.map(p => ({
        group_id: p.group_id,
        slots: Math.max(1, parseInt(p.slots || '1')),
        start_date: p.start_date,
        amount_paid: parseFloat(p.amount_paid || '0'),
        payout_position: p.payout_position ? parseInt(p.payout_position) : undefined,
        payout_date: p.payout_date || undefined,
        payout_amount: p.payout_amount ? parseFloat(p.payout_amount) : undefined,
        payout_received: p.payout_received,
      })),
    }
    if (mode === 'existing') body.member_id = selected.id
    else body.new_member = newMember

    const { data, error: err } = await callFunction<any>('admin-onboard-member', {
      method: 'POST', body, token: token!,
    })
    setLoading(false)
    if (err) { setError(err); return }
    setDone(data)
  }

  // ── Success screen ──
  if (done) {
    const shareText = done.passcode
      ? credentialsMessage({
          full_name: done.member.full_name, member_id: done.member.member_id,
          phone: done.member.phone, passcode: done.passcode,
        })
      : ''
    return (
      <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 max-w-[640px] animate-fade-in">
        <p className="t-label">Onboarding complete</p>
        <h1 className="t-title mt-1.5">{done.member.full_name}</h1>
        <p className="t-meta mt-1">Their existing history has been written into the ledger.</p>

        <div className="card p-5 mt-6 space-y-4">
          {done.plans.map((p: any, i: number) => (
            <div key={i} className="border border-line rounded-[10px] p-4 text-sm">
              <p className="font-semibold text-ink mb-2">{p.group}</p>
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                <span className="text-ink-2">Recorded so far</span>
                <span className="text-right font-medium tnum">GHS {Number(p.amount_recorded).toLocaleString()}</span>
                <span className="text-ink-2">Backfilled days</span>
                <span className="text-right font-medium tnum">{p.contributions_backfilled}</span>
                {p.slots > 1 && (<><span className="text-ink-2">Slots</span>
                <span className="text-right font-medium">{p.slots} (positions {p.slot_details?.map((d: any) => `#${d.payout_position}`).join(', ')})</span></>)}
                <span className="text-ink-2">Payout position</span>
                <span className="text-right font-medium">#{p.payout_position}</span>
                <span className="text-ink-2">Payout date</span>
                <span className="text-right font-medium">{p.payout_date ?? '—'}</span>
                <span className="text-ink-2">Payout</span>
                <span className="text-right font-medium tnum">
                  GHS {Number(p.payout_amount ?? 0).toLocaleString()} {p.payout_received ? '(already received)' : ''}
                </span>
              </div>
            </div>
          ))}
        </div>

        {done.passcode && (
          <div className="card p-5 mt-4">
            <p className="t-h2 mb-3">New account — sign-in details</p>
            <div className="text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-ink-2">Portal link</span><span className="font-medium break-all">{memberSignInUrl()}</span></div>
              <div className="flex justify-between"><span className="text-ink-2">Phone</span><span className="font-medium tnum">{done.member.phone}</span></div>
              <div className="flex justify-between"><span className="text-ink-2">Passcode</span><span className="font-semibold tnum text-[18px] tracking-[.12em]">{done.passcode}</span></div>
              <div className="flex justify-between"><span className="text-ink-2">Member ID</span><span className="font-medium">{done.member.member_id}</span></div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <button onClick={() => window.open(whatsappLink(done.member.phone, shareText), '_blank')} className="btn-dark">Send on WhatsApp</button>
              <button onClick={() => { navigator.clipboard.writeText(shareText); setCopied(true); setTimeout(() => setCopied(false), 2000) }} className="btn-line">
                {copied ? 'Copied' : 'Copy message'}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-8 pt-6 border-t border-line">
          <button onClick={() => router.push(`/admin/members/${done.member.id}`)} className="btn-line btn-sm">View member</button>
          <button onClick={() => { setDone(null); setSelected(null); setSearch(''); setPlans([emptyPlan()]) }} className="btn-ghost btn-sm">Onboard another</button>
        </div>
      </div>
    )
  }

  const field = "w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"

  return (
    <div className="px-4 sm:px-8 lg:px-10 py-6 sm:py-7 pb-16 animate-fade-in">
      <Link href="/admin/members" className="flex items-center gap-2 text-ink-2 hover:text-ink text-sm mb-5 sm:mb-6 transition-colors">
        Back to Members
      </Link>

      <h1 className="text-xl sm:text-2xl font-extrabold text-ink mb-2">Onboard Existing Member</h1>
      <p className="text-ink-2 text-sm mb-6 sm:mb-8 max-w-[640px]">
        For members who were already contributing before this system. Record how much they have paid so far,
        when they started, and when their payout is due — across one or several groups.
      </p>

      {error && <div className="p-3 bg-tint border border-red/40 rounded-[10px] text-red text-sm mb-5">{error}</div>}

      <form onSubmit={handleSubmit} className="lg:grid lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)] lg:gap-6 lg:items-start">

        {/* ── Who ── */}
        <div className="border border-line rounded-[10px] p-4 sm:p-6 lg:sticky lg:top-6 mb-6 lg:mb-0">
          <h2 className="font-semibold text-ink mb-3 text-sm">Member</h2>

          <div className="flex flex-wrap gap-2 mb-4">
            {(['existing', 'new'] as const).map(m => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`px-4 py-2 rounded-[10px] text-sm font-semibold transition-all ${
                  mode === m ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink border border-line'}`}>
                {m === 'existing' ? 'Already in the system' : 'Not in the system yet'}
              </button>
            ))}
          </div>

          {mode === 'existing' ? (
            selected ? (
              <div className="flex items-center justify-between p-3 bg-tint border border-line rounded-[10px]">
                <div>
                  <p className="text-sm font-semibold text-ink">{selected.full_name}</p>
                  <p className="text-xs text-ink-2">{selected.member_id} · {selected.phone}</p>
                </div>
                <button type="button" onClick={() => { setSelected(null); setSearch('') }}
                  className="text-xs text-ink-2 hover:text-red">Change</button>
              </div>
            ) : (
              <div>
                <input className={field} placeholder="Search by name, phone or member ID…"
                  value={search} onChange={e => setSearch(e.target.value)} />
                {searching && <p className="text-xs text-ink-3 mt-2">Searching…</p>}
                {matches.length > 0 && (
                  <div className="mt-2 border border-line rounded-[10px] divide-y divide-line overflow-hidden">
                    {matches.slice(0, 8).map(m => (
                      <button key={m.id} type="button" onClick={() => setSelected(m)}
                        className="w-full text-left px-4 py-2.5 hover:bg-tint transition-colors">
                        <span className="text-sm font-medium text-ink">{m.full_name}</span>
                        <span className="text-xs text-ink-2 ml-2">{m.member_id} · {m.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!searching && search.trim().length >= 2 && matches.length === 0 && (
                  <p className="text-xs text-ink-3 mt-2">No members match — switch to “Not in the system yet” to create them.</p>
                )}
              </div>
            )
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-1 gap-4">
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Full Name *</label>
                <input required className={field} value={newMember.full_name}
                  onChange={e => setNewMember(p => ({ ...p, full_name: e.target.value }))} placeholder="As on Ghana Card" />
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Phone * <span className="text-ink-3">(used to login)</span></label>
                <input required type="tel" className={field} value={newMember.phone}
                  onChange={e => setNewMember(p => ({ ...p, phone: e.target.value }))} placeholder="0244XXXXXX" />
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Ghana Card Number *</label>
                <input required className={field} value={newMember.ghana_card_number}
                  onChange={e => setNewMember(p => ({ ...p, ghana_card_number: e.target.value }))} placeholder="GHA-XXXXXXXXX-X" />
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">Email</label>
                <input type="email" className={field} value={newMember.email}
                  onChange={e => setNewMember(p => ({ ...p, email: e.target.value }))} placeholder="Optional" />
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">MoMo Provider</label>
                <select className={field} value={newMember.mobile_money_provider}
                  onChange={e => setNewMember(p => ({ ...p, mobile_money_provider: e.target.value }))}>
                  <option value="MTN">MTN Mobile Money</option>
                  <option value="Vodafone">Vodafone Cash</option>
                  <option value="AirtelTigo">AirtelTigo Money</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-ink-2 mb-1.5">MoMo Number</label>
                <input type="tel" className={field} value={newMember.mobile_money_number}
                  onChange={e => setNewMember(p => ({ ...p, mobile_money_number: e.target.value }))} placeholder="0244XXXXXX" />
              </div>
            </div>
          )}
        </div>

        {/* ── Plans (right column on desktop) ── */}
        <div className="space-y-5 sm:space-y-6">
        {plans.map((plan, i) => {
          const g = groupFor(plan.group_id)
          const days = daysPaid(plan)
          return (
            <div key={i} className="border border-line rounded-[10px] p-4 sm:p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink text-sm">Group {plans.length > 1 ? i + 1 : ''} — existing progress</h2>
                {plans.length > 1 && (
                  <button type="button" onClick={() => setPlans(p => p.filter((_, idx) => idx !== i))}
                    className="text-xs text-ink-2 hover:text-red">Remove</button>
                )}
              </div>

              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                <div className="sm:col-span-2 xl:col-span-3">
                  <label className="block text-sm text-ink-2 mb-1.5">Susu Group *</label>
                  <select required className={field} value={plan.group_id}
                    onChange={e => {
                      const gg = groupFor(e.target.value)
                      setPlan(i, { group_id: e.target.value,
                        payout_amount: gg?.cashout_amount ? String(gg.cashout_amount) : plan.payout_amount })
                    }}>
                    <option value="">Select group…</option>
                    {groups
                      .filter(gr => gr.id === plan.group_id || !plans.some((p2, i2) => i2 !== i && p2.group_id === gr.id))
                      .map(gr => (
                        <option key={gr.id} value={gr.id}>
                          {gr.name} — GHS {gr.contribution_amount}/{gr.contribution_frequency} · {gr.current_members}/{gr.max_members} members
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-ink-2 mb-1.5">Slots in this group</label>
                  <input type="number" min="1" max="10" className={field}
                    value={plan.slots} onChange={e => setPlan(i, { slots: e.target.value })} />
                  {parseInt(plan.slots || '1') > 1 && (
                    <p className="text-xs text-ink-3 mt-1.5">
                      Amount paid is split across {plan.slots} slots. Payout date/position apply to the first slot — set the others from the member's page after.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-ink-2 mb-1.5">Date they started contributing *</label>
                  <input required type="date" className={field} max={new Date().toISOString().split('T')[0]}
                    value={plan.start_date} onChange={e => setPlan(i, { start_date: e.target.value })} />
                </div>

                <div>
                  <label className="block text-sm text-ink-2 mb-1.5">Amount paid so far (GHS)</label>
                  <input type="number" min="0" step="0.01" className={field}
                    value={plan.amount_paid} onChange={e => setPlan(i, { amount_paid: e.target.value })} placeholder="0.00" />
                  {days !== null && g && (
                    <p className="text-xs text-ink-3 mt-1.5">
                      ≈ {days} day{days === 1 ? '' : 's'} of GHS {g.contribution_amount} — will be backfilled as paid from the start date.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-ink-2 mb-1.5">Payout position <span className="text-ink-3">(blank = next free slot)</span></label>
                  <input type="number" min="1" className={field}
                    value={plan.payout_position} onChange={e => setPlan(i, { payout_position: e.target.value })} placeholder="e.g. 4" />
                </div>

                <div>
                  <label className="block text-sm text-ink-2 mb-1.5">Payout date</label>
                  <input type="date" className={field}
                    value={plan.payout_date} onChange={e => setPlan(i, { payout_date: e.target.value })} />
                  <p className="text-xs text-ink-3 mt-1.5">Pending contributions are scheduled up to this date.</p>
                </div>

                <div>
                  <label className="block text-sm text-ink-2 mb-1.5">Payout amount (GHS)</label>
                  <input type="number" min="0" step="0.01" className={field}
                    value={plan.payout_amount} onChange={e => setPlan(i, { payout_amount: e.target.value })}
                    placeholder={g?.cashout_amount ? String(g.cashout_amount) : '0.00'} />
                </div>

                <label className="flex items-center gap-2 cursor-pointer sm:col-span-2 xl:col-span-3">
                  <input type="checkbox" checked={plan.payout_received}
                    onChange={e => setPlan(i, { payout_received: e.target.checked })}
                    className="w-4 h-4 accent-green" />
                  <span className="text-sm text-ink">This member has already received this payout</span>
                </label>
              </div>
            </div>
          )
        })}

        <button type="button" onClick={() => setPlans(p => [...p, emptyPlan()])}
          className="w-full py-3 border-2 border-dashed border-line rounded-[10px] text-sm font-semibold text-ink-2 hover:border-ink hover:text-ink transition-colors">
          + Add another group for this member
        </button>

        <button type="submit" disabled={loading}
          className="w-full py-3.5 bg-ink text-white font-bold rounded-[10px] hover:brightness-105 transition-all active:scale-95 disabled:opacity-50">
          {loading ? 'Onboarding…' : 'Onboard Member with Existing History'}
        </button>
        </div>
      </form>
    </div>
  )
}
