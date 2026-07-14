'use client'
import Link from 'next/link'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'

export default function PublicNav() {
  const [open, setOpen] = useState(false)

  return (
    <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-green flex items-center justify-center">
            <span className="text-brand-gold font-bold text-sm">S</span>
          </div>
          <span className="font-bold text-brand-green text-lg">SusuPlatform</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          <Link href="/plans"   className="text-gray-600 hover:text-brand-green font-medium transition-colors">Plans</Link>
          <Link href="/#how-it-works" className="text-gray-600 hover:text-brand-green font-medium transition-colors">How It Works</Link>
          <Link href="/#rules"  className="text-gray-600 hover:text-brand-green font-medium transition-colors">Rules</Link>
        </div>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Link href="/login" className="text-brand-green font-medium hover:underline">Member Login</Link>
          <Link href="/plans" className="btn-primary text-sm px-4 py-2">Join a Group</Link>
        </div>

        {/* Mobile menu toggle */}
        <button className="md:hidden p-2 text-gray-600" onClick={() => setOpen(!open)}>
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-3 animate-fade-in">
          <Link href="/plans"         onClick={() => setOpen(false)} className="block py-2 text-gray-700 font-medium">Plans</Link>
          <Link href="/#how-it-works" onClick={() => setOpen(false)} className="block py-2 text-gray-700 font-medium">How It Works</Link>
          <Link href="/#rules"        onClick={() => setOpen(false)} className="block py-2 text-gray-700 font-medium">Rules</Link>
          <Link href="/login"         onClick={() => setOpen(false)} className="block py-2 text-gray-700 font-medium">Member Login</Link>
          <Link href="/plans"         onClick={() => setOpen(false)} className="btn-primary w-full text-center text-sm">Join a Group</Link>
        </div>
      )}
    </nav>
  )
}
