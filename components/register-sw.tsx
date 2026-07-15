'use client'
import { useEffect } from 'react'

/**
 * Registers the service worker so the app can be installed to a phone's home
 * screen. Registration is deferred to after load — a member on a slow Ghanaian
 * mobile connection should get the page first, the install machinery second.
 */
export default function RegisterSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // A failed SW registration must never break the app
      })
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])

  return null
}
