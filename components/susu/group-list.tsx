'use client'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { ghs, ghs2 } from '@/lib/money'
import type { MembershipView } from '@/types/portal'
import { cx } from '@/components/ui'

/**
 * A MEMBER'S SLOTS, AS A LIST YOU CAN SCAN.
 *
 * ────────────────────────────────────────────────────────────────────────
 * One member on this platform holds 33 slots. Rendered as a card each — with a
 * progress bar, four stat quadrants and a pay button — that is a wall roughly
 * fifteen screens long, and the thing a member actually wants (which group,
 * what do I owe, when do I collect) is buried inside repetition.
 *
 * So slots are grouped by their group. Collapsed, one row says what the member
 * holds there. Opened, each slot appears with its own position, its own
 * collection date and its own cash-out.
 *
 * ── WHAT IS NOT COMPUTED HERE ───────────────────────────────────────────
 *
 * No group-level cash-out, and no estimate of one. A slot's cash-out depends on
 * its fraction, so a group "total" would be a figure this component invented
 * rather than one the server recorded — and an invented number on a screen
 * about somebody's savings is worse than no number. What IS aggregated is
 * countable rather than financial: how many slots, how many owe today. Those
 * are facts about the list, not claims about money.
 *
 * Everything monetary is rendered exactly as `get_member_portal_state()`
 * returned it.
 */

type Group = { name: string; slots: MembershipView[] }

function groupSlots(memberships: MembershipView[]): Group[] {
  const by = new Map<string, MembershipView[]>()
  for (const m of memberships) {
    const k = m.group_name ?? 'Group'
    if (!by.has(k)) by.set(k, [])
    by.get(k)!.push(m)
  }
  return [...by.entries()].map(([name, slots]) => ({ name, slots }))
}

const when = (d?: string | null) =>
  d ? format(new Date(d), 'd MMM yyyy') : null

/** One slot, as a row that opens its own full screen. */
function SlotRow({ m }: { m: MembershipView }) {
  const owes = m.due_today > 0.005
  return (
    <Link
      href={`/m/portal/membership/${m.membership_id}`}
      className="flex items-center gap-3 py-3 min-h-[56px] transition-colors
                 hover:bg-surface-2 active:bg-surface-3 -mx-[1.125rem] px-[1.125rem]
                 md:-mx-7 md:px-7
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset
                 focus-visible:ring-ink/30"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink tnum">
          Slot {m.payout_position}
          {owes && <span className="ml-2 text-xs font-medium text-warning">Due today</span>}
        </p>
        <p className="text-xs text-ink-3 mt-0.5">
          {when(m.payout_date) ? `Collects ${when(m.payout_date)}` : 'Collection date not yet assigned'}
        </p>
      </div>
      <div className="text-right shrink-0">
        {m.payout_amount != null ? (
          <>
            <p className="text-2xs text-ink-3">Cash-out</p>
            <p className="text-sm font-semibold text-ink tnum">GHS {ghs(m.payout_amount)}</p>
          </>
        ) : (
          <p className="text-xs text-ink-3">Not yet set</p>
        )}
      </div>
      <ChevronRight size={15} strokeWidth={2} aria-hidden="true" className="text-ink-3 shrink-0" />
    </Link>
  )
}

/** What this group needs from the member today, in one short phrase. */
function groupStatus(slots: MembershipView[]): { text: string; tone: 'bad' | 'warn' | 'good' | 'off' } {
  const owing   = slots.filter(s => s.due_today > 0.005).length
  const overdue = slots.filter(s => s.overdue > 0.005).length
  const none    = slots.filter(s => s.coverage === 'no-schedule').length

  if (overdue > 0) return { text: `${overdue} overdue`, tone: 'bad' }
  if (owing   > 0) return { text: `${owing} due today`, tone: 'warn' }
  if (none === slots.length) return { text: 'Not started', tone: 'off' }
  return { text: 'Up to date', tone: 'good' }
}

export default function GroupList({ memberships }: { memberships: MembershipView[] }) {
  const groups = groupSlots(memberships)

  return (
    <div className="divide-y divide-line">
      {groups.map(({ name, slots }) => {
        const first  = slots[0]
        const status = groupStatus(slots)
        const dated  = slots
          .filter(s => s.payout_date)
          .sort((a, b) => String(a.payout_date).localeCompare(String(b.payout_date)))

        // A single slot has nothing to expand — it is its own row.
        if (slots.length === 1) {
          return (
            <Link
              key={name}
              href={`/m/portal/membership/${first.membership_id}`}
              className="flex items-center gap-3 py-3.5 min-h-[56px] transition-colors
                         hover:bg-surface-2 active:bg-surface-3 -mx-[1.125rem] px-[1.125rem]
                         md:-mx-7 md:px-7
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset
                         focus-visible:ring-ink/30"
            >
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium text-ink truncate">{name}</p>
                <p className="text-xs text-ink-2 mt-0.5 tnum">
                  Slot {first.payout_position} · GHS {ghs(first.contribution_amount)} {first.frequency}
                </p>
                <p className="text-xs text-ink-3 mt-0.5">
                  {when(first.payout_date) ? `Collects ${when(first.payout_date)}` : 'Collection date not yet assigned'}
                </p>
              </div>
              <div className="text-right shrink-0">
                <StatusText {...status} />
                {first.payout_amount != null && (
                  <p className="text-sm font-semibold text-ink tnum mt-1">GHS {ghs(first.payout_amount)}</p>
                )}
              </div>
              <ChevronRight size={15} strokeWidth={2} aria-hidden="true" className="text-ink-3 shrink-0" />
            </Link>
          )
        }

        return (
          <details key={name} className="group">
            <summary
              className="flex items-center gap-3 py-3.5 min-h-[56px] cursor-pointer list-none
                         transition-colors hover:bg-surface-2 -mx-[1.125rem] px-[1.125rem]
                         md:-mx-7 md:px-7
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset
                         focus-visible:ring-ink/30"
            >
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium text-ink truncate">{name}</p>
                <p className="text-xs text-ink-2 mt-0.5 tnum">
                  {slots.length} slots · GHS {ghs(first.contribution_amount)} {first.frequency}
                </p>
                <p className="text-xs text-ink-3 mt-0.5">
                  {dated.length > 0
                    ? `Next collection ${when(dated[0].payout_date)}`
                    : 'No collection date assigned yet'}
                </p>
              </div>
              <StatusText {...status} />
              <ChevronDown
                size={15} strokeWidth={2} aria-hidden="true"
                className="text-ink-3 shrink-0 transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="pb-1 pl-3 border-l-2 border-line-2 ml-1 divide-y divide-line-2">
              {slots.map(m => <SlotRow key={m.membership_id} m={m} />)}
            </div>
          </details>
        )
      })}
    </div>
  )
}

function StatusText({ text, tone }: { text: string; tone: 'bad' | 'warn' | 'good' | 'off' }) {
  return (
    <span className={cx(
      'text-xs font-medium shrink-0 whitespace-nowrap',
      tone === 'bad'  && 'text-danger',
      tone === 'warn' && 'text-warning',
      tone === 'good' && 'text-ink-3',
      tone === 'off'  && 'text-ink-3',
    )}>{text}</span>
  )
}
