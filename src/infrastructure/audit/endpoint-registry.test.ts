import { describe, it, expect } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  ENDPOINTS, isSafeToProbe, whyUnsafe, type Effect,
} from '../../../supabase/functions/_shared/endpoint-registry'

const FUNCTIONS_DIR = join(process.cwd(), 'supabase', 'functions')

function deployedFunctions(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'))
    .filter(d => existsSync(join(FUNCTIONS_DIR, d.name, 'index.ts')))
    .map(d => d.name)
    .sort()
}

describe('endpoint effect registry', () => {
  /*
   * The guard that would have prevented the incident. An audit tool that walks
   * the functions directory must find a classification for everything it finds,
   * or it cannot know what is safe to call. A NEW function with no entry is the
   * exact hole `cron-daily-reminders` went through, so this fails the build
   * rather than defaulting the newcomer into either category.
   */
  it('classifies every deployed function', () => {
    const missing = deployedFunctions().filter(f => !(f in ENDPOINTS))
    expect(missing, `unclassified: ${missing.join(', ')}`).toEqual([])
  })

  it('does not classify functions that no longer exist', () => {
    const live = new Set(deployedFunctions())
    const stale = Object.keys(ENDPOINTS).filter(f => !live.has(f))
    expect(stale, `stale entries: ${stale.join(', ')}`).toEqual([])
  })

  it('treats an unknown endpoint as unsafe', () => {
    expect(isSafeToProbe('some-function-added-tomorrow')).toBe(false)
    expect(whyUnsafe('some-function-added-tomorrow')).toMatch(/not classified/)
  })

  // The specific endpoint that caused the incident, named so a future change
  // that reclassifies it has to argue with a test.
  it('never lets cron-daily-reminders be probed', () => {
    expect(isSafeToProbe('cron-daily-reminders')).toBe(false)
    expect(ENDPOINTS['cron-daily-reminders']).toContain('EXTERNAL_PAYMENT')
    expect(ENDPOINTS['cron-daily-reminders']).toContain('SMS_NOTIFICATION')
  })

  it('never lets a real payment prompt be probed', () => {
    for (const name of ['admin-payment-test', 'payments-initialize', 'payments-bulk',
                        'payments-otp', 'registration-payment']) {
      expect(isSafeToProbe(name), name).toBe(false)
      expect(ENDPOINTS[name], name).toContain('EXTERNAL_PAYMENT')
    }
  })

  it('never lets an SMS sender be probed', () => {
    for (const [name, effects] of Object.entries(ENDPOINTS)) {
      if (effects.includes('SMS_NOTIFICATION')) {
        expect(isSafeToProbe(name), `${name} sends SMS but is probeable`).toBe(false)
      }
    }
  })

  it('never lets a financial mutation be probed', () => {
    for (const [name, effects] of Object.entries(ENDPOINTS)) {
      if (effects.includes('FINANCIAL_MUTATION')) {
        expect(isSafeToProbe(name), `${name} moves money but is probeable`).toBe(false)
      }
    }
  })

  it('READ_ONLY is exclusive — it can never be combined with an effect', () => {
    for (const [name, effects] of Object.entries(ENDPOINTS)) {
      if (effects.includes('READ_ONLY')) {
        expect(effects, `${name} claims READ_ONLY alongside ${effects.join('+')}`)
          .toEqual(['READ_ONLY'])
      }
    }
  })

  it('gives every endpoint at least one effect', () => {
    for (const [name, effects] of Object.entries(ENDPOINTS)) {
      expect(effects.length, name).toBeGreaterThan(0)
    }
  })

  it('uses only known effect names', () => {
    const known: Effect[] = ['READ_ONLY', 'FINANCIAL_MUTATION', 'EXTERNAL_PAYMENT',
      'SMS_NOTIFICATION', 'STORAGE_MUTATION', 'ADMIN_MUTATION', 'SCHEDULED_MUTATION']
    for (const [name, effects] of Object.entries(ENDPOINTS)) {
      for (const e of effects) expect(known, `${name}: ${e}`).toContain(e)
    }
  })

  /*
   * A cheap source-level cross-check. If a function's source calls sendSMS or
   * notifyAdmins, it sends SMS — whatever the registry claims. This catches the
   * realistic drift, which is not somebody mislabelling an endpoint today but
   * somebody adding an SMS to a function classified before it had one.
   */
  it('agrees with the source about who sends SMS', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const wrong: string[] = []
    for (const name of deployedFunctions()) {
      const src = readFileSync(join(FUNCTIONS_DIR, name, 'index.ts'), 'utf8')
      const sends = /\bsendSMS\s*\(|\bnotifyAdmins\s*\(/.test(src)
      const declared = (ENDPOINTS[name] ?? []).includes('SMS_NOTIFICATION')
      if (sends && !declared) wrong.push(`${name} sends SMS but is not marked SMS_NOTIFICATION`)
    }
    expect(wrong, wrong.join('; ')).toEqual([])
  })
})
