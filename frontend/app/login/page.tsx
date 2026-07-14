'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, setMemberToken } from '@/lib/supabase'
import { Loader2, Eye, EyeOff, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [phone, setPhone]         = useState('')
  const [passcode, setPasscode]   = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error: err } = await callFunction<{ token: string; member: Record<string, unknown> }>(
      'auth-member-login',
      { method: 'POST', body: { phone, passcode } }
    )

    setLoading(false)

    if (err) { setError(err); return }

    setMemberToken(data!.token)
    localStorage.setItem('member_user', JSON.stringify(data!.member))
    router.push('/member/dashboard')
  }

  return (
    <div className="min-h-screen bg-brand-green bg-kente-pattern flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-brand-gold flex items-center justify-center mx-auto mb-3">
            <span className="text-brand-green font-extrabold text-2xl">S</span>
          </div>
          <h1 className="text-white text-2xl font-bold">Member Portal</h1>
          <p className="text-green-200 text-sm mt-1">Sign in with your phone and passcode</p>
        </div>

        <form onSubmit={handleLogin} className="card p-8 space-y-5 animate-slide-up">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          <div>
            <label className="label">Phone Number</label>
            <input
              className="input"
              type="tel"
              required
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="0244XXXXXX"
              autoComplete="tel"
            />
          </div>

          <div>
            <label className="label">Passcode</label>
            <div className="relative">
              <input
                className="input pr-12"
                type={showPass ? 'text' : 'password'}
                required
                value={passcode}
                onChange={e => setPasscode(e.target.value)}
                placeholder="6-digit passcode"
                maxLength={6}
                inputMode="numeric"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">Your passcode was sent to you via SMS on approval.</p>
          </div>

          <button type="submit" disabled={loading} className="btn-secondary w-full py-3.5">
            {loading ? <Loader2 className="animate-spin" size={18} /> : 'Sign In'}
          </button>

          <p className="text-center text-sm text-gray-500">
            Don't have an account?{' '}
            <Link href="/plans" className="text-brand-green font-semibold hover:underline">Join a group</Link>
          </p>
        </form>

        <p className="text-center mt-6">
          <Link href="/admin/login" className="text-green-300 text-sm hover:text-white">Admin login →</Link>
        </p>
      </div>
    </div>
  )
}
