'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, KeyRound, LogOut, MessageSquare, type LucideIcon } from 'lucide-react'
import { callFunction, clearMemberAuth, getMemberToken } from '@/lib/supabase'
import type { PortalState } from '@/types/portal'
import { format } from 'date-fns'
import { ghs } from '@/lib/money'
import {
  Avatar, Button, Card, DetailList, DetailRow, Field, Input, LoadingBlock,
  Money, Notice, Status, Textarea, useConfirm, useToast, cx,
} from '@/components/ui'
import { AppBar } from '@/components/susu/app-bar'

export default function Profile() {
  const toast  = useToast()
  const ask    = useConfirm()
  const router = useRouter()

  const [d, setD]       = useState<PortalState | null>(null)
  const [loading, setL] = useState(true)

  // Change passcode
  const [pcOpen, setPcOpen] = useState(false)
  const [pcCur, setPcCur]   = useState('')
  const [pcNew, setPcNew]   = useState('')
  const [pcNew2, setPcNew2] = useState('')
  const [pcBusy, setPcBusy] = useState(false)
  const [pcErr, setPcErr]   = useState('')

  // Message the collector
  const [msgOpen, setMsgOpen] = useState(false)
  const [subj, setSubj] = useState('')
  const [msg, setMsg]   = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await callFunction<PortalState>('member-profile', { token: getMemberToken()! })
    setD(data); setL(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function changePasscode(e: React.FormEvent) {
    e.preventDefault()
    setPcErr('')
    if (!/^\d{6}$/.test(pcNew))  { setPcErr('Your new passcode must be exactly 6 digits.'); return }
    if (pcNew !== pcNew2)        { setPcErr('The two new passcodes do not match.'); return }
    if (pcNew === pcCur)         { setPcErr('That is the passcode you already have.'); return }

    setPcBusy(true)
    const { data, error } = await callFunction<{ message: string; session_ended?: boolean }>(
      'member-change-passcode', {
        method: 'POST', token: getMemberToken()!,
        body: { current_passcode: pcCur, new_passcode: pcNew },
      })
    setPcBusy(false)
    if (error) { setPcErr(error); return }
    setPcCur(''); setPcNew(''); setPcNew2(''); setPcOpen(false)

    // Changing the passcode ends every session, this one included — that is the
    // point of it, and it is what makes the change useful to someone whose
    // passcode was seen. Sitting on a dead token would just fail the next
    // request with a confusing error, so send them to sign in.
    if (data?.session_ended) {
      toast.success('Passcode changed. Please sign in again.')
      clearMemberAuth()
      setTimeout(() => router.replace('/m/login'), 900)
      return
    }
    toast.success(data?.message ?? 'Passcode changed.')
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await callFunction('contact-admin', {
      method: 'POST', body: { subject: subj, message: msg }, token: getMemberToken()!,
    })
    setBusy(false)
    if (error) { toast.error({ title: 'Could not send', body: error }); return }
    toast.success('Sent. Your collector will reply here.')
    setSubj(''); setMsg('')
    load()
  }

  async function signOut() {
    const ok = await ask({
      title: 'Sign out?',
      description: 'You will need your phone number and passcode to get back in.',
      confirmLabel: 'Sign out',
    })
    if (!ok) return
    clearMemberAuth()
    router.push('/m/login')
  }

  if (loading) return <LoadingBlock label="Loading your profile" className="h-[60vh]" />
  if (!d) return (
    <div className="portal-w pt-10">
      <Notice tone="bad" title="Could not load your profile">
        Check your connection and try again.
      </Notice>
    </div>
  )

  /*
   * `member-profile` returns `memberships`, not `plans`.
   *
   * This line read `plans` and `payouts` — neither of which the endpoint has
   * returned since it was rebuilt on get_member_portal_state(). `payouts` was
   * undefined, `.filter()` on it threw, and every member opening Profile got
   * "Application error: a client-side exception has occurred".
   *
   * TypeScript did not catch it because the page was typed as
   * `MemberDashboard`, a type still describing the old shape — a stale type
   * masking a broken contract is worse than no type at all. It is now typed as
   * `PortalState`, which is what actually comes back.
   *
   * Defaults on every array: a member with no memberships, no payouts or no
   * messages is a normal state, not an error.
   */
  const member      = d.member
  const memberships = d.memberships ?? []
  const payouts     = d.payouts ?? []
  const myMessages  = d.myMessages ?? []
  const collected   = payouts.filter(p => p.status === 'paid')

  // Slots grouped by their group, preserving server order within each.
  const slotsByGroup = new Map<string, typeof memberships>()
  for (const m of memberships) {
    const k = m.group_name ?? 'Group'
    if (!slotsByGroup.has(k)) slotsByGroup.set(k, [])
    slotsByGroup.get(k)!.push(m)
  }

  return (
    <div className="animate-fade-in">
      <AppBar title="Account" />

      <div className="portal-w pt-6 pb-4 space-y-3">

        {/* Who this account belongs to, and whether it is in good standing.
            An account screen opens on identity, not on a menu. */}
        <div className="flex items-center gap-3 pb-1">
          <Avatar name={member.full_name} size="lg" tone="ink" />
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-ink tracking-[-.02em] truncate">
              {member.full_name}
            </h1>
            <p className="text-xs text-ink-3 font-mono mt-0.5">{member.member_code}</p>
          </div>
          <Status value={member.status} className="ml-auto shrink-0" />
        </div>

      {memberships.length > 0 && (
        <Card pad="lg">
          <p className="t-h2 mb-3">
            Your groups
            {memberships.length > 1 && (
              <span className="font-normal text-ink-3"> · {memberships.length} slot
                {memberships.length === 1 ? '' : 's'} in {slotsByGroup.size} group
                {slotsByGroup.size === 1 ? '' : 's'}</span>
            )}
          </p>

          {/*
            Grouped by group, not listed slot by slot.
            A member holding 33 slots got 33 rows — the same group name repeated
            a dozen times, each with a large unlabelled figure beside it. That is
            a wall, not a list, and the repetition hides the thing that actually
            varies: which slot, and when it collects.

            Collapsed, a row says what the member has in that group. Opened, it
            lists every slot with its own position, its own collection date and
            its own cash-out. Nothing is added up here: a slot's cash-out depends
            on its fraction, so a single "total" would be a number this screen
            invented. Each figure shown is the one the server recorded for that
            slot.

            <details> rather than React state: no JavaScript, keyboard-operable
            and screen-reader-announced for free.
          */}
          <div className="divide-y divide-line-2">
            {[...slotsByGroup.entries()].map(([groupName, slots]) => {
              const dated = slots
                .filter(m => m.payout_date)
                .sort((a, b) => String(a.payout_date).localeCompare(String(b.payout_date)))
              const undated = slots.length - dated.length
              const first = slots[0]
              return (
                <details key={groupName} className="group py-3 first:pt-0 last:pb-0">
                  <summary className="flex items-start justify-between gap-4 cursor-pointer list-none
                                      min-h-[44px] -mx-1 px-1 rounded
                                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-ink truncate">{groupName}</p>
                      <p className="text-xs text-ink-2 mt-0.5 tnum">
                        {slots.length} slot{slots.length === 1 ? '' : 's'} · GHS {ghs(first.contribution_amount)} {first.frequency}
                      </p>
                      <p className="text-xs text-ink-3 mt-0.5">
                        {dated.length > 0
                          ? `Next collection ${format(new Date(dated[0].payout_date as string), 'd MMM yyyy')}`
                          : 'No collection date assigned yet'}
                        {undated > 0 && dated.length > 0 && ` · ${undated} not yet set`}
                      </p>
                    </div>
                    <ChevronDown
                      size={16} strokeWidth={2.2} aria-hidden="true"
                      className="shrink-0 mt-1 text-ink-3 transition-transform group-open:rotate-180"
                    />
                  </summary>

                  <ul className="mt-3 ml-0 divide-y divide-line-2 border-t border-line-2">
                    {slots.map(m => (
                      <li key={m.membership_id} className="py-2.5 flex items-baseline justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm text-ink tnum">Slot {m.payout_position}</p>
                          <p className="text-xs text-ink-3 mt-0.5">
                            {m.payout_date
                              ? `Collects ${format(new Date(m.payout_date), 'd MMM yyyy')}`
                              : 'Collection date not yet assigned'}
                          </p>
                        </div>
                        {/* Labelled. A bare "GHS 4,700" beside a group name does
                            not say what the number is. */}
                        <div className="shrink-0 text-right">
                          {m.payout_amount != null ? (
                            <>
                              <p className="text-2xs text-ink-3">Cash-out</p>
                              <p className="text-sm font-semibold text-ink tnum">GHS {ghs(m.payout_amount)}</p>
                            </>
                          ) : (
                            <p className="text-xs text-ink-3">Not yet set</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              )
            })}
          </div>
        </Card>
      )}

      {collected.length > 0 && (
        <Card pad="lg">
          <p className="t-h2 mb-3">Collected</p>
          <div className="divide-y divide-line-2">
            {collected.map(p => (
              <div key={p.id} className="py-3 flex items-center justify-between gap-4 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-base font-medium text-ink truncate">{p.susu_groups?.name}</p>
                  <p className="text-xs text-ink-3">
                    {p.paid_at ? format(new Date(p.paid_at), 'd MMM yyyy') : ''}
                  </p>
                </div>
                <Money value={p.total_amount} size="sm" sign="in" className="shrink-0" />
              </div>
            ))}
          </div>
        </Card>
      )}

      <h2 className="t-eyebrow pt-4">Account</h2>
      <Card pad="lg">
        <p className="t-h2 mb-1">Your details</p>
        <DetailList>
          <DetailRow label="Phone">{member.phone}</DetailRow>
          <DetailRow label="Email">{member.email}</DetailRow>
          <DetailRow label="MoMo">
            {member.mobile_money_number
              ? `${member.mobile_money_provider ?? ''} ${member.mobile_money_number}`.trim()
              : null}
          </DetailRow>
          <DetailRow label="Occupation">{member.occupation}</DetailRow>
          <DetailRow label="Address">{member.residential_address}</DetailRow>
          {/* `format(new Date(undefined))` throws RangeError — one of the
              things that crashed this page rather than leaving a blank row. */}
          <DetailRow label="Member since">
            {member.created_at ? format(new Date(member.created_at), 'd MMMM yyyy') : null}
          </DetailRow>
        </DetailList>
        <p className="text-xs text-ink-3 mt-3 leading-relaxed">
          To change anything here, message your collector below.
        </p>
      </Card>

      <h2 className="t-eyebrow pt-4">Security</h2>
      {/* ---- Change passcode ---- */}
      <Card pad="none">
        <Disclosure
          icon={KeyRound}
          open={pcOpen} onToggle={() => setPcOpen(v => !v)}
          title="Change your passcode"
          sub="Replace the passcode you were given with your own private PIN"
        >
          <form onSubmit={changePasscode} className="space-y-3">
            {pcErr && <Notice tone="bad">{pcErr}</Notice>}
            <Field label="Current passcode">
              {({ id }) => (
                <Input id={id} type="password" inputMode="numeric" maxLength={6} required autoComplete="current-password"
                  className="tnum" value={pcCur} onChange={e => setPcCur(e.target.value.replace(/\D/g, ''))} />
              )}
            </Field>
            <Field label="New passcode" hint="Six digits. Choose something only you would pick.">
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} type="password" inputMode="numeric" maxLength={6}
                  required autoComplete="new-password" className="tnum"
                  value={pcNew} onChange={e => setPcNew(e.target.value.replace(/\D/g, ''))} />
              )}
            </Field>
            <Field label="Repeat new passcode">
              {({ id }) => (
                <Input id={id} type="password" inputMode="numeric" maxLength={6} required autoComplete="new-password"
                  className="tnum" value={pcNew2} onChange={e => setPcNew2(e.target.value.replace(/\D/g, ''))}
                  invalid={!!pcNew2 && pcNew2 !== pcNew} />
              )}
            </Field>
            <Button type="submit" full loading={pcBusy}>Change passcode</Button>
            <p className="text-xs text-ink-3 leading-relaxed">
              Keep it private — never share it, not even with your collector.
            </p>
          </form>
        </Disclosure>
      </Card>

      {/* ---- Message the collector ---- */}
      <h2 className="t-eyebrow pt-4">Support</h2>
      <Card pad="none">
        <Disclosure
          icon={MessageSquare}
          open={msgOpen} onToggle={() => setMsgOpen(v => !v)}
          title="Message your collector"
          sub="Questions about your plan or your collection"
          badge={myMessages.length || undefined}
        >
          <form onSubmit={send} className="space-y-3">
            <Field label="Subject">
              {({ id }) => <Input id={id} required value={subj} onChange={e => setSubj(e.target.value)}
                placeholder="What is it about?" />}
            </Field>
            <Field label="Message">
              {({ id }) => <Textarea id={id} required rows={4} value={msg} onChange={e => setMsg(e.target.value)}
                placeholder="Type your message" />}
            </Field>
            <Button type="submit" full loading={busy}>Send</Button>
          </form>

          {myMessages.length > 0 && (
            <div className="mt-6 divide-y divide-line-2 border-t border-line pt-1">
              {myMessages.map(m => (
                <div key={m.id} className="py-3.5">
                  <div className="flex justify-between gap-3">
                    <p className="text-sm font-semibold text-ink">{m.subject}</p>
                    <span className="text-xs text-ink-3 whitespace-nowrap shrink-0">
                      {format(new Date(m.created_at), 'd MMM')}
                    </span>
                  </div>
                  <p className="text-xs text-ink-2 mt-1 leading-relaxed">{m.message}</p>
                  {m.reply_text && (
                    <div className="mt-3 pl-3 border-l-2 border-accent">
                      <p className="t-eyebrow text-accent">Reply</p>
                      <p className="text-sm text-ink mt-1 leading-relaxed">{m.reply_text}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Disclosure>
      </Card>

      {/* The rules the membership runs on, reachable from inside the portal
          and not only from the page someone saw once while joining. */}
      <a href="/policies"
         className="block text-center text-xs text-ink-2 underline underline-offset-2 py-1">
        Payment and membership policy
      </a>

      {/* Sign out lives here, not in the tab bar. A destructive control
          sitting beside four navigation targets gets hit by accident. */}
      <Button variant="outline" icon={LogOut} full onClick={signOut} className="!text-danger">
        Sign out
      </Button>
      </div>
    </div>
  )
}

function Disclosure({
  open, onToggle, title, sub, icon: Icon, badge, children,
}: {
  open: boolean
  onToggle: () => void
  title: string
  sub: string
  icon: LucideIcon
  badge?: number
  children: React.ReactNode
}) {
  return (
    <>
      <button
        type="button" onClick={onToggle} aria-expanded={open}
        className="w-full flex items-center gap-3.5 p-4 text-left transition-colors hover:bg-surface-2 rounded-lg"
      >
        <span className="w-9 h-9 rounded-md bg-surface-2 grid place-items-center shrink-0">
          <Icon size={16} strokeWidth={2.1} className="text-ink-2" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-ink">{title}</span>
          <span className="block text-xs text-ink-2 mt-0.5 leading-relaxed">{sub}</span>
        </span>
        {badge ? (
          <span className="text-2xs font-semibold tnum px-1.5 py-0.5 rounded-xs bg-surface-3 text-ink-2 shrink-0">
            {badge}
          </span>
        ) : null}
        <ChevronDown
          size={17} strokeWidth={2.2} aria-hidden="true"
          className={cx('text-ink-3 shrink-0 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && <div className="px-4 pb-4 pt-1 animate-fade-in">{children}</div>}
    </>
  )
}
