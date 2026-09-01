'use client'
import { useCallback, useEffect, useState } from 'react'
import { Check, Layers } from 'lucide-react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard, SusuGroup } from '@/types'
import { ghs } from '@/lib/money'
import {
  Badge, Button, Card, EmptyState, LoadingBlock, Notice, useToast, cx,
} from '@/components/ui'

/*
 * Browse every open susu group and join more of them. A member already in one
 * group can tick two or three others and join them all in one go — each becomes
 * its own plan on their dashboard.
 *
 * A slot can also be taken in fractions: a quarter slot pays a quarter of the
 * daily contribution and collects a quarter of the cashout. That is how members
 * who cannot afford a whole slot still take part, so the maths is spelled out
 * on the card rather than left for them to work out.
 */

const FRACTIONS: [number, string][] = [[0.25, '¼'], [0.5, '½'], [1, 'Full']]

export default function BrowseGroups() {
  const toast = useToast()
  const [groups, setGroups]     = useState<SusuGroup[]>([])
  const [mine, setMine]         = useState<Set<string>>(new Set())
  const [picked, setPicked]     = useState<Set<string>>(new Set())
  const [slotsFor, setSlotsFor] = useState<Record<string, number>>({})
  const [fracFor, setFracFor]   = useState<Record<string, number>>({})
  const [loading, setLoading]   = useState(true)
  const [joining, setJoining]   = useState(false)
  const [result, setResult]     = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: pub }, { data: me }] = await Promise.all([
      callFunction<{ groups: SusuGroup[] }>('groups-public'),
      callFunction<MemberDashboard>('member-profile', { token: getMemberToken()! }),
    ])
    setGroups(pub?.groups ?? [])
    setMine(new Set((me?.plans ?? []).map(p => p.susu_groups?.id).filter(Boolean) as string[]))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (id: string) =>
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  async function join() {
    setJoining(true)
    const { data, error } = await callFunction<any>('member-join-group', {
      method: 'POST', token: getMemberToken()!,
      body: {
        selections: Array.from(picked).map(id => ({
          group_id: id, slots: slotsFor[id] || 1, fraction: fracFor[id] ?? 1,
        })),
      },
    })
    setJoining(false)
    if (error) { toast.error({ title: 'Could not join', body: error }); return }
    setResult(data)
    setPicked(new Set())
    load()
  }

  if (loading) return <LoadingBlock label="Loading groups" className="h-[60vh]" />

  const pickedGroups = groups.filter(g => picked.has(g.id))
  const totalFees = pickedGroups.reduce(
    (s, g) => s + Number(g.registration_fee || 0) * (slotsFor[g.id] || 1) * (fracFor[g.id] ?? 1), 0)
  const totalSlots = pickedGroups.reduce((s, g) => s + (slotsFor[g.id] || 1), 0)

  return (
    <div className="max-w-md mx-auto px-5 pt-6 animate-fade-in">
      <h1 className="text-2xl font-semibold text-ink">Join more groups</h1>
      <p className="text-sm text-ink-2 mt-1 leading-relaxed">
        Pick one or several — and take more than one slot in a group if you want multiple payout turns.
      </p>

      {result && (
        <Notice
          tone={result.failed?.length ? 'warn' : 'good'}
          title={result.message}
          className="mt-5"
          action={
            <button type="button" onClick={() => setResult(null)}
              className="text-xs font-medium text-ink-3 hover:text-ink transition-colors">
              Dismiss
            </button>
          }
        >
          <ul className="space-y-0.5">
            {result.joined?.map((j: any, i: number) => (
              <li key={i}>
                {j.group} — payout position #{j.payout_position}
                {j.registration_fee > 0 && <> · registration fee GHS {ghs(j.registration_fee)} to be paid</>}
              </li>
            ))}
            {result.failed?.map((f: any, i: number) => (
              <li key={`f${i}`} className="text-danger">{f.group ?? 'A group'}: {f.reason}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="space-y-3 mt-5 pb-32">
        {groups.map(g => {
          const joined  = mine.has(g.id)
          const full    = g.current_members >= g.max_members
          const checked = picked.has(g.id)
          const frac    = fracFor[g.id] ?? 1
          const slots   = slotsFor[g.id] || 1

          return (
            <Card
              key={g.id} pad="none"
              className={cx(
                'overflow-hidden transition-colors',
                checked ? 'border-ink' : full && !joined ? 'opacity-60' : '',
              )}
            >
              {/* The whole header row is the toggle. The controls that appear
                  underneath sit outside it, so tapping "½" cannot also
                  un-tick the group — which is what nesting them inside one
                  <label> used to do. */}
              <button
                type="button"
                onClick={() => !full && toggle(g.id)}
                disabled={full && !joined}
                aria-pressed={checked}
                className="w-full flex items-start gap-3 p-4 text-left disabled:cursor-not-allowed"
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'w-5 h-5 rounded-xs border grid place-items-center shrink-0 mt-0.5 transition-colors',
                    checked ? 'bg-accent border-accent text-inverse' : 'border-line bg-surface',
                    full && !joined && 'opacity-40',
                  )}
                >
                  {checked && <Check size={13} strokeWidth={3} />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-md font-semibold text-ink truncate">{g.name}</span>
                    {joined && <Badge tone="good">{checked ? 'Adding slots' : 'Joined'}</Badge>}
                    {!joined && full && <Badge tone="warn">Full</Badge>}
                  </span>

                  <span className="block text-xs text-ink-2 mt-1 tnum">
                    GHS {ghs(g.contribution_amount)} {g.contribution_frequency}
                    {' · '}Cashout GHS {ghs(g.cashout_amount)}
                  </span>
                  <span className="block text-xs text-ink-3 mt-0.5 tnum">
                    {g.current_members}/{g.max_members} members
                    {Number(g.registration_fee) > 0 && <> · Reg. fee GHS {ghs(g.registration_fee)}</>}
                  </span>
                  {g.description && (
                    <span className="block text-xs text-ink-3 mt-1.5 leading-relaxed">{g.description}</span>
                  )}
                </span>
              </button>

              {checked && (
                <div className="px-4 pb-4 pt-1 space-y-3 border-t border-line-2 animate-fade-in">
                  {frac < 1 && (
                    <p className="text-xs text-ink-2 leading-relaxed bg-accent-soft border border-accent-line rounded-sm p-2.5 tnum">
                      Your {frac === 0.25 ? 'quarter' : 'half'} slot: pay{' '}
                      <strong className="text-ink">GHS {ghs(Number(g.contribution_amount) * frac)}</strong>{' '}
                      {g.contribution_frequency}, collect{' '}
                      <strong className="text-ink">GHS {ghs(Number(g.cashout_amount ?? 0) * frac)}</strong>.
                    </p>
                  )}

                  <Picker
                    label="Slot size"
                    options={FRACTIONS.map(([v, l]) => ({ value: v, label: l }))}
                    value={frac}
                    onChange={v => setFracFor(p => ({ ...p, [g.id]: v }))}
                  />
                  <Picker
                    label="How many slots"
                    options={[1, 2, 3, 4, 5].map(n => ({
                      value: n, label: String(n),
                      disabled: g.current_members + n > g.max_members,
                    }))}
                    value={slots}
                    onChange={v => setSlotsFor(p => ({ ...p, [g.id]: v }))}
                  />
                </div>
              )}
            </Card>
          )
        })}

        {groups.length === 0 && (
          <EmptyState
            icon={Layers}
            title="No groups are open"
            body="Nothing is taking new members right now. Your collector will let you know when a group opens."
          />
        )}
      </div>

      {/* Sticky commit bar. Sits above the tab bar, never over it. */}
      {picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(var(--tabbar)+env(safe-area-inset-bottom))] z-30 px-5 pb-3 animate-rise-in">
          <div className="max-w-md mx-auto">
            <Button variant="accent" size="lg" full loading={joining} onClick={join} className="shadow-md">
              Join {totalSlots} slot{totalSlots > 1 ? 's' : ''} in {picked.size} group{picked.size > 1 ? 's' : ''}
              {totalFees > 0 && ` · Reg. GHS ${ghs(totalFees)}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Picker<T extends number>({
  label, options, value, onChange,
}: {
  label: string
  options: { value: T; label: string; disabled?: boolean }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div>
      <p className="t-eyebrow mb-1.5">{label}</p>
      <div className="flex gap-1.5 flex-wrap">
        {options.map(o => (
          <button
            key={o.value} type="button" disabled={o.disabled}
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cx(
              'min-w-[44px] h-9 px-3 rounded-sm text-sm font-semibold transition-colors disabled:opacity-30',
              value === o.value
                ? 'bg-ink text-inverse'
                : 'bg-surface border border-line text-ink-2 hover:text-ink hover:border-ink/25',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
