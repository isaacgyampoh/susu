'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Layers } from 'lucide-react'
import { format } from 'date-fns'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { PortalState } from '@/types/portal'
import { ghs, ghs2 } from '@/lib/money'
import { AppBar } from '@/components/susu/app-bar'
import GroupList from '@/components/susu/group-list'
import { FinancialSection } from '@/components/susu/financial'
import {
  Button, Card, EmptyState, Notice, Skeleton, useToast, cx,
} from '@/components/ui'

/**
 * GROUPS — what I am in, and what I can join.
 *
 * ────────────────────────────────────────────────────────────────────────
 * This screen used to be "browse and join" only: a member could see the open
 * groups but not their own, so answering "which groups am I in, and what else
 * is there" meant going back to the home screen and comparing by memory.
 *
 * Both live here now, in that order — what you hold first, what you could take
 * second. Joining is the secondary act; knowing where you stand is the reason
 * you opened it.
 *
 * ── THE PORTIONS ARE THE GROUP'S, NOT A CALCULATION ─────────────────────
 *
 * The chips here used to read ¼ / ½ / Full and the amounts beside them were
 * worked out in the browser by multiplying. A group can now configure what a
 * half portion actually costs and collects — a half that pays GHS 500 and
 * collects GHS 950 is a legitimate arrangement — so every figure on this page
 * comes from `group_portions` as the administrator set it. Nothing here
 * multiplies anything.
 */

interface Portion {
  id: string; label: string; fraction: number
  contribution_amount: number; payout_amount: number; registration_fee: number
  sort_order: number
}
interface OpenGroup {
  id: string; name: string; description: string | null
  contribution_amount: number; contribution_frequency: string
  cycle_days: number; max_members: number; current_members: number
  registration_fee: number; cashout_amount: number
  status: string; start_date: string | null; end_date: string | null
  rules: string | null
  requires_approval: boolean
  group_portions: Portion[] | null
}
interface Application {
  id: string; group_id: string; status: string
  slots: number; applied_at: string; decision_reason: string | null
  susu_groups?: { name: string } | null
}

export default function GroupsPage() {
  const toast = useToast()
  const [state, setState]   = useState<PortalState | null>(null)
  const [open, setOpen]     = useState<OpenGroup[]>([])
  const [loading, setLoad]  = useState(true)
  const [failed, setFailed] = useState('')
  const [choice, setChoice] = useState<Record<string, string>>({})   // group -> portion id
  const [joining, setJoin]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoad(true); setFailed('')
    const [pub, me] = await Promise.all([
      callFunction<{ groups: OpenGroup[] }>('groups-public'),
      callFunction<PortalState>('member-profile', { token: getMemberToken()! }),
    ])
    setLoad(false)
    if (me.error) { setFailed(me.error); return }
    setState(me.data ?? null)
    setOpen(pub.data?.groups ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  // Groups already asked for. Without this the portal offers "Apply" on a group
  // the member applied to yesterday, and the only feedback is an error.
  // Memoised: a fresh [] each render would re-run every dependent hook.
  const apps = useMemo(
    () => ((state as any)?.applications ?? []) as Application[],
    [state],
  )
  const pendingIds = useMemo(
    () => new Set(apps.filter(a => a.status === 'pending').map(a => a.group_id)),
    [apps],
  )

  const mineIds = useMemo(
    () => new Set((state?.memberships ?? []).map(m => m.group_id).filter(Boolean)),
    [state],
  )

  // Groups with room that this member is not already in.
  const available = useMemo(
    () => open.filter(g => !mineIds.has(g.id) && g.current_members < g.max_members),
    [open, mineIds],
  )

  async function join(g: OpenGroup, portion: Portion) {
    setJoin(g.id)
    const { error } = await callFunction('member-join-group', {
      method: 'POST', token: getMemberToken()!,
      body: { selections: [{ group_id: g.id, slots: 1, fraction: portion.fraction }] },
    })
    setJoin(null)
    if (error) {
      toast.error({ title: g.requires_approval ? 'Could not apply' : 'Could not join', body: error })
      return
    }
    // The wording follows what actually happened, not what was clicked.
    toast.success(
      g.requires_approval
        ? { title: 'Application sent', body: `Your collector will review your ${portion.label.toLowerCase()} place in ${g.name}.` }
        : { title: `Joined ${g.name}`, body: `Your ${portion.label.toLowerCase()} portion is on your home screen.` },
    )
    load()
  }

  if (loading) return (
    <div>
      <AppBar title="Groups" />
      <div className="portal-w pt-6 space-y-3" role="status" aria-label="Loading groups">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    </div>
  )

  if (failed) return (
    <div>
      <AppBar title="Groups" />
      <div className="portal-w pt-10">
        <EmptyState
          icon={Layers}
          title="Could not load your groups"
          body={failed}
          action={<Button onClick={load}>Try again</Button>}
        />
      </div>
    </div>
  )

  const memberships = state?.memberships ?? []

  return (
    <div className="animate-fade-in">
      <AppBar title="Groups" />

      <div className="portal-w pt-6 pb-4">

        {/* What you hold. The same grouped list the home screen uses, so the
            two screens cannot describe your memberships differently. */}
        <section aria-labelledby="mine">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h2 id="mine" className="t-eyebrow">Your groups</h2>
            {memberships.length > 0 && (
              <span className="text-xs text-ink-3 tnum">
                {memberships.length} slot{memberships.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {memberships.length === 0 ? (
            <Card pad="none">
              <EmptyState
                icon={Layers}
                title="You are not in a group yet"
                body="Pick one below to get started, or ask your collector to add you."
                compact
              />
            </Card>
          ) : (
            <div className="border border-line rounded-xl bg-surface px-[1.125rem] md:px-7">
              <GroupList memberships={memberships} />
            </div>
          )}
        </section>

        {/* What you could take. */}
        <FinancialSection
          title="Groups you can join"
          note={available.length > 0 ? `${available.length}` : undefined}
        >
          {available.length === 0 ? (
            <p className="text-sm text-ink-3 leading-relaxed">
              {open.length === 0
                ? 'No groups are open for new members right now. Your collector will let you know when one starts.'
                : 'You are already in every group that is open at the moment.'}
            </p>
          ) : (
            <div className="space-y-3">
              {available.map(g => {
                const portions = (g.group_portions ?? [])
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                const picked = portions.find(p => p.id === choice[g.id]) ?? portions[0]
                const spaces = g.max_members - g.current_members

                return (
                  <div key={g.id} className="border border-line rounded-xl bg-surface p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-base font-semibold text-ink min-w-0 truncate">{g.name}</h3>
                      <span className={cx('text-xs shrink-0 tnum',
                        spaces <= 3 ? 'text-warning' : 'text-ink-3')}>
                        {spaces} space{spaces === 1 ? '' : 's'}
                      </span>
                    </div>

                    <p className="text-xs text-ink-2 mt-1 tnum">
                      GHS {ghs(g.contribution_amount)} {g.contribution_frequency}
                      {g.cycle_days ? ` · ${g.cycle_days} days` : ''}
                      {g.start_date && ` · starts ${format(new Date(g.start_date), 'd MMM yyyy')}`}
                    </p>

                    {g.description && (
                      <p className="text-xs text-ink-3 mt-1.5 leading-relaxed">{g.description}</p>
                    )}

                    {/* The group's own portions, at the amounts it configured. */}
                    {portions.length > 0 && (
                      <>
                        <div role="radiogroup" aria-label={`Portion for ${g.name}`}
                          className="flex flex-wrap gap-2 mt-3.5">
                          {portions.map(p => {
                            const on = p.id === picked?.id
                            return (
                              <button key={p.id} type="button" role="radio" aria-checked={on}
                                onClick={() => setChoice(c => ({ ...c, [g.id]: p.id }))}
                                className={cx(
                                  'h-9 px-3 rounded-lg text-sm font-medium transition-colors',
                                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30',
                                  on ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink-2 hover:text-ink',
                                )}>
                                {p.label}
                              </button>
                            )
                          })}
                        </div>

                        {picked && (
                          <dl className="grid grid-cols-3 gap-3 mt-3.5 pt-3.5 border-t border-line-2">
                            {[
                              ['You pay',    `GHS ${ghs2(picked.contribution_amount)}`, g.contribution_frequency],
                              ['You collect', `GHS ${ghs(picked.payout_amount)}`, 'at your turn'],
                              ['To register', `GHS ${ghs2(picked.registration_fee)}`, 'once'],
                            ].map(([k, v, note]) => (
                              <div key={k} className="min-w-0">
                                <dt className="text-2xs text-ink-3">{k}</dt>
                                <dd className="text-sm font-semibold text-ink tnum mt-0.5 truncate">{v}</dd>
                                <dd className="text-2xs text-ink-3 truncate">{note}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </>
                    )}

                    {g.rules && (
                      <p className="text-2xs text-ink-3 mt-3 leading-relaxed">{g.rules}</p>
                    )}

                    {pendingIds.has(g.id) ? (
                      /* Already asked. Offering the button again would only
                         produce the duplicate-application error. */
                      <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-line
                                      bg-surface-2 px-4 py-3">
                        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                        <p className="text-sm text-ink-2">
                          <span className="font-medium text-ink">Application pending.</span>{' '}
                          Your collector is reviewing it.
                        </p>
                      </div>
                    ) : (
                      <Button
                        full className="mt-4"
                        disabled={!picked || joining === g.id}
                        onClick={() => picked && join(g, picked)}
                      >
                        {joining === g.id
                          ? (g.requires_approval ? 'Sending…' : 'Joining…')
                          : picked
                            ? `${g.requires_approval ? 'Apply to join' : 'Join'} — ${picked.label.toLowerCase()} portion`
                            : (g.requires_approval ? 'Apply to join' : 'Join')}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </FinancialSection>

        {/* Applications the collector has turned down, with the reason they
            gave — a member who is refused should hear why from the app rather
            than wonder. */}
        {apps.filter(a => a.status === 'rejected').length > 0 && (
          <FinancialSection title="Not approved">
            <div className="divide-y divide-line-2">
              {apps.filter(a => a.status === 'rejected').map(a => (
                <div key={a.id} className="py-2.5">
                  <p className="text-sm text-ink">{a.susu_groups?.name ?? 'A group'}</p>
                  <p className="text-xs text-ink-2 mt-0.5 leading-relaxed">
                    {a.decision_reason || 'Your collector did not approve this request.'}
                  </p>
                </div>
              ))}
            </div>
          </FinancialSection>
        )}

        <p className="text-2xs text-ink-3 mt-6 leading-relaxed">
          Some groups let you join straight away; others are reviewed by your
          collector first — the button says which. Either way the registration
          fee becomes payable once you are in, and contributions start on the
          group&rsquo;s start date.
        </p>
      </div>
    </div>
  )
}
