'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction, setAdminToken } from '@/lib/supabase'
import { Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react'

export default function AdminLogin() {
  const router = useRouter()
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error: err } = await callFunction<{ token: string; admin: Record<string, unknown> }>(
      'auth-admin-login',
      { method: 'POST', body: { email, password } }
    )

    setLoading(false)
    if (err) { setError(err); return }

    setAdminToken(data!.token)
    localStorage.setItem('admin_user', JSON.stringify(data!.admin))
    router.push('/admin')
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-brand-green flex items-center justify-center mx-auto mb-3 border-2 border-brand-gold">
            <span className="text-brand-gold font-extrabold text-2xl">S</span>
          </div>
          <h1 className="text-white text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in with your admin credentials</p>
        </div>

        <form onSubmit={handleLogin} className="bg-gray-800 rounded-2xl p-8 space-y-5 border border-gray-700">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-500/30 rounded-xl text-red-400 text-sm">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Email Address</label>
            <input
              className="w-full px-4 py-3 rounded-xl bg-gray-700 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-gold"
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="admin@susuplatform.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
            <div className="relative">
              <input
                className="w-full px-4 py-3 rounded-xl bg-gray-700 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-gold pr-12"
                type={showPass ? 'text' : 'password'} required value={password}
                onChange={e => setPassword(e.target.value)} placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200">
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3.5 bg-brand-gold text-brand-green font-bold rounded-xl hover:bg-brand-gold-mid transition-all active:scale-95 disabled:opacity-50">
            {loading ? <Loader2 className="animate-spin mx-auto" size={20} /> : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
