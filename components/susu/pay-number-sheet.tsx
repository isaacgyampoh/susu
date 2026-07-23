'use client'
import { useState } from 'react'

/*
 * Before firing the prompt, let the member confirm the MoMo number — or pay
 * from a DIFFERENT one. Their registration number may not have mobile money,
 * or they may want to pay from another wallet. The chosen number/network is
 * passed to payments-initialize as pay_number / pay_network.
 */
export default function PayNumberSheet({
  defaultNumber, defaultNetwork = 'MTN', amount, feePct = 1.5,
  groupName, slotLabel, dueDate, onConfirm, onClose,
}: {
  defaultNumber?: string
  defaultNetwork?: string
  amount: number
  feePct?: number
  groupName?: string
  slotLabel?: string
  dueDate?: string
  onConfirm: (payNumber: string, payNetwork: string, payAmount: number) => void
  onClose: () => void
}) {
  const [payAmount, setPayAmount] = useState(String(amount))
  const base    = Math.max(0, Number(payAmount) || 0)
  const fee     = Math.round(base * (feePct / 100) * 100) / 100
  const charged = Math.round((base + fee) * 100) / 100
  const extra   = Math.round((base - amount) * 100) / 100
  const [useOther, setUseOther] = useState(false)
  const [number, setNumber]     = useState(defaultNumber ?? '')
  const [network, setNetwork]   = useState(defaultNetwork)

  const chosen = useOther ? number.trim() : (defaultNumber ?? '')
  const valid  = /^0\d{9}$/.test(chosen.replace(/\s/g, '')) || /^233\d{9}$/.test(chosen.replace(/\s/g, ''))

  return (
    <div className="fixed inset-0 z-50 bg-ink/30 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-surface w-full sm:max-w-[380px] rounded-t-2xl sm:rounded-2xl p-6 animate-fade-in" onClick={e => e.stopPropagation()}>
        <h2 className="text-[19px] font-semibold tracking-[-.02em]">
          {groupName ?? 'Pay contribution'}
        </h2>
        {(slotLabel || dueDate) && (
          <p className="text-[12.5px] text-ink-2 mt-0.5">
            {slotLabel}{slotLabel && dueDate ? ' · ' : ''}{dueDate ? `for ${dueDate}` : ''}
          </p>
        )}

        <div className="mt-3">
          <label className="block text-[12px] text-ink-2 mb-1.5">Amount to pay</label>
          <div className="flex items-center gap-2">
            <span className="text-ink-2 text-sm">GHS</span>
            <input type="number" min="1" step="0.5" className="in flex-1 tnum"
              value={payAmount} onChange={e => setPayAmount(e.target.value)} />
          </div>
          {extra > 0.001 && (
            <p className="text-[11.5px] text-ink-2 mt-1.5">
              GHS {extra.toFixed(2)} more than today — it will clear your next days in this slot.
            </p>
          )}
          {extra < -0.001 && (
            <p className="text-[11.5px] text-ink-2 mt-1.5">
              Part payment — GHS {Math.abs(extra).toFixed(2)} will still be owed for this day.
            </p>
          )}
        </div>

        <div className="mt-3 p-3 rounded-lg bg-bg border border-line text-[12.5px]">
          <div className="flex justify-between text-ink-2"><span>Contribution</span><span className="tnum">GHS {base.toFixed(2)}</span></div>
          <div className="flex justify-between text-ink-2 mt-1"><span>Service charge ({feePct}%)</span><span className="tnum">GHS {fee.toFixed(2)}</span></div>
          <div className="flex justify-between font-semibold text-ink mt-1.5 pt-1.5 border-t border-line"><span>You'll approve</span><span className="tnum">GHS {charged.toFixed(2)}</span></div>
        </div>
        <p className="text-[13px] text-ink-2 mt-3">A prompt will be sent to the number below. Approve it with your MoMo PIN.</p>

        <div className="mt-5 space-y-2">
          {defaultNumber && (
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${!useOther ? 'border-ink bg-bg' : 'border-line'}`}>
              <input type="radio" checked={!useOther} onChange={() => setUseOther(false)} className="accent-ink" />
              <span className="flex-1">
                <span className="block text-[14px] font-medium">{defaultNumber}</span>
                <span className="block text-[11.5px] text-ink-2">My number on file · {defaultNetwork}</span>
              </span>
            </label>
          )}
          <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${useOther || !defaultNumber ? 'border-ink bg-bg' : 'border-line'}`}>
            <input type="radio" checked={useOther || !defaultNumber} onChange={() => setUseOther(true)} className="accent-ink" />
            <span className="text-[14px] font-medium">Pay from a different number</span>
          </label>
        </div>

        {(useOther || !defaultNumber) && (
          <div className="mt-3 space-y-2.5 animate-fade-in">
            <input className="in" inputMode="tel" placeholder="024XXXXXXX"
              value={number} onChange={e => setNumber(e.target.value)} autoFocus />
            <select className="in" value={network} onChange={e => setNetwork(e.target.value)}>
              <option value="MTN">MTN</option>
              <option value="TELECEL">Telecel / Vodafone</option>
              <option value="AIRTELTIGO">AirtelTigo</option>
            </select>
          </div>
        )}

        <button
          onClick={() => onConfirm(chosen, useOther || !defaultNumber ? network : defaultNetwork, base)}
          disabled={!valid || base <= 0}
          className="btn-dark w-full mt-5 disabled:opacity-40">
          Send prompt
        </button>
        <button onClick={onClose} className="btn-ghost w-full mt-2">Cancel</button>
      </div>
    </div>
  )
}
