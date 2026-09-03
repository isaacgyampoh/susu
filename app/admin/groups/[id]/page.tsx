'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { ghs, ghs2 } from '@/lib/money'
import {
  Page, PageHeader, Button, ButtonLink, Status, Skeleton, EmptyState, Notice,
  SearchBar, Metric, MetricRow, MobileRecord,
  TableWrap, THead, TH, TBody, TR, TD, cx,
} from '@/components/ui'

/**
 * ONE GROUP, AS THE OPERATION SEES IT.
 *
 * ────────────────────────────────────────────────────────────────────────
 * This screen already existed as a roster: who holds which slot, and what else
 * they are in. That part was good and is kept. What it could not answer was
 * anything financial — an administrator had to leave the page to find out
 * whether the group was actually being paid — and on a phone it answered even
 * that by scrolling a 720px table sideways.
 *
 * Added rather than rebuilt: the money, the portions, the group's own state,
 * and a mobile presentation. The roster's structure, its grouping by member and
 * its cross-group links are unchanged.
 *
 * ── THE MONEY IS THIS GROUP'S ONLY ──────────────────────────────────────
 *
 * Expected, received and outstanding come from the contributions of THIS
 * group's memberships. A member in four groups has four separate obligations;
 * pooling them is exactly what the membership model exists to prevent. The
 * figures are computed by get_group_financials_v2 — nothing is added up here.
 */

interface Portion {
  id: string; label: string; fraction: number
  contribution_amount: number; payout_amount: number; registration_fee: number
  is_active: boolean; sort_order: number
}
interface AppRow {
  id: string; applied_at: string; slots: number; slot_fraction: number
  note: string | null
  member: { id: string; name: string; code: string; phone: string; status: string }
  portion: { label: string; contribution_amount: number; payout_amount: number; registration_fee: number } | null
  existing_slots: number
}
interface Financials {
  expected: number; received: number; outstanding: number
  days_total: number; days_paid: number; days_overdue: number
  members: number; slots_taken: number; payouts_paid: number
}

const when = (d?: string | null) => (d ? format(new Date(d), 'd MMM yyyy') : null)

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [group, setGroup]       = useState<any>(null)
  const [roster, setRoster]     = useState<any[]>([])
  const [portions, setPortions] = useState<Portion[]>([])
  const [fin, setFin]           = useState<Financials | null>(null)
  const [loading, setLoading]   = useState(true)
  const [err, setErr]           = useState('')
  const [q, setQ]               = useState('')
  const [acting, setActing]     = useState('')
  const [apps, setApps]         = useState<AppRow[]>([])
  const [deciding, setDeciding] = useState('')

  /*
   * Named transitions, not a status dropdown. "Close applications" is a
   * decision somebody can be held to; "set status to full" invites setting it
   * to anything. Each is offered only from the state it is valid in, and the
   * server checks that again — the button being hidden is a courtesy, not the
   * control.
   */
  async function act(action: string, confirmText: string) {
    if (!window.confirm(confirmText)) return
    setActing(action)
    const { error } = await callFunction(`groups-create?id=${id}`, {
      method: 'PATCH', token: getAdminToken()!, body: { status_action: action },
    })
    setActing('')
    if (error) { window.alert(error); return }
    load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await callFunction<{
      group: any; roster: any[]; portions: Portion[]; financials: Financials
    }>(`groups-create?id=${id}`, { token: getAdminToken()! })
    setLoading(false)
    setErr(error ?? '')
    setGroup(data?.group ?? null)
    setRoster(data?.roster ?? [])
    setPortions(data?.portions ?? [])
    setFin(data?.financials ?? null)

    const { data: q } = await callFunction<{ applications: AppRow[] }>(
      `admin-applications?group=${id}`, { token: getAdminToken()! })
    setApps(q?.applications ?? [])
  }, [id])

  /*
   * Approving runs the same membership-creation path a direct join uses, so a
   * member approved here gets a schedule and a fee exactly as one who joined
   * themselves would. Capacity is re-checked server-side at the decision — a
   * group can fill between somebody applying and somebody approving.
   */
  async function decide(appId: string, action: 'approve' | 'reject', who: string) {
    let reason = ''
    if (action === 'reject') {
      reason = window.prompt(`Why is ${who} not being approved? The member is told this.`) ?? ''
      if (reason.trim().length < 5) return
    } else if (!window.confirm(`Approve ${who}? This creates their membership, their contribution schedule and their registration fee.`)) {
      return
    }
    setDeciding(appId)
    const { error } = await callFunction('admin-applications', {
      method: 'POST', token: getAdminToken()!,
      body: { id: appId, action, reason },
    })
    setDeciding('')
    if (error) { window.alert(error); return }
    load()
  }

  useEffect(() => { load() }, [load])

  if (loading) return (
    <Page>
      <div className="space-y-4" role="status" aria-label="Loading this group">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </Page>
  )

  if (err || !group) return (
    <Page>
      <EmptyState
        title="Could not load this group"
        body={err || 'It may have been removed.'}
        action={<ButtonLink href="/admin/groups" variant="outline">Back to groups</ButtonLink>}
      />
    </Page>
  )

  // Grouped by member, so a holder of several slots reads as one person.
  const byMember = new Map<string, { member: any; slots: any[]; other: any[] }>()
  for (const r of roster) {
    const mid = r.members?.id ?? r.id
    if (!byMember.has(mid)) byMember.set(mid, { member: r.members, slots: [], other: r.other_groups ?? [] })
    byMember.get(mid)!.slots.push(r)
  }
  let people = Array.from(byMember.values())

  const needle = q.trim().toLowerCase()
  if (needle) people = people.filter(p =>
    p.member?.full_name?.toLowerCase().includes(needle) ||
    p.member?.member_id?.toLowerCase().includes(needle) ||
    p.member?.phone?.includes(needle))

  const activeSlots = roster.filter(r => r.status === 'active').length
  const free = Math.max(0, (group.max_members ?? 0) - activeSlots)

  return (
    <Page>
      <PageHeader
        back={{ href: '/admin/groups', label: 'All groups' }}
        title={group.name}
        sub={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Status value={group.status} />
            <span className="tnum">
              GHS {ghs(group.contribution_amount)} {group.contribution_frequency}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tnum">{activeSlots} of {group.max_members} slots</span>
            {when(group.start_date) && <><span aria-hidden="true">·</span><span>starts {when(group.start_date)}</span></>}
            {when(group.end_date)   && <><span aria-hidden="true">·</span><span>ends {when(group.end_date)}</span></>}
          </span>
        }
        actions={
          <>
            {group.status === 'open' && (
              <Button variant="outline" disabled={!!acting}
                onClick={() => act('close_applications',
                  `Close applications for "${group.name}"? Existing members are unaffected; nobody new can join.`)}>
                {acting === 'close_applications' ? 'Closing…' : 'Close applications'}
              </Button>
            )}
            {group.status === 'full' && (
              <Button variant="outline" disabled={!!acting}
                onClick={() => act('reopen', `Reopen applications for "${group.name}"?`)}>
                {acting === 'reopen' ? 'Reopening…' : 'Reopen applications'}
              </Button>
            )}
            {(group.status === 'active' || group.status === 'full') && (
              <Button variant="dangerLine" disabled={!!acting}
                onClick={() => act('complete',
                  `Close "${group.name}" for good? This marks the group completed. It cannot be reopened from here.`)}>
                {acting === 'complete' ? 'Closing…' : 'Close group'}
              </Button>
            )}
            <ButtonLink href={`/admin/groups/${id}/edit`} variant="outline">Edit group</ButtonLink>
          </>
        }
      />

      {/* Money, for this group alone. */}
      {fin && (
        <MetricRow>
          <Metric label="Expected" value={fin.expected} primary
            sub={`${fin.days_total.toLocaleString()} contribution days`} />
          <Metric label="Received" value={fin.received} tone="good"
            sub={`${fin.days_paid.toLocaleString()} days settled`} />
          <Metric label="Outstanding" value={fin.outstanding}
            tone={fin.outstanding > 0.005 ? 'warn' : undefined}
            sub={fin.days_overdue > 0 ? `${fin.days_overdue} overdue` : 'nothing overdue'} />
          <Metric label="Paid out" value={fin.payouts_paid}
            sub={`${fin.members} member${fin.members === 1 ? '' : 's'}`} />
        </MetricRow>
      )}

      {/* What a place in this group costs and pays. */}
      <section aria-labelledby="portions" className="mt-6">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h2 id="portions" className="t-eyebrow">Portions</h2>
          <span className="text-xs text-ink-3">{free} slot{free === 1 ? '' : 's'} free</span>
        </div>

        {portions.length === 0 ? (
          <Notice tone="warn" title="No portions configured">
            Members joining this group fall back to proportional amounts — a half
            slot pays and collects exactly half. Set them on the edit screen to
            state what each portion actually costs and pays.
          </Notice>
        ) : (
          <div className="border border-line rounded-xl bg-surface overflow-hidden">
            <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_1fr] gap-3 px-4 py-2
                            bg-surface-2 border-b border-line text-2xs font-semibold
                            uppercase tracking-[.06em] text-ink-3">
              <span>Portion</span><span>Contributes</span><span>Collects</span><span>Registration</span>
            </div>
            <div className="divide-y divide-line-2">
              {portions.map(p => (
                <div key={p.id}
                  className={cx('grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr] gap-x-3 gap-y-1 px-4 py-3',
                                !p.is_active && 'opacity-50')}>
                  <span className="text-sm font-medium text-ink col-span-2 sm:col-span-1">
                    {p.label}
                    {!p.is_active && <span className="ml-2 text-xs font-normal text-ink-3">not offered</span>}
                  </span>
                  {([['Contributes', p.contribution_amount],
                     ['Collects', p.payout_amount],
                     ['Registration', p.registration_fee]] as const).map(([k, v]) => (
                    <span key={k} className="text-sm text-ink tnum">
                      <span className="sm:hidden text-2xs text-ink-3 block">{k}</span>
                      GHS {ghs2(v)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* People waiting on a decision. Above the roster because it is the only
          part of this screen with something to DO. */}
      {apps.length > 0 && (
        <section aria-labelledby="apps" className="mt-8">
          <h2 id="apps" className="t-eyebrow mb-2">
            Waiting for a decision <span className="font-normal text-ink-3">· {apps.length}</span>
          </h2>
          <div className="border border-line rounded-xl bg-surface divide-y divide-line">
            {apps.map(a => (
              <div key={a.id} className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <Link href={`/admin/members/${a.member.id}`}
                    className="text-base font-medium text-ink hover:underline underline-offset-2">
                    {a.member.name}
                  </Link>
                  <span className="text-xs text-ink-3 tnum">
                    applied {format(new Date(a.applied_at), 'd MMM, HH:mm')}
                  </span>
                </div>

                <p className="text-xs text-ink-2 mt-1 tnum">
                  {a.member.code} · {a.member.phone}
                  {a.existing_slots > 0 && ` · already holds ${a.existing_slots} slot${a.existing_slots > 1 ? 's' : ''} here`}
                </p>

                {/* What approving would actually cost and pay them. */}
                {a.portion && (
                  <p className="text-xs text-ink-2 mt-1.5 tnum">
                    {a.slots} × {a.portion.label} · contributes GHS {ghs2(a.portion.contribution_amount)}
                    {' · collects GHS '}{ghs(a.portion.payout_amount)}
                    {a.portion.registration_fee > 0 && ` · registration GHS ${ghs2(a.portion.registration_fee)}`}
                  </p>
                )}
                {a.note && <p className="text-xs text-ink-3 mt-1.5 leading-relaxed">&ldquo;{a.note}&rdquo;</p>}

                <div className="flex gap-2 mt-3">
                  <Button size="sm" disabled={!!deciding}
                    onClick={() => decide(a.id, 'approve', a.member.name)}>
                    {deciding === a.id ? 'Working…' : 'Approve'}
                  </Button>
                  <Button size="sm" variant="dangerLine" disabled={!!deciding}
                    onClick={() => decide(a.id, 'reject', a.member.name)}>
                    Not approved
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Roster. */}
      <section aria-labelledby="roster" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 id="roster" className="t-eyebrow">
            Members <span className="font-normal text-ink-3">· {byMember.size}</span>
          </h2>
          <div className="w-full sm:w-[300px]">
            <SearchBar value={q} onChange={setQ} placeholder="Name, member ID or phone…" />
          </div>
        </div>

        {people.length === 0 ? (
          <EmptyState
            title={roster.length === 0 ? 'No members yet' : 'No members match your search'}
            body={roster.length === 0
              ? 'Members appear here as they join or are added to this group.'
              : 'Try a different name, member ID or phone number.'}
            compact
          />
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden lg:block border border-line rounded-xl overflow-hidden bg-surface">
              <TableWrap>
                <THead>
                  <TH>Member</TH><TH>In this group</TH><TH>Payout</TH><TH>Also in</TH>
                </THead>
                <TBody>
                  {people.map(({ member, slots, other }) => (
                    <TR key={member?.id ?? Math.random()}>
                      <TD>
                        <Link href={`/admin/members/${member?.id}`}
                          className="font-medium text-ink hover:underline underline-offset-2">
                          {member?.full_name ?? '—'}
                        </Link>
                        <span className="block text-2xs text-ink-3 mt-0.5 tnum">
                          {member?.member_id} · {member?.phone}
                        </span>
                      </TD>
                      <TD>
                        <span className="text-ink">{slots.length} slot{slots.length > 1 ? 's' : ''}</span>
                        <span className="block text-2xs text-ink-3 mt-0.5 tnum">
                          {slots.map((s: any) => `#${s.payout_position}`).join(', ')}
                        </span>
                      </TD>
                      <TD>
                        {slots.map((s: any) => (
                          <span key={s.id} className="block text-xs mb-1 last:mb-0">
                            <span className="text-ink-3">#{s.payout_position}: </span>
                            {s.payout_received
                              ? <span className="text-success">received</span>
                              : s.payout_date
                                ? <span className="text-ink tnum">{when(s.payout_date)} · GHS {ghs(s.payout_amount)}</span>
                                : <span className="text-warning">no date set</span>}
                          </span>
                        ))}
                      </TD>
                      <TD>
                        {other.length === 0 ? <span className="text-ink-3">—</span> : (
                          <span className="flex flex-wrap gap-1.5">
                            {other.map((o: any) => (
                              <Link key={o.id} href={`/admin/groups/${o.id}`}
                                className="inline-flex items-center px-2 py-0.5 bg-surface-2 border border-line
                                           rounded-md text-2xs text-ink hover:border-ink transition-colors">
                                {o.name}{o.slots > 1 ? ` ×${o.slots}` : ''}
                              </Link>
                            ))}
                          </span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </TableWrap>
            </div>

            {/* Mobile and tablet: records, not a 720px table dragged sideways. */}
            <div className="lg:hidden border border-line rounded-xl overflow-hidden bg-surface divide-y divide-line">
              {people.map(({ member, slots, other }) => (
                <MobileRecord
                  key={member?.id ?? Math.random()}
                  href={`/admin/members/${member?.id}`}
                  lead={<span className="text-base font-semibold text-ink">{member?.full_name ?? '—'}</span>}
                  status={<span className="text-xs text-ink-3 tnum shrink-0">
                    {slots.length} slot{slots.length > 1 ? 's' : ''}
                  </span>}
                  title={<span className="text-sm font-normal text-ink-2 tnum">
                    {member?.member_id} · {member?.phone}
                  </span>}
                  meta={
                    <span className="flex flex-col gap-0.5">
                      <span className="tnum">
                        {slots.map((s: any) => `#${s.payout_position}`).join(', ')}
                        {slots.some((s: any) => s.payout_date) && ' · '}
                        {slots.filter((s: any) => s.payout_date).map((s: any) => when(s.payout_date)).join(', ')}
                      </span>
                      {other.length > 0 && (
                        <span className="text-ink-3">
                          also in {other.map((o: any) => o.name).join(', ')}
                        </span>
                      )}
                    </span>
                  }
                />
              ))}
            </div>
          </>
        )}
      </section>
    </Page>
  )
}
