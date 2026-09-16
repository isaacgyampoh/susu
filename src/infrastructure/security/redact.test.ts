import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { redactSecrets, containsSecret } from '../../../supabase/functions/_shared/redact'
import { smsTemplates } from './sms-templates.fixture'

/**
 * A MEMBER'S PASSCODE MUST NOT OUTLIVE THE MESSAGE IT WAS SENT IN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This is the test for a defect that was live: 27 members' passcodes sat in
 * `sms_log` in plaintext, the most recent sent the same day it was found, while
 * the same passcodes were carefully hashed in `members`.
 *
 * The guarantee is worth exactly as much as what checks it, hence this. The
 * templates are duplicated as a fixture because the real module reads
 * `Deno.env` at import time and cannot be loaded here — so the fixture is
 * pinned to the real one by a test below.
 */
describe('credential redaction before logging', () => {
  const portal = 'https://my.abbiewealthsusu.com'

  it('removes the passcode from the welcome message', () => {
    const msg = smsTemplates.welcome('Adwoa Serwaa', 'AW-0241', '4821', portal)
    expect(msg).toContain('4821')                       // the SMS itself carries it
    expect(redactSecrets(msg)).not.toContain('4821')    // the log must not
    expect(containsSecret(redactSecrets(msg))).toBe(false)
  })

  it('removes the passcode from the approval message', () => {
    const msg = smsTemplates.applicationApproved('Kofi Mensah', 'AW-0312', '9007', portal)
    expect(redactSecrets(msg)).not.toContain('9007')
    expect(containsSecret(redactSecrets(msg))).toBe(false)
  })

  it('keeps everything the operator actually needs', () => {
    const out = redactSecrets(smsTemplates.welcome('Adwoa Serwaa', 'AW-0241', '4821', portal))
    expect(out).toContain('Adwoa Serwaa')   // who it went to
    expect(out).toContain('AW-0241')        // member id is not a secret
    expect(out).toContain(portal)           // and the link still reads correctly
    expect(out).toContain('Passcode: [redacted]')
  })

  it('does not mangle the advice that follows it', () => {
    // "Keep your passcode private." has no colon and must survive intact —
    // a greedier pattern would eat the rest of the sentence.
    const out = redactSecrets(smsTemplates.welcome('Ama', 'AW-1', '1234', portal))
    expect(out).toContain('Keep your passcode private.')
  })

  it('leaves a message with no credential completely unchanged', () => {
    const msg = smsTemplates.paymentConfirmed('Yaw', '84.00', 'AWS-90A11')
    expect(redactSecrets(msg)).toBe(msg)
    expect(containsSecret(msg)).toBe(false)
  })

  it('catches the other shapes a credential arrives in', () => {
    for (const msg of [
      'Your PIN: 1024 for the admin console',
      'your passcode is 7781',
      'Passcode:5512',
    ]) {
      expect(containsSecret(msg)).toBe(true)
      expect(containsSecret(redactSecrets(msg))).toBe(false)
    }
  })

  it('is idempotent, so re-processing a stored row cannot re-expose it', () => {
    const once  = redactSecrets(smsTemplates.welcome('Ama', 'AW-1', '1234', portal))
    expect(redactSecrets(once)).toBe(once)
  })

  it('templates stay in step with the real module', () => {
    /*
     * The fixture above mirrors templates that live in a Deno module this
     * runner cannot import. A mirror that drifts is worse than no mirror: the
     * redaction would keep passing against wording nothing sends any more. So
     * the real file is read as text and the shape that matters — a labelled
     * passcode — is asserted to still be there.
     */
    const src = readFileSync(
      join(process.cwd(), 'supabase', 'functions', '_shared', 'africas-talking.ts'), 'utf8')

    for (const name of ['welcome', 'applicationApproved']) {
      const line = src.split('\n').find(l => l.includes(`${name}: (`))
      expect(line, `${name} template missing from africas-talking.ts`).toBeTruthy()
    }
    // Both credential templates must still emit "Passcode: ${passcode}" —
    // the exact shape redactSecrets matches on.
    const passcodeLines = src.split('\n').filter(l => l.includes('Passcode: ${passcode}'))
    expect(passcodeLines).toHaveLength(2)

    // And the module must route its logging through the redactor.
    expect(src).toContain("import { redactSecrets } from './redact.ts'")
    expect(src).toContain('redactSecrets(message)')
  })

  it('does not report already-redacted text as leaking', () => {
    // The check that got this wrong first time round: `[redacted]` is itself
    // non-whitespace, so a naive pattern matched it and reported 27 live leaks
    // that had already been fixed.
    expect(containsSecret('Passcode: [redacted] | Sign in: ' + portal)).toBe(false)
  })
})
