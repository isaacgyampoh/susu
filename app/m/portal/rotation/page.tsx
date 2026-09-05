'use client'
import { useCallback, useEffect, useState } from 'react'
import { Layers } from 'lucide-react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import { AppBar } from '@/components/susu/app-bar'
import { FinancialSection } from '@/components/susu/financial'
import { PayoutHeadlines, RotationList, type Rotation } from '@/components/susu/rotation'
import { Button, EmptyState, Skeleton } from '@/components/ui'

/**
 * THE ORDER OF TURNS.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Everything here comes from `get_member_rotation`, which does not read the
 * members table. There is no name, no phone and no other member's payout in
 * this page's data — not hidden, absent. A member can open devtools and find
 * only positions, dates and their own figures.
 *
 * The dates are the group's real collection dates from group_memberships.
 * Nothing is computed here, and a slot whose date the collector has not set
 * says so rather than being given one.
 */
export default function RotationPage() {
  const [r, setR]         = useState<Rotation | null>(null)
  const [loading, setL]   = useState(true)
  const [failed, setFail] = useState('')

  const load = useCallback(async () => {
    setL(true); setFail('')
    const { data, error } = await callFunction<{ rotation: Rotation | null }>(
      'member-rotation', { token: getMemberToken()! },
    )
    setL(false)
    if (error) { setFail(error); return }
    setR(data?.rotation ?? null)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div>
      <AppBar title="Rotation" />
      <div className="portal-w pt-6 space-y-3" role="status" aria-label="Loading the rotation">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  )

  if (failed || !r) return (
    <div>
      <AppBar title="Rotation" />
      <div className="portal-w pt-10">
        <EmptyState
          icon={Layers}
          title={failed ? 'Could not load the rotation' : 'You are not in a rotation yet'}
          body={failed
            ? 'This is usually temporary. Nothing has changed.'
            : 'Once you join a group and your collector sets the order of turns, it appears here.'}
          action={failed ? <Button onClick={load}>Try again</Button> : undefined}
        />
      </div>
    </div>
  )

  const deadline = r.group?.payment_deadline?.slice(0, 5) ?? null

  return (
    <div className="animate-fade-in">
      <AppBar title="Rotation" />

      <div className="portal-w pt-6 pb-4">
        {r.group && (
          <p className="text-sm text-ink-2 mb-4 truncate">{r.group.name}</p>
        )}

        <PayoutHeadlines r={r} />

        <FinancialSection
          title="Upcoming rotation"
          note={r.total_slots > 0 ? `${r.collected} of ${r.total_slots} collected` : undefined}
        >
          <RotationList seats={r.upcoming} />
        </FinancialSection>

        {/* The reason any of this is on screen. */}
        <p className="text-2xs text-ink-3 mt-6 leading-relaxed">
          Everyone collects once, in this order. Keeping your contributions up to
          date{deadline ? ` before ${deadline} each day` : ''} is what keeps the
          turns on schedule for everyone — including yours.
        </p>
      </div>
    </div>
  )
}
