'use client'
import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { CheckCircle2, Clock } from 'lucide-react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import { ghs2 } from '@/lib/money'
import type { MembershipView, PaymentPreview } from '@/types/portal'
import {
  Button, Checkbox, Field, Input, LoadingBlock, Modal, ModalActions,
  Money, Notice, Select, useToast, cx,
} from '@/components/ui'

/**
 * Choose an amount, see exactly what it will cover, then pay.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The preview is not computed here, and it is not an estimate. It comes from
 * `preview_settlement()`, which runs the REAL settlement inside a savepoint
 * and rolls it back — so what this screen shows is the same execution that
 * will move the money, not a second implementation that might disagree.
 *
 * That matters most for a partial: paying GHS 250 against GHS 100/day covers
 * two days fully and puts GHS 50 against a third. Calling that third day
 * "paid" would be a lie, so the sheet states the shortfall explicitly.
 *
 * Nothing financial is decided in this component. It sends a requested amount;
 * the server decides what that amount covers.
 */
export default function PaySheet({
  membership, defaultNumber, defaultNetwork = 'MTN', hasOtherMemberships,
  onClose, onPrompted, onBusy,
}: {
  membership: MembershipView
  defaultNumber?: string | null
  defaultNetwork?: string | null
  hasOtherMemberships: boolean
  onClose: () => void
  onPrompted: (p: any) => void
  onBusy: (id: string | null) => void
}) {
  const toast = useToast()
  const owes = Math.max(membership.due_today, 0)
  const daily = membership.contribution_amount

  const [amount, setAmount]   = useState(String(owes > 0 ? owes : daily))
  const [thisOnly, setThisOnly] = useState(true)
  const [useOther, setUseOther] = useState(false)
  const [number, setNumber]   = useState(defaultNumber ?? '')
  const [network, setNetwork] = useState(defaultNetwork ?? 'MTN')

  const [preview, setPreview] = useState<PaymentPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewErr, setPreviewErr] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const value = Math.round((Number(amount) || 0) * 100) / 100
  const chosen = (useOther ? number : defaultNumber ?? '').replace(/\s/g, '')
  const numberValid = /^0\d{9}$/.test(chosen) || /^233\d{9}$/.test(chosen)

  // Ask the server what this amount would cover. Debounced, because the member
  // is typing.
  const runPreview = useCallback(async (amt: number, only: boolean) => {
    if (amt <= 0) { setPreview(null); return }
    setPreviewing(true); setPreviewErr('')
    const { data, error } = await callFunction<PaymentPreview>('payments-preview', {
      method: 'POST', token: getMemberToken()!,
      body: { membership_id: membership.membership_id, amount: amt, this_group_only: only },
    })
    setPreviewing(false)
    if (error) { setPreviewErr(error); setPreview(null); return }
    setPreview(data)
  }, [membership.membership_id])

  useEffect(() => {
    const t = setTimeout(() => runPreview(value, thisOnly), 350)
    return () => clearTimeout(t)
  }, [value, thisOnly, runPreview])

  async function pay() {
    setSubmitting(true); onBusy(membership.membership_id)
    const { data, error } = await callFunction<any>('payments-initialize', {
      method: 'POST', token: getMemberToken()!,
      body: {
        membership_id: membership.membership_id,
        pay_amount: value,
        pay_number: chosen,
        pay_network: useOther ? network : defaultNetwork,
        this_group_only: thisOnly,
      },
    })
    setSubmitting(false); onBusy(null)
    if (error) { toast.error({ title: 'Payment could not start', body: error }); return }
    if (data?.dev_mode) { toast.success('Payment recorded.'); onClose(); return }
    if (data?.status === 'prompted' || data?.status === 'otp_required') { onPrompted(data); return }
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  const presets = [owes > 0 ? owes : daily, daily * 7, daily * 14, daily * 30]
    .filter((v, i, a) => v > 0 && a.indexOf(v) === i)

  return (
    <Modal
      open onClose={onClose} busy={submitting}
      title={membership.group_name}
      description={`GHS ${ghs2(daily)} ${membership.frequency} · Slot ${membership.payout_position}`}
      size="lg"
      footer={
        <ModalActions>
          <Button variant="outline" onClick={onClose} full className="sm:w-auto">Cancel</Button>
          <Button
            variant="accent" onClick={pay} loading={submitting}
            disabled={!numberValid || value <= 0 || !!previewErr}
            full className="sm:w-auto"
          >
            Pay GHS {ghs2(value)}
          </Button>
        </ModalActions>
      }
    >
      <div className="space-y-5">
        <Field label="How much are you paying?">
          {({ id }) => (
            <>
              <Input
                id={id} type="number" min="1" step="0.5" inputMode="decimal"
                prefix="GHS" className="tnum text-lg font-semibold"
                value={amount} onChange={e => setAmount(e.target.value)}
              />
              <div className="flex gap-2 mt-2 flex-wrap">
                {presets.map(p => (
                  <button
                    key={p} type="button" onClick={() => setAmount(String(p))}
                    className={cx(
                      'h-8 px-3 rounded-sm text-xs font-medium transition-colors tnum',
                      value === p ? 'bg-ink text-inverse'
                                  : 'bg-surface border border-line text-ink-2 hover:text-ink',
                    )}
                  >
                    {p === owes && owes > 0 ? `Due today · ${ghs2(p)}` : ghs2(p)}
                  </button>
                ))}
              </div>
            </>
          )}
        </Field>

        {hasOtherMemberships && (
          <Checkbox
            boxed
            checked={thisOnly}
            onChange={e => setThisOnly(e.target.checked)}
            label="Only pay this group"
            hint={thisOnly
              ? 'Anything left over stays as credit on this group and is never used elsewhere.'
              : 'Any surplus may also clear what you owe in your other groups.'}
          />
        )}

        {/* What this payment will cover — from the real settlement engine. */}
        <div>
          <p className="t-eyebrow mb-2">What this covers</p>

          {previewErr ? (
            <Notice tone="bad">{previewErr}</Notice>
          ) : previewing && !preview ? (
            <LoadingBlock label="Working out what this covers" className="py-8" />
          ) : !preview || preview.covers.length === 0 ? (
            <p className="text-sm text-ink-3 py-3">
              {value > 0
                ? 'Nothing is owing on this group, so the whole amount would be held as credit.'
                : 'Enter an amount to see what it covers.'}
            </p>
          ) : (
            <div className={cx('rounded-md border border-line divide-y divide-line-2',
                               previewing && 'opacity-60')}>
              {preview.covers.map(c => (
                <div key={c.contribution_id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex items-center gap-2">
                    {c.kind === 'full'
                      ? <CheckCircle2 size={14} strokeWidth={2.4} className="text-success shrink-0" aria-hidden="true" />
                      : <Clock size={14} strokeWidth={2.4} className="text-warning shrink-0" aria-hidden="true" />}
                    <div className="min-w-0">
                      <p className="text-sm text-ink truncate">
                        {format(new Date(c.due_date), 'EEE d MMM')}
                      </p>
                      {preview.memberships_touched > 1 && (
                        <p className="text-2xs text-ink-3 truncate">{c.group_name}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-ink tnum">GHS {ghs2(c.amount)}</p>
                    {c.remaining_after > 0.005 && (
                      <p className="text-2xs text-warning tnum">
                        GHS {ghs2(c.remaining_after)} still to go
                      </p>
                    )}
                  </div>
                </div>
              ))}

              <div className="px-3.5 py-3 bg-surface-2 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-ink-2">
                    {preview.days_fully_covered} day{preview.days_fully_covered === 1 ? '' : 's'} fully covered
                    {preview.days_partly_covered > 0 && `, ${preview.days_partly_covered} part`}
                  </span>
                  <Money value={preview.total_allocated} exact size="sm" />
                </div>
                {preview.credit_after > 0.005 && (
                  <p className="text-xs text-ink-2">
                    GHS {ghs2(preview.credit_after)} would be left as credit on this group.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Which wallet to debit. */}
        <div className="space-y-2">
          <p className="t-eyebrow">Pay from</p>
          {defaultNumber && (
            <Checkbox
              boxed checked={!useOther} onChange={() => setUseOther(false)}
              label={defaultNumber}
              hint={`Your number on file · ${defaultNetwork}`}
            />
          )}
          <Checkbox
            boxed checked={useOther || !defaultNumber} onChange={() => setUseOther(true)}
            label="Pay from a different number"
          />
          {(useOther || !defaultNumber) && (
            <div className="space-y-2 pt-1 animate-fade-in">
              <Input
                inputMode="tel" placeholder="024XXXXXXX" autoFocus
                value={number} onChange={e => setNumber(e.target.value)}
                invalid={!!number && !numberValid}
              />
              <Select value={network} onChange={e => setNetwork(e.target.value)}>
                <option value="MTN">MTN</option>
                <option value="TELECEL">Telecel / Vodafone</option>
                <option value="AIRTELTIGO">AirtelTigo</option>
              </Select>
            </div>
          )}
        </div>

        <p className="text-xs text-ink-3 leading-relaxed">
          A prompt goes to that number. Approve it with your MoMo PIN — nothing is
          recorded until your network confirms the payment.
        </p>
      </div>
    </Modal>
  )
}
