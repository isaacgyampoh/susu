import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * The dependency rule, enforced mechanically.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A documented architecture that nothing checks is a diagram, not a boundary.
 * This test is what makes the boundary real: it reads the source and fails the
 * build if a layer imports something it must not.
 *
 *   Presentation  →  Application  →  Domain
 *   Infrastructure →  Application (ports) + Domain
 *
 * The domain is the part that matters most. It decides where members' money
 * goes, so it must be runnable in a test with no database, no HTTP and no
 * payment provider — which is only true if it imports none of them.
 * ────────────────────────────────────────────────────────────────────────────
 */

const SRC = join(process.cwd(), 'src')

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue }
    if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** Every module specifier a file imports (static, type-only, and dynamic). */
function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const specs: string[] = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) specs.push(m[1]!)
  }
  return specs
}

/** Things the domain must never reach for, whatever the import path looks like. */
const FORBIDDEN_IN_DOMAIN: { pattern: RegExp; why: string }[] = [
  { pattern: /^next(\/|$)/,                    why: 'Next.js' },
  { pattern: /^react(-dom)?(\/|$)/,            why: 'React' },
  { pattern: /^@supabase\//,                   why: 'Supabase client' },
  { pattern: /supabase/i,                      why: 'Supabase' },
  { pattern: /nalo/i,                          why: 'NaloPay' },
  { pattern: /paystack/i,                      why: 'Paystack' },
  { pattern: /^node:/,                         why: 'Node built-ins' },
  { pattern: /^(fs|path|http|https|crypto|os|child_process)$/, why: 'Node built-ins' },
  { pattern: /africas-talking|twilio/i,        why: 'an SMS provider' },
  { pattern: /^@\/(app|components|lib)\//,     why: 'the presentation or legacy layer' },
  { pattern: /^\.\.\/\.\.\/(application|infrastructure)\//, why: 'an outer layer' },
]

describe('architecture — the domain is framework-independent', () => {
  const domainFiles = sourceFiles(join(SRC, 'domain'))

  it('has domain modules to check', () => {
    expect(domainFiles.length).toBeGreaterThan(0)
  })

  it('imports nothing from a framework, a database, or a payment provider', () => {
    const violations: string[] = []

    for (const file of domainFiles) {
      // A test may read a fixture from disk — the conformance suite loads the
      // allocations captured from the real database that way. That is not the
      // coupling this rule exists to prevent: the DOMAIN MODULES must run with
      // no I/O, and they still do. Every other rule below (frameworks,
      // Supabase, payment providers, outer layers) still applies to tests,
      // because a test importing those would mean the domain really had
      // acquired the dependency.
      const isTest = /\.test\.ts$/.test(file)
      for (const spec of importsOf(file)) {
        // A relative import inside the domain is always fine.
        if (spec.startsWith('.') && !spec.includes('application') && !spec.includes('infrastructure')) continue
        for (const { pattern, why } of FORBIDDEN_IN_DOMAIN) {
          if (isTest && why === 'Node built-ins') continue
          if (pattern.test(spec)) {
            violations.push(`${relative(process.cwd(), file)} imports "${spec}" (${why})`)
            break
          }
        }
      }
    }

    expect(violations, `Domain purity violated:\n  ${violations.join('\n  ')}`).toEqual([])
  })

  it('never reaches for the clock or the environment', () => {
    // A domain that reads Date.now() cannot be tested deterministically, which
    // is why every function here takes `asOf` as an argument instead.
    const violations: string[] = []
    for (const file of domainFiles) {
      if (/\.test\.ts$|fixtures\.ts$/.test(file)) continue
      const src = readFileSync(file, 'utf8')
      for (const [re, what] of [
        [/\bDate\.now\s*\(/, 'Date.now()'],
        [/\bnew\s+Date\s*\(\s*\)/, 'new Date()'],
        [/\bprocess\.env\b/, 'process.env'],
        [/\bwindow\b/, 'window'],
        [/\blocalStorage\b/, 'localStorage'],
        [/\bfetch\s*\(/, 'fetch()'],
      ] as const) {
        if (re.test(src)) violations.push(`${relative(process.cwd(), file)} uses ${what}`)
      }
    }
    expect(violations, `Domain purity violated:\n  ${violations.join('\n  ')}`).toEqual([])
  })
})

describe('architecture — the application layer depends inward only', () => {
  const appFiles = sourceFiles(join(SRC, 'application'))

  it('does not import infrastructure', () => {
    const violations: string[] = []
    for (const file of appFiles) {
      for (const spec of importsOf(file)) {
        if (/infrastructure/.test(spec)) {
          violations.push(`${relative(process.cwd(), file)} imports "${spec}"`)
        }
      }
    }
    expect(
      violations,
      'The application layer must depend on its own port interfaces, never on a ' +
      `concrete adapter:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })

  it('does not import a payment provider SDK directly', () => {
    const violations: string[] = []
    for (const file of appFiles) {
      for (const spec of importsOf(file)) {
        if (/nalo|paystack|@supabase\//i.test(spec)) {
          violations.push(`${relative(process.cwd(), file)} imports "${spec}"`)
        }
      }
    }
    expect(violations, `Provider details leaked into the application layer:\n  ${violations.join('\n  ')}`).toEqual([])
  })
})

describe('architecture — no runtime schema guessing anywhere', () => {
  it('does not reintroduce the "query, catch missing column, retry" pattern', () => {
    // The pattern: issue a write, regex the ERROR MESSAGE for a column name,
    // delete that field, and try again. It made the deployed behaviour of the
    // platform environment-dependent — the same code saved different rows
    // depending on which migrations had run.
    //
    // Phase 07 removed the last five (kyc-submit ×2, admin-onboard-member ×2,
    // cron-payout-reminders, groups-create), so the check now covers the edge
    // functions too rather than only src/. Every column they guessed about had
    // in fact existed for months: the fallbacks could no longer fire for the
    // reason they were written, only on some unrelated failure that happened
    // to mention the same word — and then silently save incomplete data.
    //
    // Schema is a deployment guarantee. It is not something to discover from
    // an error string at runtime.
    const violations: string[] = []
    const roots = [SRC, join(process.cwd(), 'supabase', 'functions')]
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const src = readFileSync(file, 'utf8')
        if (/\/(does not exist|column .* does not exist)\/|\.test\(\s*\w*[Ee]rr(or)?\.message\s*\)/.test(src)) {
          violations.push(relative(process.cwd(), file))
        }
      }
    }
    expect(violations, `Schema-guessing fallback found in:\n  ${violations.join('\n  ')}`).toEqual([])
  })
})

describe('architecture — one settlement engine', () => {
  // Five settlement implementations existed before the rebuild. The rule that
  // keeps it at one: an edge function may CALL the engine, but must not write
  // a contribution to `paid` itself. Onboarding is the single exception — it
  // INSERTS historical rows an operator has stated, and settles nothing.
  const FUNCTIONS = join(process.cwd(), 'supabase', 'functions')
  const ALLOWED = new Set(['admin-onboard-member'])

  it('no edge function marks a contribution paid outside the engine', () => {
    const violations: string[] = []
    for (const file of sourceFiles(FUNCTIONS)) {
      const name = relative(FUNCTIONS, file).split('/')[0]!
      if (ALLOWED.has(name)) continue
      const src = readFileSync(file, 'utf8')
      // `.from('contributions')` followed by an update that sets status paid.
      const re = /from\(\s*['"]contributions['"]\s*\)[\s\S]{0,400}?\.update\(\s*\{[^}]*status:\s*['"]paid['"]/g
      if (re.test(src)) violations.push(relative(process.cwd(), file))
    }
    expect(
      violations,
      'Settlement must go through settle_payment(). Direct writes found in:\n  ' +
      violations.join('\n  '),
    ).toEqual([])
  })

  it('a registration fee never reaches the contribution allocator', () => {
    // A registration fee has no obligation to settle against. Routing one
    // through settle_payment() raises — it did, for all 36 in production,
    // until Phase 06 caught it. Every caller must branch on the type first.
    const violations: string[] = []
    for (const file of sourceFiles(FUNCTIONS)) {
      const src = readFileSync(file, 'utf8')
      if (!/settlePayment\s*\(/.test(src)) continue
      if (!/registration_fee/.test(src)) continue
      // If a file both settles payments and knows about registration fees, it
      // must route them to the registration path.
      if (!/settleRegistrationFee/.test(src)) violations.push(relative(process.cwd(), file))
    }
    expect(
      violations,
      'These settle payments and handle registration fees without branching to ' +
      `the registration path:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })
})

describe('authorization — a member endpoint reads only the caller\'s money', () => {
  /*
   * The IDOR rule, enforced mechanically.
   *
   * Every function that authenticates a MEMBER must bind its reads of a
   * financial table to that member. This is a lint, not a proof — it looks for
   * the caller's identity near the query — but it catches the shape of the
   * mistake that matters: a query keyed by an id taken from the request body
   * with no ownership test.
   *
   * The one legitimate exception is a follow-up write on a row already fetched
   * under the caller's id (`.eq('id', tx.id)` after `tx` was ownership-checked),
   * which the pattern below admits deliberately.
   */
  const FUNCTIONS = join(process.cwd(), 'supabase', 'functions')
  const FINANCIAL = /from\('(contributions|group_memberships|transactions|payouts|payment_allocations|membership_credit_ledger|members)'\)/g
  const SCOPED = new RegExp([
    'session\\.sub', 'member\\.sub', 'admin\\.sub', 'memberId\\b', 'p_member_id',
    "member_id',\\s*(session|member)\\b",
    "\\.eq\\('id',\\s*\\w+\\.id\\)",
    "\\.eq\\('reference',\\s*\\w*\\.?reference\\)",
    "\\.eq\\('id',\\s*(tx|c|contribution|regTx|existing)\\b",
  ].join('|'))

  // Dual-auth: its admin branch may legitimately read any member.
  const DUAL_AUTH = new Set(['contributions-list'])

  it('binds every financial read to the authenticated member', () => {
    const violations: string[] = []
    for (const file of sourceFiles(FUNCTIONS)) {
      const name = relative(FUNCTIONS, file).split('/')[0]!
      const src = readFileSync(file, 'utf8')
      if (!src.includes('requireMember')) continue
      const adminBranch = src.indexOf('requireAdmin(req)')

      for (const m of src.matchAll(FINANCIAL)) {
        if (DUAL_AUTH.has(name) && adminBranch !== -1 && m.index! > adminBranch) continue
        const window = src.slice(Math.max(0, m.index! - 400), m.index! + 700)
        if (!SCOPED.test(window)) {
          const line = src.slice(0, m.index!).split('\n').length
          violations.push(`${name}:${line} reads ${m[1]} with no caller scoping`)
        }
      }
    }
    expect(
      violations,
      'A member endpoint must never read a financial table without binding it ' +
      `to the caller:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })

  it('no member endpoint trusts a member id from the request', () => {
    // `body.member_id` in a member-authenticated function is the classic IDOR:
    // the caller names whose money to operate on.
    const violations: string[] = []
    for (const file of sourceFiles(FUNCTIONS)) {
      const src = readFileSync(file, 'utf8')
      if (!src.includes('requireMember')) continue
      if (/\bbody\.member_id\b|\bconst\s*\{[^}]*\bmember_id\b[^}]*\}\s*=\s*(await\s*)?req\.json/.test(src)) {
        violations.push(relative(process.cwd(), file))
      }
    }
    expect(violations, `member_id taken from the request body in:\n  ${violations.join('\n  ')}`).toEqual([])
  })
})
