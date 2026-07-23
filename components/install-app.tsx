'use client'
import { useEffect, useState } from 'react'

type Mode = 'hidden' | 'android' | 'ios' | 'inapp'

/**
 * Getting the app onto a member's phone.
 *
 * The hard part is not the manifest — it's that members arrive from a WhatsApp
 * link, which opens in WhatsApp's in-app browser. You cannot install a PWA from
 * there: Chrome's install prompt never fires, and iOS has no Share → Add to
 * Home Screen. So the first job is detecting that and telling them to reopen in
 * a real browser. Everything else is downstream of that.
 *
 * Android: Chrome fires beforeinstallprompt; we hold it and install on tap.
 * iOS:     Safari offers nothing programmatic. Instructions are the only route.
 */
export default function InstallApp({ compact = false }: { compact?: boolean }) {
  const [mode, setMode]     = useState<Mode>('hidden')
  const [prompt, setPrompt] = useState<any>(null)
  const [busy, setBusy]     = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent

    // Already installed — nothing to offer
    const installed =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true
    if (installed) return

    // Dismissing only hides it for this visit — it returns until installed,
    // so members who skip it once still get the app eventually.
    if (sessionStorage.getItem('install_dismissed') === '1') return

    const isIOS = /iPad|iPhone|iPod/.test(ua)

    // In-app browsers. Android webviews carry "; wv)". iOS webviews are Safari
    // minus the "Safari/" token — that absence is the reliable tell.
    const inApp =
      /FBAN|FBAV|Instagram|Line\/|Twitter|WhatsApp/.test(ua) ||
      /\bwv\b/.test(ua) ||
      (isIOS && !/Safari\//.test(ua))

    if (inApp) { setMode('inapp'); return }
    if (isIOS) { setMode('ios');   return }

    // Android/desktop Chrome — wait for the browser to say it's installable
    function onPrompt(e: Event) {
      e.preventDefault()
      setPrompt(e)
      setMode('android')
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', () => setMode('hidden'))
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  async function install() {
    if (!prompt) return
    setBusy(true)
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    setBusy(false)
    if (outcome === 'accepted') setMode('hidden')
  }

  function dismiss() {
    sessionStorage.setItem('install_dismissed', '1')
    setMode('hidden')
  }

  if (mode === 'hidden') return null

  const body = {
    inapp: {
      title: 'Open in your browser to install',
      text: "You opened this from WhatsApp, which can't install apps. Tap the three dots at the top and choose “Open in browser”, then install from there.",
      action: null as null | string,
    },
    ios: {
      title: 'Add to your home screen',
      text: 'Tap the Share button at the bottom of Safari, scroll down, and choose “Add to Home Screen”.',
      action: null,
    },
    android: {
      title: 'Install the app',
      text: 'Add Abbie Wealth to your home screen so you can pay in one tap.',
      action: 'Install',
    },
  }[mode]

  return (
    <div className={`card p-4 ${compact ? '' : 'mb-4'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold">{body.title}</p>
          <p className="text-[12.5px] text-ink-2 mt-1 leading-relaxed">{body.text}</p>
        </div>
        <button onClick={dismiss} aria-label="Dismiss"
          className="text-[12px] font-medium text-ink-3 hover:text-ink transition-colors shrink-0">
          Not now
        </button>
      </div>

      {body.action && (
        <button onClick={install} disabled={busy} className="btn-dark btn-sm mt-3">
          {busy ? 'Installing…' : body.action}
        </button>
      )}
    </div>
  )
}
