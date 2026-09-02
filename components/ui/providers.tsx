'use client'
import { ToastProvider } from './toast'
import { ConfirmProvider } from './confirm'

/**
 * Mounted once in the root layout. Confirm sits inside Toast so that a
 * confirmed action can raise a toast about its own result while its dialog is
 * still unmounting.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  )
}
