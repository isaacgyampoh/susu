'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { SusuGroup } from '@/types'
import { format } from 'date-fns'
export default function GroupsPage() {
  const [groups, setGroups]   = useState<SusuGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState<string | null>(null)
  const [activateErr, setActivateErr] = useState('')
  const [allowPast, setAllowPast]     = useState(false)
  const [editMode, setEditMode]       = useState(false)      // correcting an active group's date
  const [recompute, setRecompute]     = useState(true)
  const [notifySms, setNotifySms]     = useState(true)
  const [startDate, setStartDate]   = useState('')
  const [activateTarget, setActivateTarget] = useState<SusuGroup | null>(null)
  const [toast, setToast]     = useState('')

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(''), 4000) }

  async function load() {
    setLoading(true)
    const token = getAdminToken()
    const { data } = await callFunction<{ groups: SusuGroup[] }>('groups-create', { token: token! })
    setGroups(data?.groups ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function activateGroup(force = false) {
    if (!activateTarget || !startDate) { setActivateErr('Please set a start date'); return }
    const isPast = startDate < new Date().toISOString().split('T')[0]
    if (isPast && !allowPast) { setActivateErr('This date is in the past — tick the backdating confirmation below to continue.'); return }
    setActivating(activateTarget.id)
    setActivateErr('')
    const token = getAdminToken()
    const { error } = await callFunction('groups-activate', {
      method: 'POST', body: { group_id: activateTarget.id, start_date: startDate, force: force || editMode, allow_past: allowPast, recompute_payouts: editMode ? recompute : undefined, notify: editMode ? notifySms : true }, token: token!,
    })
    setActivating(null)
    if (error) { setActivateErr(error); return }
    showToast('Group activated! Contribution schedule generated and members notified via SMS.')
    setActivateTarget(null)
    load()
  }

  function statusBadge(s: string) {
    const map: Record<string, string> = { open: 'badge-blue', full: 'badge-gold', active: 'badge-green', completed: 'badge-gray' }
    return <span className={map[s] ?? 'badge-gray'}>{s}</span>
  }

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      {toast && <div className="fixed top-4 right-4 z-50 bg-paper text-ink px-5 py-3 rounded-[10px]  text-sm">{toast}</div>}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Groups</h1>
          <p className="text-ink-2 text-sm mt-1">{groups.length} susu groups</p>
        </div>
        <Link href="/admin/groups/new" className="flex items-center gap-2 px-4 py-2.5 bg-ink text-white font-semibold rounded-[10px] text-sm hover:brightness-105 transition-colors">
          New Group
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">Loading…</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {groups.map(g => {
            const payoutEst = Number(g.contribution_amount) * g.max_members * g.cycle_days
            return (
              <div key={g.id} className="border border-line rounded-[10px] p-5 flex flex-col hover:border-line transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-bold text-ink leading-tight">{g.name}</h3>
                  {statusBadge(g.status)}
                </div>

                <div className="space-y-2 flex-1 text-sm">
                  <div className="flex justify-between text-ink-2">
                    <span>Contribution</span>
                    <span className="text-ink font-medium">GHS {g.contribution_amount}/{g.contribution_frequency}</span>
                  </div>
                  <div className="flex justify-between text-ink-2">
                    <span>Payout per member</span>
                    <span className="text-ink font-bold">GHS {payoutEst.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-ink-2">
                    <span>Members</span>
                    <span className="text-ink">{g.current_members}/{g.max_members}</span>
                  </div>
                  <div className="flex justify-between text-ink-2">
                    <span>Cycle</span>
                    <span className="text-ink">{g.cycle_days} days</span>
                  </div>
                  <div className="flex justify-between text-ink-2">
                    <span>Reg. fee</span>
                    <span className="text-ink">GHS {g.registration_fee}</span>
                  </div>
                  {g.start_date && (
                    <div className="flex justify-between text-ink-2">
                      <span>Started</span>
                      <span className="text-ink">{format(new Date(g.start_date), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                </div>

                {/* Progress bar */}
                <div className="mt-4 mb-4">
                  <div className="flex justify-between text-xs text-ink-2 mb-1">
                    <span>Members filled</span>
                    <span>{g.current_members}/{g.max_members}</span>
                  </div>
                  <div className="h-1.5 bg-tint rounded-[10px] overflow-hidden">
                    <div className="h-full bg-ink rounded-[10px] transition-all" style={{ width: `${(g.current_members / g.max_members) * 100}%` }} />
                  </div>
                </div>

                {/* Activate button — only show for full/open groups */}
                {(g.status === 'full' || g.status === 'open') && g.current_members > 0 && (
                  <button onClick={() => { setActivateTarget(g); setEditMode(false); setStartDate((g as any).start_date ?? ''); setActivateErr(''); setAllowPast(false); setRecompute(true); setNotifySms(true) }}
                    className="flex items-center justify-center gap-2 w-full py-2.5 bg-ink text-white font-semibold rounded-[10px] text-sm transition-colors">
                    Activate Group
                  </button>
                )}
                {(g.status === 'full' || g.status === 'open') && (
                  <p className="text-[11px] text-ink-3 text-center mt-1.5">
                    {g.current_members > 0
                      ? 'Started before this system? You can pick a past date when activating.'
                      : 'Set the real start date (past is fine) in Edit group — then add members and activate.'}
                  </p>
                )}
                <Link href={`/admin/groups/${g.id}/edit`}
                  className="btn-line btn-sm w-full mb-2">Edit group</Link>

                {g.status === 'completed' && (
                  <p className="text-[11px] text-ink-3 text-center py-2">Completed — schedule and dates are locked.</p>
                )}
                {g.status === 'active' && (
                  <div className="flex items-center justify-center gap-2 text-ink text-sm py-2">
                    Running since {g.start_date ? format(new Date(g.start_date), 'MMM d, yyyy') : '—'}
                    <button onClick={() => { setActivateTarget(g); setEditMode(true); setStartDate(g.start_date ?? ''); setActivateErr(''); setAllowPast(false); setRecompute(true); setNotifySms(false) }}
                      className="text-xs text-ink-2 underline underline-offset-2 hover:text-ink transition-colors">
                      change date
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Activate modal */}
      {activateTarget && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setActivateTarget(null)}>
          <div className="bg-white border border-line rounded-[10px] w-full max-w-md p-6 space-y-4 animate-slide-up shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-ink text-lg">{editMode ? 'Change start date' : 'Activate'}: {activateTarget.name}</h2>
            <p className="text-ink-2 text-sm">
              {editMode
                ? 'Fix a wrongly entered start date. Paid days are kept; the pending schedule is rebuilt from the new date.'
                : `This will generate the full contribution schedule and payout dates for all ${activateTarget.current_members} members.`}
            </p>
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Start Date *</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-ink"
              />
              <p className="text-xs text-ink-3 mt-1.5">The day the group actually started — past dates are allowed for groups that were already running before this system.</p>
            </div>
            {startDate && (
              <div className="p-3 bg-tint border border-line rounded-[10px] text-sm text-ink-2">
                Group runs from <strong>{format(new Date(startDate), 'MMM d')}</strong> to <strong>{format(new Date(new Date(startDate).getTime() + activateTarget.max_members * activateTarget.cycle_days * 86400000), 'MMM d, yyyy')}</strong>
              </div>
            )}
            {startDate && startDate < new Date().toISOString().split('T')[0] && (
              <div className="p-3 bg-tint border border-gold/50 rounded-[10px] space-y-2">
                <p className="text-sm font-semibold text-ink">Backdating to {format(new Date(startDate), 'MMM d, yyyy')}</p>
                <p className="text-xs text-ink-2 leading-relaxed">
                  Each member's schedule starts from the later of this date and the day they joined.
                  Days already recorded as paid (from onboarding) are kept. Unpaid past days become arrears.
                  Payout dates you've already set on members are preserved.
                  Onboard existing members' history <strong>before</strong> activating, so they aren't shown owing days they already paid.
                </p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={allowPast} onChange={e => setAllowPast(e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-green" />
                  <span className="text-xs font-medium text-ink">This group genuinely started on this date — generate the schedule from then</span>
                </label>
              </div>
            )}
            {editMode && (
              <div className="space-y-2.5">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={recompute} onChange={e => setRecompute(e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-green" />
                  <span className="text-xs text-ink leading-relaxed">
                    <strong>Recompute payout dates</strong> from the new start date and positions.
                    Untick to keep every member's current payout date and only shift the daily schedule.
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={notifySms} onChange={e => setNotifySms(e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-green" />
                  <span className="text-xs text-ink">Send SMS to members about their (new) payout date</span>
                </label>
              </div>
            )}
            {activateErr && (
              <div className="p-3 rounded-[3px] border border-red-200 bg-red-50">
                <p className="text-[12px] text-red-700 font-medium">{activateErr}</p>
                {activateErr.includes('already active') && (
                  <button onClick={() => activateGroup(true)}
                    className="text-[11px] font-bold text-red-700 underline underline-offset-2 mt-2">
                    Rebuild the schedule anyway
                  </button>
                )}
              </div>
            )}

            <button onClick={() => activateGroup(false)} disabled={!!activating || !startDate || (startDate < new Date().toISOString().split('T')[0] && !allowPast)}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-ink text-white font-bold rounded-[10px] transition-colors disabled:opacity-50">
              {activating ? (editMode ? 'Rebuilding…' : 'Activating…')
                : (startDate && startDate < new Date().toISOString().split('T')[0] && !allowPast)
                  ? 'Tick the backdating confirmation above to continue'
                : editMode ? 'Change start date & rebuild schedule' : 'Activate & Notify Members'}
            </button>
            <button onClick={() => setActivateTarget(null)} className="w-full text-ink-2 text-sm hover:text-ink transition-colors py-2">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
