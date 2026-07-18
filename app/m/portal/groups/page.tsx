'use client'
import { useEffect, useState } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard, SusuGroup } from '@/types'

/*
 * Browse every open susu group and join more of them. A member already in
 * one group can tick two or three others and join them all in one go —
 * each becomes its own plan on their dashboard.
 */

const n0 = (v: any) => Number(v ?? 0).toLocaleString('en-GH')

export default function BrowseGroups() {
  const [groups, setGroups]   = useState<SusuGroup[]>([])
  const [mine, setMine]       = useState<Set<string>>(new Set())
  const [picked, setPicked]   = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError]     = useState('')
  const [result, setResult]   = useState<any>(null)

  async function load() {
    setLoading(true)
    const [{ data: pub }, { data: me }] = await Promise.all([
      callFunction<{ groups: SusuGroup[] }>('groups-public'),
      callFunction<MemberDashboard>('member-profile', { token: getMemberToken()! }),
    ])
    setGroups(pub?.groups ?? [])
    setMine(new Set((me?.plans ?? []).map(p => p.susu_groups?.id).filter(Boolean) as string[]))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const toggle = (id: string) =>
    setPicked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  async function join() {
    setJoining(true); setError('')
    const { data, error: err } = await callFunction<any>('member-join-group', {
      method: 'POST', body: { group_ids: Array.from(picked) }, token: getMemberToken()!,
    })
    setJoining(false)
    if (err) { setError(err); return }
    setResult(data)
    setPicked(new Set())
    load()
  }

  if (loading) return <div className="grid place-items-center h-[70vh]">Loading…</div>

  const pickedGroups = groups.filter(g => picked.has(g.id))
  const totalFees    = pickedGroups.reduce((s, g) => s + Number(g.registration_fee || 0), 0)

  return (
    <div className="max-w-[420px] mx-auto px-5 pt-8 animate-fade-in">
      <p className="t-label">Susu groups</p>
      <h1 className="t-title mt-1.5">Join more groups</h1>
      <p className="t-meta mt-1">
        Pick one or several — each becomes its own plan with its own payout turn.
      </p>

      {result && (
        <div className="card p-4 mt-5 border border-line">
          <p className="text-sm font-semibold text-ink mb-2">{result.message} 🎉</p>
          {result.joined.map((j: any, i: number) => (
            <p key={i} className="text-[12.5px] text-ink-2">
              {j.group} — payout position #{j.payout_position}
              {j.registration_fee > 0 && <> · registration fee GHS {n0(j.registration_fee)} to be paid</>}
            </p>
          ))}
          {result.failed?.map((f: any, i: number) => (
            <p key={`f${i}`} className="text-[12.5px] text-red mt-1">{f.group ?? 'A group'}: {f.reason}</p>
          ))}
          <button onClick={() => setResult(null)} className="text-[12px] text-ink-3 hover:text-ink mt-2">Dismiss</button>
        </div>
      )}

      {error && <div className="p-3 mt-5 bg-tint border border-red/40 rounded-[10px] text-red text-sm">{error}</div>}

      <div className="space-y-3 mt-5 pb-32">
        {groups.map(g => {
          const joined  = mine.has(g.id)
          const full    = g.current_members >= g.max_members
          const checked = picked.has(g.id)
          const canPick = !joined && !full
          return (
            <label key={g.id}
              className={`block card p-4 transition-all ${
                joined ? 'opacity-70' : full ? 'opacity-50' : 'cursor-pointer'} ${
                checked ? 'border border-ink' : 'border border-line'}`}>
              <div className="flex items-start gap-3">
                {canPick && (
                  <input type="checkbox" className="w-4 h-4 mt-1 accent-green"
                    checked={checked} onChange={() => toggle(g.id)} />
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[15px] font-semibold text-ink">{g.name}</p>
                    {joined && <span className="badge-green text-[11px]">Joined</span>}
                    {!joined && full && <span className="badge-gold text-[11px]">Full</span>}
                  </div>
                  <p className="text-[12.5px] text-ink-2 mt-1">
                    GHS {n0(g.contribution_amount)} {g.contribution_frequency} · Cashout GHS {n0(g.cashout_amount)}
                  </p>
                  <p className="text-[12px] text-ink-3 mt-0.5">
                    {g.current_members}/{g.max_members} members
                    {Number(g.registration_fee) > 0 && <> · Reg. fee GHS {n0(g.registration_fee)}</>}
                  </p>
                  {g.description && <p className="text-[12px] text-ink-3 mt-1.5">{g.description}</p>}
                </div>
              </div>
            </label>
          )
        })}
        {groups.length === 0 && (
          <p className="t-meta text-center py-10">No groups are open for joining right now.</p>
        )}
      </div>

      {/* Sticky join bar */}
      {picked.size > 0 && (
        <div className="fixed bottom-24 inset-x-0 z-30 px-5">
          <div className="max-w-[420px] mx-auto">
            <button onClick={join} disabled={joining}
              className="w-full py-3.5 bg-ink text-white font-bold rounded-[14px] shadow-lg hover:brightness-105 transition-all active:scale-[.98] disabled:opacity-50">
              {joining ? 'Joining…'
                : `Join ${picked.size} group${picked.size > 1 ? 's' : ''}${totalFees > 0 ? ` · Reg. fees GHS ${n0(totalFees)}` : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
