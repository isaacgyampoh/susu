'use client'
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Modal, ModalActions } from './modal'
import { Button } from './button'
import { Field, Input, Textarea } from './field'
import { cx } from './util'

/* ---------------------------------------------------------------------------
   Promise-based confirm / prompt, replacing the native ones.

       const ask = useConfirm()
       if (!await ask({ title: 'Reverse this payment?', tone: 'danger' })) return

   Why this matters more here than in most apps: the destructive paths in this
   console reverse settled payments, rebuild schedules, and delete every member.
   A native confirm() shows one line of unstyled text with no room to say what
   will actually happen, no way to require typing the group's name, and no way
   to render the list of affected rows. Several of those dialogs were carrying
   four paragraphs of consequences inside a string with \n in it.
   ------------------------------------------------------------------------ */

export type ConfirmOptions = {
  title: string
  description?: React.ReactNode
  /** Rendered above the actions — a list of what will change, a preview, a total. */
  detail?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  /** Ask for a value as well as agreement. Resolves to the string, or null. */
  input?: {
    label?: string
    placeholder?: string
    hint?: React.ReactNode
    multiline?: boolean
    required?: boolean
    defaultValue?: string
  }
  /** Requires this exact phrase before the action unlocks. For the truly final ones. */
  confirmWord?: string
}

type Resolver = (v: string | boolean | null) => void

const Ctx = createContext<((o: ConfirmOptions) => Promise<any>) | null>(null)

/**
 * Returns a function that resolves to `true`/`false`, or — when `input` is
 * given — the typed string, or `null` if cancelled.
 */
export function useConfirm() {
  const fn = useContext(Ctx)
  if (!fn) throw new Error('useConfirm must be used inside <Providers>')
  return fn as {
    (o: ConfirmOptions & { input: NonNullable<ConfirmOptions['input']> }): Promise<string | null>
    (o: ConfirmOptions): Promise<boolean>
  }
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const [value, setValue] = useState('')
  const [word, setWord] = useState('')
  const resolver = useRef<Resolver | null>(null)

  const ask = useCallback((o: ConfirmOptions) => {
    setOpts(o)
    setValue(o.input?.defaultValue ?? '')
    setWord('')
    return new Promise<any>(resolve => { resolver.current = resolve })
  }, [])

  const settle = useCallback((accepted: boolean) => {
    const o = opts
    const r = resolver.current
    resolver.current = null
    setOpts(null)
    if (!r) return
    if (!accepted) return r(o?.input ? null : false)
    r(o?.input ? value : true)
  }, [opts, value])

  const wordOk = !opts?.confirmWord || word.trim() === opts.confirmWord
  const inputOk = !opts?.input?.required || value.trim().length > 0
  const canConfirm = wordOk && inputOk

  return (
    <Ctx.Provider value={ask}>
      {children}
      <Modal
        open={!!opts}
        onClose={() => settle(false)}
        title={opts?.title}
        description={opts?.description}
        tone={opts?.tone}
        size={opts?.detail || opts?.input?.multiline ? 'lg' : 'md'}
        footer={
          <ModalActions>
            <Button variant="outline" onClick={() => settle(false)} full className="sm:w-auto">
              {opts?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              variant={opts?.tone === 'danger' ? 'danger' : 'primary'}
              onClick={() => settle(true)}
              disabled={!canConfirm}
              full className="sm:w-auto"
              data-autofocus={opts?.input || opts?.confirmWord ? undefined : true}
            >
              {opts?.confirmLabel ?? 'Confirm'}
            </Button>
          </ModalActions>
        }
      >
        {opts && (
          <div className="space-y-4">
            {opts.detail && (
              <div className={cx(
                'rounded-md border p-3.5 text-sm leading-relaxed max-h-[38vh] overflow-y-auto',
                opts.tone === 'danger'
                  ? 'bg-danger-soft border-danger-line text-ink'
                  : 'bg-surface-2 border-line text-ink-2',
              )}>
                {opts.detail}
              </div>
            )}

            {opts.input && (
              <Field label={opts.input.label} hint={opts.input.hint}>
                {({ id, describedBy }) =>
                  opts.input!.multiline ? (
                    <Textarea
                      id={id} aria-describedby={describedBy} data-autofocus rows={6}
                      placeholder={opts.input!.placeholder}
                      value={value} onChange={e => setValue(e.target.value)}
                    />
                  ) : (
                    <Input
                      id={id} aria-describedby={describedBy} data-autofocus
                      placeholder={opts.input!.placeholder}
                      value={value} onChange={e => setValue(e.target.value)}
                    />
                  )
                }
              </Field>
            )}

            {opts.confirmWord && (
              <Field
                label={<>Type <span className="font-mono font-semibold text-ink">{opts.confirmWord}</span> to confirm</>}
              >
                {({ id }) => (
                  <Input
                    id={id} mono data-autofocus autoComplete="off"
                    placeholder={opts.confirmWord}
                    value={word} onChange={e => setWord(e.target.value)}
                    invalid={word.length > 0 && !wordOk}
                  />
                )}
              </Field>
            )}
          </div>
        )}
      </Modal>
    </Ctx.Provider>
  )
}
