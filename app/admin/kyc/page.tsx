'use client'
import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import {
  CheckCircle2, Clock, FileText, Link2, ShieldAlert, UserCheck, XCircle, Wallet,
} from 'lucide-react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { memberSignInUrl, credentialsMessage, whatsappLink } from '@/lib/member-link'
import { ghs2 } from '@/lib/money'
import {
  Badge, Button, Card, Checkbox, DetailList, DetailRow, EmptyState, Field, Input,
  LoadingBlock, Modal, ModalActions, Notice, Page, PageHeader, Segmented, Stat,
  TableWrap, THead, TH, TBody, TR, TD, Textarea, cx, useToast,
} from '@/components/ui'

/**
 * REGISTRATIONS — the administrative queue.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Four buckets, and the distinction that matters is between the first two:
 *
 *   Awaiting payment    — applied, fee not received
 *   Paid, awaiting you  — fee received and verified, needs a human decision
 *   Approved
 *   Rejected
 *
 * The buckets are computed by `get_registration_queue()` in the database. A
 * console that works out "has this person paid?" from a list it fetched can
 * disagree with the database about who owes money; one that asks the database
 * cannot.
 *
 * APPROVAL IS GATED, AND THE GATE IS HONEST
 *
 * Approving creates an active member with live memberships, a payout position
 * and a contribution schedule. The server refuses to do that for an unpaid
 * registration and answers 402. This page does not hide that behind a generic
 * failure: it says what is owed and offers the two real ways forward —
 * record the payment when it arrives, or override with a written reason that
 * is stored in the audit log under the name of whoever decided it.
 *
 * An override NEVER creates a payment record. It records that a human
 * activated a membership that had not been paid for.
 */

type Bucket = 'awaiting_payment' | 'awaiting_review' | 'approved' | 'rejected'

interface Row {
  id: string
  full_name: string
  phone: string
  email: string | null
  submitted_at: string
  reviewed_at: string | null
  status: string
  bucket: Bucket
  payment_state: 'paid' | 'unpaid' | 'awaiting_confirmation' | 'no_fee'
  fee: number
  fee_paid: boolean
  registration_fee_ref: string | null
  rejection_reason: string | null
  created_member_id: string | null
  fee_resolution: string | null
  has_live_link: boolean
  payment_token_expires_at: string | null
  groups: string[]
}
interface Queue {
  rows: Row[]
  counts: Partial<Record<Bucket, number>>
  unpaid_approved: { count: number; total: number }
}

interface Detail extends Row {
  ghana_card_number?: string
  ghana_card_front_url?: string | null
  ghana_card_back_url?: string | null
  selected_groups?: { id: string; name: string; slots: number; fraction: number }[]
  selected_group_id?: string
}

const PAYMENT_TONE = {
  paid:                  { tone: 'good'    as const, label: 'Fee paid' },
  awaiting_confirmation: { tone: 'warn'    as const, label: 'Awaiting provider' },
  unpaid:                { tone: 'warn'    as const, label: 'Fee unpaid' },
  no_fee:                { tone: 'neutral' as const, label: 'No fee' },
}

export default function RegistrationsPage() {
  const toast = useToast()
  const [bucket, setBucket] = useState<Bucket>('awaiting_review')
  const [q, setQ] = useState<Queue | null>(null)
  const [loading, setLoading] = useState(true)

  const [selected, setSelected] = useState<Detail | null>(null)
  const [payoutDates, setPayoutDates] = useState<Record<string, string>>({})
  const [sendCreds, setSendCreds] = useState(false)
  const [reject, setReject] = useState('')
  const [busy, setBusy] = useState(false)

  // The 402 gate, and the override that answers it.
  const [gate, setGate] = useState<{ fee: number; message: string } | null>(null)
  const [override, setOverride] = useState('')

  const [feeReason, setFeeReason] = useState<Row | null>(null)
  const [feeWhy, setFeeWhy] = useState('')

  const [creds, setCreds] = useState<{
    member_id: string; passcode: string; full_name: string; phone: string; group?: string
  } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await callFunction<Queue>(
      `kyc-review?view=queue&bucket=${bucket}`, { token: getAdminToken()! })
    if (error) toast.error({ title: 'Could not load registrations', body: error })
    else setQ(data)
    setLoading(false)
  }, [bucket, toast])

  useEffect(() => { load() }, [load])

  /** Ghana Cards live in a private bucket. This mints a two-minute URL and
   *  records who looked — opening a national ID should leave a trace. */
  async function openDocument(path: string, subject: string) {
    const { data, error } = await callFunction<{ url: string }>('admin-document', {
      method: 'POST', body: { path, subject }, token: getAdminToken()!,
    })
    if (error || !data?.url) { toast.error({ title: 'Could not open document', body: error ?? undefined }); return }
    window.open(data.url, '_blank', 'noopener,noreferrer')
  }

  async function openDetail(row: Row) {
    setPayoutDates({}); setReject(''); setGate(null); setOverride('')
    // The list carries no Ghana Card and no document URLs — those are fetched
    // only when a reviewer actually opens an application.
    const { data } = await callFunction<Detail[]>(`kyc-review?status=${row.status}`, { token: getAdminToken()! })
    const full = (data ?? []).find(d => d.id === row.id)
    setSelected({ ...row, ...(full ?? {}) })
  }

  async function decide(action: 'approve' | 'reject', overrideReason?: string) {
    if (!selected) return
    if (action === 'reject' && reject.trim().length < 3) {
      toast.error({ title: 'A rejection needs a reason' }); return
    }
    setBusy(true)
    const { data, error } = await callFunction<{
      message: string; member_id?: string; passcode?: string
      error?: string; fee_due?: number
    }>(`kyc-review?id=${selected.id}`, {
      method: 'POST', token: getAdminToken()!,
      body: {
        action, rejection_reason: reject, payout_dates_slots: groupSlots(payoutDates),
        send_credentials: sendCreds,
        ...(overrideReason ? { override_unpaid_fee: true, override_reason: overrideReason } : {}),
      },
    })
    setBusy(false)

    // The gate answers 402 with a machine-readable reason. Surfacing it as a
    // decision, rather than as a failure, is the whole point of the gate.
    if (error === 'registration_fee_unpaid' || /registration fee of GHS/i.test(error ?? '')) {
      setGate({ fee: selected.fee, message: error ?? '' }); return
    }
    if (error) { toast.error({ title: 'Not completed', body: error }); return }

    if (action === 'approve' && data?.passcode) {
      setCreds({
        member_id: data.member_id!, passcode: data.passcode,
        full_name: selected.full_name, phone: selected.phone,
        group: selected.groups.join(', '),
      })
      return
    }
    toast.success({ title: action === 'approve' ? 'Member approved' : 'Application rejected' })
    setSelected(null); setGate(null); load()
  }

  async function reissueLink(row: Row) {
    const { data, error } = await callFunction<{ message: string; payment_url: string }>(
      `kyc-review?view=reissue_link&id=${row.id}`, { token: getAdminToken()! })
    if (error) { toast.error({ title: 'Could not send a link', body: error }); return }
    toast.success({ title: 'Payment link sent by SMS', body: data?.payment_url })
    load()
  }

  async function recordFee() {
    if (!feeReason) return
    setBusy(true)
    const { error } = await callFunction(`kyc-review?id=${feeReason.id}`, {
      method: 'POST', token: getAdminToken()!,
      body: { action: 'mark_fee_paid', reason: feeWhy.trim() },
    })
    setBusy(false)
    if (error) { toast.error({ title: 'Not recorded', body: error }); return }
    toast.success({ title: 'Registration fee recorded as received' })
    setFeeReason(null); setFeeWhy(''); load()
  }

  const shareText = creds ? credentialsMessage(creds) : ''
  const rows = q?.rows ?? []
  const counts = q?.counts ?? {}

  return (
    <Page>
      <PageHeader
        title="Registrations"
        sub="Applications, what they owe, and what has actually been received."
      />

      {(q?.unpaid_approved.count ?? 0) > 0 && (
        <Notice tone="warn" title="Approved members carrying an unpaid registration fee" className="mb-4">
          {q!.unpaid_approved.count} approved {q!.unpaid_approved.count === 1 ? 'member' : 'members'} —
          GHS {ghs2(q!.unpaid_approved.total)} outstanding. These are listed with the decisions
          available on the <a className="underline underline-offset-2" href="/admin/reconciliation">reconciliation</a> page.
        </Notice>
      )}

      <Segmented
        ariaLabel="Registration queue"
        value={bucket} onChange={setBucket}
        items={[
          { value: 'awaiting_payment', label: `Awaiting payment${counts.awaiting_payment ? ` · ${counts.awaiting_payment}` : ''}` },
          { value: 'awaiting_review',  label: `Paid, awaiting review${counts.awaiting_review ? ` · ${counts.awaiting_review}` : ''}` },
          { value: 'approved',         label: `Approved${counts.approved ? ` · ${counts.approved}` : ''}` },
          { value: 'rejected',         label: `Rejected${counts.rejected ? ` · ${counts.rejected}` : ''}` },
        ]}
      />

      {loading ? <LoadingBlock label="Loading registrations" className="h-[50vh]" />
        : rows.length === 0 ? (
          <Card pad="none" className="mt-5">
            <EmptyState icon={FileText}
              title={bucket === 'awaiting_payment' ? 'Nobody is waiting to pay'
                   : bucket === 'awaiting_review' ? 'Nothing to review'
                   : `No ${bucket} applications`} />
          </Card>
        ) : (
          <TableWrap className="mt-5">
            <THead>
              <TR>
                <TH>Applicant</TH>
                <TH hideBelow="sm">Contact</TH>
                <TH hideBelow="md">Group</TH>
                <TH>Applied</TH>
                <TH align="right">Fee</TH>
                <TH>Payment</TH>
                <TH>Approval</TH>
                <TH align="right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map(r => {
                const p = PAYMENT_TONE[r.payment_state]
                return (
                  <TR key={r.id}>
                    <TD><span className="text-ink font-medium">{r.full_name}</span></TD>
                    <TD hideBelow="sm">
                      <p className="font-mono text-2xs">{r.phone}</p>
                      {r.email && <p className="text-2xs text-ink-3 truncate max-w-[160px]">{r.email}</p>}
                    </TD>
                    <TD hideBelow="md">
                      <span className="text-ink-2">{r.groups.join(', ') || '—'}</span>
                    </TD>
                    <TD className="tnum">{format(new Date(r.submitted_at), 'd MMM yy')}</TD>
                    <TD align="right" className="tnum">{r.fee > 0 ? `GHS ${ghs2(r.fee)}` : '—'}</TD>
                    <TD><Badge tone={p.tone}>{p.label}</Badge></TD>
                    <TD>
                      <Badge tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'bad' : 'neutral'}>
                        {r.status}
                      </Badge>
                      {r.fee_resolution && (
                        <p className="text-2xs text-ink-3 mt-0.5">{r.fee_resolution}</p>
                      )}
                    </TD>
                    <TD align="right">
                      <div className="inline-flex gap-1.5">
                        {r.status === 'pending' && r.payment_state === 'unpaid' && (
                          <>
                            <Button size="sm" variant="ghost" icon={Link2}
                                    onClick={() => reissueLink(r)}>
                              {r.has_live_link ? 'Resend link' : 'Send link'}
                            </Button>
                            <Button size="sm" variant="ghost" icon={Wallet}
                                    onClick={() => { setFeeReason(r); setFeeWhy('') }}>
                              Fee received
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="outline" onClick={() => openDetail(r)}>Review</Button>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </TableWrap>
        )}

      {/* ══ REVIEW ══════════════════════════════════════════════════════ */}
      <Modal open={!!selected && !creds} onClose={() => setSelected(null)} busy={busy}
             title="Review application" size="lg">
        {selected && (
          <>
            <DetailList>
              <DetailRow label="Name">{selected.full_name}</DetailRow>
              <DetailRow label="Phone"><span className="font-mono">{selected.phone}</span></DetailRow>
              <DetailRow label="Email">{selected.email ?? '—'}</DetailRow>
              <DetailRow label="Ghana Card">
                <span className="font-mono">{selected.ghana_card_number ?? '—'}</span>
              </DetailRow>
              <DetailRow label={selected.groups.length > 1 ? 'Groups' : 'Group'}>
                {selected.groups.join(', ') || '—'}
              </DetailRow>
              <DetailRow label="Registration fee">
                {selected.fee > 0 ? `GHS ${ghs2(selected.fee)}` : 'None'}
              </DetailRow>
              <DetailRow label="Payment">
                <Badge tone={PAYMENT_TONE[selected.payment_state].tone}>
                  {PAYMENT_TONE[selected.payment_state].label}
                </Badge>
              </DetailRow>
              {selected.registration_fee_ref && (
                <DetailRow label="Payment reference">
                  <span className="font-mono text-2xs">{selected.registration_fee_ref}</span>
                </DetailRow>
              )}
            </DetailList>

            {(selected.ghana_card_front_url || selected.ghana_card_back_url) && (
              <div className="flex gap-2 mt-3">
                {selected.ghana_card_front_url && (
                  <Button size="sm" variant="outline" icon={FileText}
                    onClick={() => openDocument(selected.ghana_card_front_url!, selected.full_name)}>
                    Ghana Card front
                  </Button>
                )}
                {selected.ghana_card_back_url && (
                  <Button size="sm" variant="outline" icon={FileText}
                    onClick={() => openDocument(selected.ghana_card_back_url!, selected.full_name)}>
                    Back
                  </Button>
                )}
              </div>
            )}

            {selected.status === 'pending' && (
              <>
                <div className="mt-5 rounded-md border border-line p-3.5">
                  <p className="text-sm font-medium text-ink">
                    Payout date{(selected.selected_groups?.length ?? 1) > 1 ? 's' : ''}
                    <span className="text-ink-3 font-normal"> — set on approval</span>
                  </p>
                  <div className="space-y-2 mt-2.5">
                    {(selected.selected_groups ?? []).flatMap(g =>
                      Array.from({ length: Math.max(1, g.slots ?? 1) }, (_, i) => (
                        <div key={`${g.id}:${i}`} className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-2 flex-1 truncate">
                            {g.name}{(g.slots ?? 1) > 1 ? ` — slot ${i + 1} of ${g.slots}` : ''}
                          </span>
                          <Input type="date" className="max-w-[170px]"
                            value={payoutDates[`${g.id}:${i}`] ?? ''}
                            onChange={e => setPayoutDates(p => ({ ...p, [`${g.id}:${i}`]: e.target.value }))} />
                        </div>
                      )))}
                  </div>
                  <p className="text-xs text-ink-3 mt-2">
                    Each slot is its own payout turn. Blank ones can be set later from the member&rsquo;s page.
                  </p>
                </div>

                <Checkbox className="mt-3" checked={sendCreds}
                          onChange={e => setSendCreds(e.target.checked)}
                          label="Send the sign-in SMS on approval"
                          hint="Leave unticked to approve quietly and invite later from Members → Send invites." />

                <Field label="Rejection reason" hint="Required only if you are rejecting." className="mt-4">
                  {ids => (
                    <Textarea {...ids} rows={2} value={reject} onChange={e => setReject(e.target.value)}
                              placeholder="e.g. Could not verify the Ghana Card number" />
                  )}
                </Field>

                {/* The gate. Shown where the decision is made, not as an alert. */}
                {gate && (
                  <div className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-3.5">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      <ShieldAlert size={15} strokeWidth={2.2} className="text-warning" aria-hidden="true" />
                      Approval blocked — the registration fee has not been received
                    </p>
                    <p className="text-sm text-ink-2 mt-1.5">
                      Approving would activate a membership of GHS {ghs2(gate.fee)} that has not been
                      paid for. Record the payment when it arrives, or override — which activates
                      the membership <strong>without creating any payment record</strong> and
                      writes your name and reason to the audit log.
                    </p>
                    <Field label="Override reason" className="mt-3"
                           hint="At least 10 characters. Stored in the audit log.">
                      {ids => (
                        <Textarea {...ids} rows={2} value={override}
                                  onChange={e => setOverride(e.target.value)}
                                  placeholder="Why this membership is being activated unpaid" />
                      )}
                    </Field>
                    <Button className="mt-3" variant="danger" loading={busy}
                            disabled={override.trim().length < 10}
                            onClick={() => decide('approve', override.trim())}>
                      Approve without payment
                    </Button>
                  </div>
                )}

                <ModalActions>
                  <Button variant="ghost" icon={XCircle} loading={busy}
                          onClick={() => decide('reject')}>Reject</Button>
                  <Button icon={UserCheck} loading={busy}
                          onClick={() => decide('approve')}>Approve</Button>
                </ModalActions>
              </>
            )}
          </>
        )}
      </Modal>

      {/* ══ RECORD A FEE TAKEN OUTSIDE THE APP ══════════════════════════ */}
      <Modal open={!!feeReason} onClose={() => { setFeeReason(null); setFeeWhy('') }} busy={busy}
             title="Record the registration fee as received">
        {feeReason && (
          <>
            <p className="text-sm text-ink-2">
              Use this only when the money has actually been taken — in cash, or by a transfer
              you have seen. It writes a <strong>real payment record</strong> for the full fee
              under your name; it is not a flag.
            </p>
            <p className="text-sm text-ink mt-3 font-medium">
              {feeReason.full_name} — GHS {ghs2(feeReason.fee)}
            </p>
            <Field label="Where the money came from" className="mt-4"
                   hint="At least 10 characters. Written to the audit log.">
              {ids => (
                <Textarea {...ids} rows={3} value={feeWhy} onChange={e => setFeeWhy(e.target.value)}
                          placeholder="e.g. Cash taken at the Madina office on 30 Aug, receipt 0412" />
              )}
            </Field>
            <ModalActions>
              <Button variant="ghost" onClick={() => { setFeeReason(null); setFeeWhy('') }}>Cancel</Button>
              <Button loading={busy} disabled={feeWhy.trim().length < 10} onClick={recordFee}>
                Record payment
              </Button>
            </ModalActions>
          </>
        )}
      </Modal>

      {/* ══ APPROVED — get the credentials to the member ════════════════ */}
      <Modal open={!!creds} onClose={() => { setCreds(null); setSelected(null); load() }}
             title="Approved" hideClose>
        {creds && (
          <>
            <p className="text-sm text-ink-2">
              Send {creds.full_name.split(' ')[0]} the details below. They cannot sign in until you do.
            </p>
            <DetailList className="mt-4">
              <DetailRow label="Portal link"><span className="break-all text-2xs">{memberSignInUrl()}</span></DetailRow>
              <DetailRow label="Phone"><span className="font-mono">{creds.phone}</span></DetailRow>
              <DetailRow label="Passcode">
                <span className="text-xl font-semibold tnum tracking-[.12em]">{creds.passcode}</span>
              </DetailRow>
              <DetailRow label="Member ID"><span className="font-mono">{creds.member_id}</span></DetailRow>
            </DetailList>
            <p className="text-xs text-ink-3 mt-3">
              The passcode is shown once. If it is lost, reset it from the member&rsquo;s page.
            </p>
            <ModalActions>
              <Button variant="outline"
                onClick={() => { navigator.clipboard.writeText(shareText); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button onClick={() => window.open(whatsappLink(creds.phone, shareText), '_blank')}>
                Send on WhatsApp
              </Button>
            </ModalActions>
          </>
        )}
      </Modal>
    </Page>
  )
}

/** `{ "<groupId>:<slot>": date }` → `{ "<groupId>": [d0, d1, …] }`. */
function groupSlots(flat: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(flat)) {
    if (!value) continue
    const [gid, idx] = key.split(':')
    ;(out[gid] ??= [])[Number(idx)] = value
  }
  return out
}
