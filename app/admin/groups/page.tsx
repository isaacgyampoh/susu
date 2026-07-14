'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { SusuGroup } from '@/types'
import { format } from 'date-fns'
import { Loader2, Plus, Play, Users } from 'lucide-react'

export default function GroupsPage() {
  const [groups, setGroups]   = useState<SusuGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState<string | null>(null)
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

  async function activateGroup() {
    if (!activateTarget || !startDate) { alert('Please set a start date'); return }
    setActivating(activateTarget.id)
    const token = getAdminToken()
    const { error } = await callFunction('groups-activate', {
      method: 'POST', body: { group_id: activateTarget.id, start_date: startDate }, token: token!,
    })
    setActivating(null)
    if (error) { alert(error); return }
    showToast('✅ Group activated! Contribution schedule generated and members notified via SMS.')
    setActivateTarget(null)
    load()
  }

  function statusBadge(s: string) {
    const map: Record<string, string> = { open: 'badge-blue', full: 'badge-gold', active: 'badge-green', completed: 'badge-gray' }
    return <span className={map[s] ?? 'badge-gray'}>{s}</span>
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto pb-12 animate-fade-in">
      {toast && <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm">{toast}</div>}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Groups</h1>
          <p className="text-gray-400 text-sm mt-1">{groups.length} susu groups</p>
        </div>
        <Link href="/admin/groups/new" className="flex items-center gap-2 px-4 py-2.5 bg-brand-gold text-brand-green font-semibold rounded-xl text-sm hover:bg-amber-400 transition-colors">
          <Plus size={16} /> New Group
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-gold" size={32} /></div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {groups.map(g => {
            const payoutEst = Number(g.contribution_amount) * g.max_members * g.cycle_days
            return (
              <div key={g.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col hover:border-gray-600 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-bold text-white leading-tight">{g.name}</h3>
                  {statusBadge(g.status)}
                </div>

                <div className="space-y-2 flex-1 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Contribution</span>
                    <span className="text-white font-medium">GHS {g.contribution_amount}/{g.contribution_frequency}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Payout per member</span>
                    <span className="text-brand-gold font-bold">GHS {payoutEst.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Members</span>
                    <span className="text-white">{g.current_members}/{g.max_members}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Cycle</span>
                    <span className="text-white">{g.cycle_days} days</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Reg. fee</span>
                    <span className="text-white">GHS {g.registration_fee}</span>
                  </div>
                  {g.start_date && (
                    <div className="flex justify-between text-gray-400">
                      <span>Started</span>
                      <span className="text-white">{format(new Date(g.start_date), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                </div>

                {/* Progress bar */}
                <div className="mt-4 mb-4">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Members filled</span>
                    <span>{g.current_members}/{g.max_members}</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-gold rounded-full transition-all" style={{ width: `${(g.current_members / g.max_members) * 100}%` }} />
                  </div>
                </div>

                {/* Activate button — only show for full/open groups */}
                {(g.status === 'full' || g.status === 'open') && g.current_members > 0 && (
                  <button onClick={() => { setActivateTarget(g); setStartDate('') }}
                    className="flex items-center justify-center gap-2 w-full py-2.5 bg-brand-green hover:bg-brand-green-mid text-white font-semibold rounded-xl text-sm transition-colors">
                    <Play size={14} /> Activate Group
                  </button>
                )}
                {g.status === 'active' && (
                  <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm py-2">
                    <Users size={14} /> Running since {g.start_date ? format(new Date(g.start_date), 'MMM d, yyyy') : '—'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Activate modal */}
      {activateTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setActivateTarget(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-white text-lg">Activate: {activateTarget.name}</h2>
            <p className="text-gray-400 text-sm">
              This will generate the full contribution schedule and payout dates for all {activateTarget.current_members} members, and notify them via SMS.
            </p>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Start Date *</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            {startDate && (
              <div className="p-3 bg-brand-green/20 border border-brand-green/30 rounded-xl text-sm text-green-300">
                Group runs from <strong>{format(new Date(startDate), 'MMM d')}</strong> to <strong>{format(new Date(new Date(startDate).getTime() + activateTarget.max_members * activateTarget.cycle_days * 86400000), 'MMM d, yyyy')}</strong>
              </div>
            )}
            <button onClick={activateGroup} disabled={!!activating || !startDate}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-brand-green hover:bg-brand-green-mid text-white font-bold rounded-xl transition-colors disabled:opacity-50">
              {activating ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
              Activate & Notify Members
            </button>
            <button onClick={() => setActivateTarget(null)} className="w-full text-gray-500 text-sm hover:text-gray-300 transition-colors py-2">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
