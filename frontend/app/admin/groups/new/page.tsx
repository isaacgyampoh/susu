'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { Loader2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function NewGroupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [form, setForm]       = useState({
    name: '', description: '', contribution_amount: '',
    contribution_frequency: 'daily', cycle_days: '',
    max_members: '', registration_fee: '0', rules: '', start_date: '',
  })

  function setField(k: string, v: string) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const token = getAdminToken()
    const { data, error: err } = await callFunction('groups-create', {
      method: 'POST', body: form, token: token!,
    })
    setLoading(false)
    if (err) { setError(err); return }
    router.push('/admin/groups')
  }

  const payoutEst = form.contribution_amount && form.max_members && form.cycle_days
    ? parseFloat(form.contribution_amount) * parseInt(form.max_members) * parseInt(form.cycle_days)
    : null

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-12 animate-fade-in">
      <Link href="/admin/groups" className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Groups
      </Link>

      <h1 className="text-2xl font-extrabold text-white mb-2">Create New Group</h1>
      <p className="text-gray-400 text-sm mb-8">Define the susu group parameters. Members will be able to join once the group is open.</p>

      {error && <div className="p-3 bg-red-900/30 border border-red-500/30 rounded-xl text-red-400 text-sm mb-5">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-400 mb-1.5">Group Name *</label>
            <input className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
              required value={form.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. Gold Circle – Daily 50" />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Contribution Amount (GHS) *</label>
            <input className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
              required type="number" min="1" step="0.01" value={form.contribution_amount} onChange={e => setField('contribution_amount', e.target.value)} placeholder="50.00" />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Frequency *</label>
            <select className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
              value={form.contribution_frequency} onChange={e => setField('contribution_frequency', e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Max Members *</label>
            <input className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
              required type="number" min="2" value={form.max_members} onChange={e => setField('max_members', e.target.value)} placeholder="15" />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Cycle Days (days per payout) *</label>
            <input className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
              required type="number" min="1" value={form.cycle_days} onChange={e => setField('cycle_days', e.target.value)} placeholder="15" />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Registration Fee (GHS)</label>
            <input className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
              type="number" min="0" step="0.01" value={form.registration_fee} onChange={e => setField('registration_fee', e.target.value)} placeholder="0.00" />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Start Date (set when activating)</label>
            <input className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
              type="date" value={form.start_date} onChange={e => setField('start_date', e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-400 mb-1.5">Description</label>
            <input className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
              value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Short description for the landing page" />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-400 mb-1.5">Additional Rules</label>
            <textarea className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold"
              rows={3} value={form.rules} onChange={e => setField('rules', e.target.value)} placeholder="Any group-specific rules..." />
          </div>
        </div>

        {/* Payout estimate */}
        {payoutEst !== null && (
          <div className="p-4 bg-brand-green/20 border border-brand-green/30 rounded-xl">
            <p className="text-green-300 text-sm">
              Estimated member payout: <span className="font-bold text-brand-gold text-lg">GHS {payoutEst.toLocaleString()}</span>
              <span className="text-gray-400"> ({form.contribution_amount} × {form.max_members} members × {form.cycle_days} days)</span>
            </p>
          </div>
        )}

        <button type="submit" disabled={loading} className="w-full py-3.5 bg-brand-gold text-brand-green font-bold rounded-xl hover:bg-amber-400 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 size={18} className="animate-spin" /> : 'Create Group'}
        </button>
      </form>
    </div>
  )
}
