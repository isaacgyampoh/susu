'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  RefreshCw, AlertTriangle, ShieldQuestion, Ban, Flag, StickyNote,
  CheckCheck, Search,
} from 'lucide-react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { ghs2 } from '@/lib/money'
import {
  Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, ModalActions,
  Notice, Page, PageHeader, Section, Segmented, Stat, Textarea,
  TableWrap, THead, TH, TBody, TR, TD, cx, useToast,
} from '@/components/ui'

/**
 * RECONCILIATION — the money that is not yet resolved.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Three populations, none of which this system can settle on its own:
 *
 *   402 payments pending over 48 hours          GHS 40,658
 *    13 approved registrations, fee unpaid      GHS  1,320.50
 *     7 registrations marked paid with no
 *       payment record and no audit row         GHS  1,745
 *
 * THE BUTTON THAT ISN'T HERE
 *
 * There is no "mark successful". It is the obvious thing to build and the one
 * that must not exist: a console cannot know whether money moved, and a button
 * asserting that it did would manufacture a financial fact that then flows
 * into every total, statement and payout in the system.
 *
 * "Refresh" is the safe equivalent. It re-asks NaloPay and settles ONLY if
 * NaloPay confirms — through `settle_payment()`, the same engine a webhook
 * uses, so it cannot produce a different answer from one. An operator can
 * therefore clear a genuinely completed payment and cannot clear one that
 * never completed.
 *
 * Every other action here moves no money at all. They record what a named
 * person decided, with a reason, in the audit log.
 */

type Kind = 'payments' | 'unpaid' | 'no_evidence'

interface StuckPayment {
  id: string; reference: string; amount: number; created: string; type: string
  age_days: number; member_code: string | null; member_name: string | null
  membership_id: string | null; provider_reference: string | null
  refreshable: boolean; group: string | null
}
interface UnpaidReg {
  id: string; name: string; phone: string; fee: number
  submitted: string; reviewed: string | null
  member_code: string | null; member_status: string | null
  active_memberships: number; contributed_since: number
  resolution: string | null; resolution_reason: string | null; resolution_at: string | null
}
interface NoEvidenceReg {
  id: string; name: string; phone: string; fee: number; status: string
  submitted: string; member_code: string | null; member_status: string | null
  groups_still_exist: boolean; pending_or_failed_attempts: number; resolution: string | null
}
interface Queue {
  generated_at: string
  unpaid_registrations:  { count: number; value: number; items: UnpaidReg[] }
  paid_without_evidence: { count: number; value: number; items: NoEvidenceReg[] }
  stuck_payments: {
    count: number; value: number; items: StuckPayment[]
    by_kind: { prefix: string; count: number; value: number; oldest: string; newest: string; has_provider_reference: number }[]
  }
  other: Record<string, number>
}

interface Pending {
  kind: 'registration' | 'payment'
  id: string
  action: string
  label: string
  title: string
  body: string
  needsReason: boolean
}

export default function ReconciliationPage() {
  const toast = useToast()
  const [q, setQ]             = useState<Queue | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<Kind>('payments')
  const [filter, setFilter]   = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [reason, setReason]   = useState('')
  const [busy, setBusy]       = useState(false)
  const [refreshing, setRefreshing] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await callFunction<Queue>('admin-reconciliation', { token: getAdminToken()! })
    if (error) toast.error({ title: 'Could not load the queue', body: error })
    else setQ(data)
    setLoading(false)
  }, [toast])

  useEffect(() => { load() }, [load])

  async function act(p: Pending, why: string) {
    setBusy(true)
    const { data, error } = await callFunction<{ message?: string; status?: string; days_cleared?: number }>(
      'admin-reconciliation',
      { method: 'POST', token: getAdminToken()!, body: { kind: p.kind, id: p.id, action: p.action, reason: why } })
    setBusy(false)
    if (error) { toast.error({ title: 'Not recorded', body: error }); return }
    toast.success({ title: data?.message ?? 'Recorded' })
    setPending(null); setReason('')
    load()
  }

  /** Ask the provider about one payment. Settles only if it confirms. */
  async function refresh(row: StuckPayment) {
    setRefreshing(row.id)
    const { data, error } = await callFunction<{ status: string; message: string }>(
      'admin-reconciliation',
      { method: 'POST', token: getAdminToken()!, body: { kind: 'payment', id: row.id, action: 'refresh' } })
    setRefreshing(null)
    if (error) { toast.error({ title: 'Could not ask NaloPay', body: error }); return }
    const settled = data?.status === 'settled'
    toast[settled ? 'success' : 'info']({
      title: settled ? 'Confirmed and settled' : 'No change',
      body: data?.message,
    })
    if (data?.status !== 'pending') load()
  }

  const payments = useMemo(() => {
    const rows = q?.stuck_payments.items ?? []
    const f = filter.trim().toLowerCase()
    if (!f) return rows
    return rows.filter(r =>
      r.reference.toLowerCase().includes(f) ||
      (r.member_name ?? '').toLowerCase().includes(f) ||
      (r.member_code ?? '').toLowerCase().includes(f) ||
      (r.provider_reference ?? '').toLowerCase().includes(f))
  }, [q, filter])

  if (loading) return <LoadingBlock label="Reading the reconciliation queue" className="h-[70vh]" />
  if (!q) return null

  return (
    <Page>
      <PageHeader
        title="Reconciliation"
        sub="Money that needs a person to decide. Nothing here is resolved automatically."
        actions={<Button variant="outline" icon={RefreshCw} onClick={load}>Refresh</Button>}
      />

      {/* The three populations, sized. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Payments pending over 48h" value={`GHS ${ghs2(q.stuck_payments.value)}`}
              sub={`${q.stuck_payments.count} payments`} />
        <Stat label="Approved, fee unpaid" value={`GHS ${ghs2(q.unpaid_registrations.value)}`}
              sub={`${q.unpaid_registrations.count} registrations`} />
        <Stat label="Marked paid, no record" value={`GHS ${ghs2(q.paid_without_evidence.value)}`}
              sub={`${q.paid_without_evidence.count} registrations`} />
      </div>

      <Notice tone="info" title="A payment becomes successful when the provider says so" className="mt-4">
        There is no action here that marks a payment received. <strong>Refresh</strong> re-asks
        NaloPay and settles only if NaloPay confirms it. Everything else records a decision
        in the audit log and moves no money.
      </Notice>

      <Segmented
        ariaLabel="Reconciliation view"
        className="mt-5"
        value={tab} onChange={setTab}
        items={[
          { value: 'payments',    label: `Stuck payments · ${q.stuck_payments.count}` },
          { value: 'unpaid',      label: `Fee unpaid · ${q.unpaid_registrations.count}` },
          { value: 'no_evidence', label: `Paid, no record · ${q.paid_without_evidence.count}` },
        ]}
      />

      {/* ══ STUCK PAYMENTS ══════════════════════════════════════════════ */}
      {tab === 'payments' && (
        <Section className="mt-4">
          <div className="flex flex-wrap gap-2 items-end justify-between">
            <div className="flex flex-wrap gap-1.5">
              {q.stuck_payments.by_kind.map(k => (
                <Badge key={k.prefix} tone="neutral">
                  {k.prefix} · {k.count} · GHS {ghs2(k.value)}
                  {k.has_provider_reference < k.count &&
                    ` · ${k.count - k.has_provider_reference} without a provider ref`}
                </Badge>
              ))}
            </div>
            <Field label="Find" className="max-w-[260px]">
              {ids => (
                <Input {...ids} icon={Search} value={filter} onChange={e => setFilter(e.target.value)}
                       placeholder="Reference, member, provider ref" />
              )}
            </Field>
          </div>

          <p className="text-xs text-ink-3 mt-2 tnum">
            Showing {payments.length} of {q.stuck_payments.count}. The totals above are
            complete and come from the database, not from this page.
          </p>

          <TableWrap className="mt-3">
            <THead>
              <TR>
                <TH>Member</TH><TH>Group</TH><TH align="right">Amount</TH>
                <TH>Age</TH><TH>Our reference</TH><TH>Provider reference</TH><TH align="right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {payments.map(r => (
                <TR key={r.id}>
                  <TD>
                    <p className="text-ink">{r.member_name ?? '—'}</p>
                    <p className="text-2xs text-ink-3 font-mono">{r.member_code ?? '—'}</p>
                  </TD>
                  <TD>{r.group ?? <span className="text-ink-3">—</span>}</TD>
                  <TD align="right" className="tnum font-medium">GHS {ghs2(r.amount)}</TD>
                  <TD>
                    <span className={cx('tnum', r.age_days > 30 ? 'text-warning' : 'text-ink-2')}>
                      {r.age_days}d
                    </span>
                    <p className="text-2xs text-ink-3">{format(new Date(r.created), 'd MMM yy')}</p>
                  </TD>
                  <TD><span className="font-mono text-2xs">{r.reference}</span></TD>
                  <TD>
                    {r.provider_reference
                      ? <span className="font-mono text-2xs">{r.provider_reference}</span>
                      : <Badge tone="warn">Never reached NaloPay</Badge>}
                  </TD>
                  <TD align="right">
                    <div className="inline-flex gap-1.5">
                      {/* Only offered when NaloPay can actually be asked. */}
                      {r.refreshable && (
                        <Button size="sm" variant="outline" icon={RefreshCw}
                                loading={refreshing === r.id}
                                onClick={() => refresh(r)}>Refresh</Button>
                      )}
                      <Button size="sm" variant="ghost" icon={Ban}
                        onClick={() => setPending({
                          kind: 'payment', id: r.id, action: 'abandoned',
                          label: `${r.reference} — GHS ${ghs2(r.amount)}`,
                          title: 'Record this payment as abandoned',
                          body: 'This asserts nothing about the provider. It records that the payment '
                              + 'is not expected to arrive, so it stops being counted as money in flight. '
                              + 'No contribution is settled and no money is created.',
                          needsReason: true,
                        })}>Abandon</Button>
                      <Button size="sm" variant="ghost" icon={StickyNote}
                        onClick={() => setPending({
                          kind: 'payment', id: r.id, action: 'note',
                          label: r.reference, title: 'Add an internal note',
                          body: 'Recorded in the audit log against this payment. Nothing changes.',
                          needsReason: true,
                        })}>Note</Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableWrap>
          {payments.length === 0 && (
            <Card pad="none" className="mt-3">
              <EmptyState icon={Search} title="Nothing matches" compact />
            </Card>
          )}
        </Section>
      )}

      {/* ══ APPROVED BUT UNPAID ═════════════════════════════════════════ */}
      {tab === 'unpaid' && (
        <Section className="mt-4">
          <Notice tone="warn" title="These members are active but their registration fee was never received">
            Recording a fee as received creates a real payment record, and should only be done
            when the money has actually been taken. Waiving, pursuing or suspending records a
            decision and moves nothing.
          </Notice>

          <TableWrap className="mt-3">
            <THead>
              <TR>
                <TH>Applicant</TH><TH>Member</TH><TH align="right">Fee</TH>
                <TH align="right">Contributed since</TH><TH>Decision</TH><TH align="right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {q.unpaid_registrations.items.map(r => (
                <TR key={r.id}>
                  <TD>
                    <p className="text-ink">{r.name}</p>
                    <p className="text-2xs text-ink-3 font-mono">{r.phone}</p>
                  </TD>
                  <TD>
                    {r.member_code
                      ? <>
                          <p className="font-mono text-2xs">{r.member_code}</p>
                          <p className="text-2xs text-ink-3">
                            {r.member_status} · {r.active_memberships} active
                          </p>
                        </>
                      : <span className="text-ink-3">No member created</span>}
                  </TD>
                  <TD align="right" className="tnum font-medium">GHS {ghs2(r.fee)}</TD>
                  <TD align="right" className="tnum">GHS {ghs2(r.contributed_since)}</TD>
                  <TD>
                    {r.resolution
                      ? <>
                          <Badge tone="neutral">{r.resolution}</Badge>
                          {r.resolution_reason && (
                            <p className="text-2xs text-ink-3 mt-1 max-w-[220px]">{r.resolution_reason}</p>
                          )}
                        </>
                      : <span className="text-ink-3">—</span>}
                  </TD>
                  <TD align="right">
                    <div className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" icon={CheckCheck}
                        onClick={() => setPending({
                          kind: 'registration', id: r.id, action: 'fee_received',
                          label: `${r.name} — GHS ${ghs2(r.fee)}`,
                          title: 'Record the fee as received',
                          body: 'Use this only when the money has actually been taken, in cash or by '
                              + 'transfer. It writes a real payment record for the full fee — it is not '
                              + 'a flag. Say where the money came from.',
                          needsReason: true,
                        })}>Fee received</Button>
                      <Button size="sm" variant="ghost" icon={Flag}
                        onClick={() => setPending({
                          kind: 'registration', id: r.id, action: 'pursuing',
                          label: r.name, title: 'Mark as being collected',
                          body: 'Records that this fee is being pursued. No money moves.',
                          needsReason: true,
                        })}>Pursuing</Button>
                      <Button size="sm" variant="ghost" icon={ShieldQuestion}
                        onClick={() => setPending({
                          kind: 'registration', id: r.id, action: 'waived',
                          label: `${r.name} — GHS ${ghs2(r.fee)}`,
                          title: 'Waive this registration fee',
                          body: 'Records a decision not to collect. The fee stays unpaid — waiving is '
                              + 'not paying, and this never creates a payment record.',
                          needsReason: true,
                        })}>Waive</Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableWrap>
        </Section>
      )}

      {/* ══ MARKED PAID, NO RECORD ══════════════════════════════════════ */}
      {tab === 'no_evidence' && (
        <Section className="mt-4">
          <Notice tone="warn" title="Marked paid, with nothing behind it">
            These applications say the registration fee was received, but there is no successful
            payment anywhere and no audit entry recording who decided it. They date from 19–21 July,
            before payment recording was audited. <strong>Nothing has been changed.</strong> Reversing
            a fee flag on a live member because a record is missing would be guessing at payment
            status — the operator may simply remember taking the cash.
          </Notice>

          <TableWrap className="mt-3">
            <THead>
              <TR>
                <TH>Applicant</TH><TH>Member</TH><TH align="right">Fee</TH>
                <TH>Application</TH><TH>Evidence</TH><TH align="right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {q.paid_without_evidence.items.map(r => (
                <TR key={r.id}>
                  <TD>
                    <p className="text-ink">{r.name}</p>
                    <p className="text-2xs text-ink-3 font-mono">{r.phone}</p>
                  </TD>
                  <TD>
                    {r.member_code
                      ? <>
                          <p className="font-mono text-2xs">{r.member_code}</p>
                          <p className="text-2xs text-ink-3">{r.member_status}</p>
                        </>
                      : <span className="text-ink-3">No member created</span>}
                  </TD>
                  <TD align="right" className="tnum font-medium">GHS {ghs2(r.fee)}</TD>
                  <TD>{r.status}</TD>
                  <TD>
                    <div className="flex flex-col gap-1 items-start">
                      {!r.groups_still_exist && <Badge tone="warn">Groups deleted</Badge>}
                      {r.pending_or_failed_attempts > 0
                        ? <Badge tone="neutral">{r.pending_or_failed_attempts} unsuccessful attempt(s)</Badge>
                        : <Badge tone="neutral">No payment attempt</Badge>}
                    </div>
                  </TD>
                  <TD align="right">
                    <Button size="sm" variant="ghost" icon={StickyNote}
                      onClick={() => setPending({
                        kind: 'registration', id: r.id, action: 'note',
                        label: r.name, title: 'Record what you know',
                        body: 'Writes to the audit log against this application. It changes no money '
                            + 'and no flag — it fills in the record that is missing.',
                        needsReason: true,
                      })}>Record what happened</Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableWrap>
        </Section>
      )}

      <p className="text-2xs text-ink-3 mt-6 tnum">
        Generated {format(new Date(q.generated_at), 'd MMM yyyy, HH:mm')} ·
        {' '}allocations against unpaid days: {q.other.allocations_against_unpaid_days} ·
        {' '}memberships without a schedule: {q.other.memberships_without_schedule}
      </p>

      {/* Every action states plainly what it does and does not do. */}
      <Modal
        open={!!pending}
        onClose={() => { setPending(null); setReason('') }}
        title={pending?.title ?? ''}
      >
        {pending && (
          <>
            <p className="text-sm text-ink-2">{pending.body}</p>
            <p className="text-sm text-ink mt-3 font-medium">{pending.label}</p>
            <Field label="Reason" hint="At least 10 characters. Written to the audit log with your name."
                   className="mt-4">
              {ids => (
                <Textarea {...ids} value={reason} onChange={e => setReason(e.target.value)} rows={3}
                          placeholder="What happened, and how you know" />
              )}
            </Field>
            <ModalActions>
              <Button variant="ghost" onClick={() => { setPending(null); setReason('') }}>Cancel</Button>
              <Button loading={busy} disabled={reason.trim().length < 10}
                      onClick={() => act(pending, reason.trim())}>Record</Button>
            </ModalActions>
          </>
        )}
      </Modal>
    </Page>
  )
}
