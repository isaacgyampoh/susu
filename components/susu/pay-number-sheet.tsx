'use client'
import { useState } from 'react'

/*
 * Before firing the prompt, let the member confirm the MoMo number — or pay
 * from a DIFFERENT one. Their registration number may not have mobile money,
 * or they may want to pay from another wallet. The chosen number/network is
 * passed to payments-initialize as pay_number / pay_network.
 */
export default function PayNumberSheet({
  defaultNumber, defaultNetwork = 'MTN', amount, onConfirm, onClose,
}: {
  defaultNumber?: string
  defaultNetwork?: string
  amount: number
  onConfirm: (payNumber: string, payNetwork: string) => void
  onClose: () => void
}) {
  const [useOther, setUseOther] = useState(false)
  const [number, setNumber]     = useState(defaultNumber ?? '')
  const [network, setNetwork]   = useState(defaultNetwork)

  const chosen = useOther ? number.trim() : (defaultNumber ?? '')
  const valid  = /^0\d{9}$/.test(chosen.replace(/\s/g, '')) || /^233\d{9}$/.test(chosen.replace(/\s/g, ''))

  return (
    <div className="fixed inset-0 z-50 bg-ink/30 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-surface w-full sm:max-w-[380px] rounded-t-2xl sm:rounded-2xl p-6 animate-fade-in" onClick={e => e.stopPropagation()}>
        <h2 className="text-[19px] font-semibold tracking-[-.02em]">Pay GHS {amount.toFixed(2)}</h2>
        <p className="text-[13px] text-ink-2 mt-1.5">A prompt will be sent to the number below. Approve it with your MoMo PIN.</p>

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
          onClick={() => onConfirm(chosen, useOther || !defaultNumber ? network : defaultNetwork)}
          disabled={!valid}
          className="btn-dark w-full mt-5 disabled:opacity-40">
          Send prompt
        </button>
        <button onClick={onClose} className="btn-ghost w-full mt-2">Cancel</button>
      </div>
    </div>
  )
}
