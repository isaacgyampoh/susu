import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The member portal's contract with its own backend.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Two production defects motivated this file, and both were the same mistake:
 * a page reading a shape the endpoint had stopped returning.
 *
 *   PROFILE  destructured `plans` and `payouts`. `member-profile` returns
 *            `memberships`, and returned no payouts at all. `payouts.filter()`
 *            threw, and every member opening Profile saw "Application error: a
 *            client-side exception has occurred". TypeScript passed the whole
 *            time, because the page was typed as `MemberDashboard` — a type
 *            still describing the old shape. A stale type masking a broken
 *            contract is worse than no type.
 *
 *   PAYMENTS rendered memberships out of `contributions-list?page=1`: twenty
 *            rows ordered by due_date DESC. Groups do not take turns in that
 *            ordering, so whichever group had the furthest-future dates filled
 *            every slot. A member with eighteen groups saw one.
 *
 * The fixture below was captured from the REAL deployed endpoints, signed in as
 * a member holding three groups whose due dates are deliberately staggered so
 * the pagination bug reproduces. Regenerate with
 * docs/phase-11/multi-group-fixture.sql plus the capture in that phase's notes.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface Fixture {
  profile: {
    status: number; keys: string[]; membership_count: number
    has_payouts_key: boolean; member_fields: string[]; group_names: string[]
  }
  paginated_list: { rows_returned: number; total_rows: number; distinct_groups_on_page_1: number }
  previews: {
    membership: string; status: number
    groups_touched: string[]; memberships_touched: string[]; expected_membership_id: string
  }[]
  idor: Record<string, number>
}

const FX: Fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'member-portal-contract.json'), 'utf8'),
)

describe('member_profile_loads_without_exception', () => {
  it('returns every key the Profile screen reads', () => {
    expect(FX.profile.status).toBe(200)
    // The exact set the page destructures. `plans` is deliberately absent —
    // asserting its absence is what stops the old contract creeping back.
    for (const k of ['member', 'memberships', 'totals', 'payments', 'payouts', 'penalties', 'myMessages']) {
      expect(FX.profile.keys, `member-profile must return "${k}"`).toContain(k)
    }
    expect(FX.profile.keys).not.toContain('plans')
  })

  it('returns the member detail fields the Profile screen formats', () => {
    // `format(new Date(undefined))` throws RangeError. created_at missing was a
    // second, independent crash in the same render.
    for (const f of ['member_code', 'created_at']) {
      expect(FX.profile.member_fields, `member.${f} must be present`).toContain(f)
    }
  })

  it('carries a payouts array, so Collected cannot throw', () => {
    expect(FX.profile.has_payouts_key).toBe(true)
  })
})

describe('member_sees_all_memberships', () => {
  it('the portal state returns every group, not a page of them', () => {
    expect(FX.profile.membership_count).toBe(3)
    expect(FX.profile.group_names).toEqual(['P11-A', 'P11-B', 'P11-C'])
  })

  it('proves the paginated endpoint could NOT have shown them all', () => {
    // This is the bug, preserved as evidence: 20 rows out of 75, and every one
    // of them from a single group. Any future attempt to render memberships
    // from this endpoint reintroduces exactly this.
    expect(FX.paginated_list.rows_returned).toBeLessThan(FX.paginated_list.total_rows)
    expect(FX.paginated_list.distinct_groups_on_page_1).toBeLessThan(FX.profile.membership_count)
  })
})

describe('member_can_select_each_membership', () => {
  it('every membership can be previewed for payment', () => {
    expect(FX.previews).toHaveLength(3)
    for (const p of FX.previews) expect(p.status, `preview ${p.membership}`).toBe(200)
  })
})

describe('payment_context_is_membership_scoped', () => {
  it('a payment previewed against one group touches only that group', () => {
    for (const p of FX.previews) {
      expect(p.groups_touched, `${p.membership} leaked into another group`).toEqual([p.membership])
      expect(p.memberships_touched).toEqual([p.expected_membership_id])
    }
  })
})

describe('member_cannot_pay_against_other_membership', () => {
  it('previewing another member’s membership is refused', () => {
    expect(FX.idor.preview_other_membership).toBe(404)
  })
  it('initiating a payment on another member’s membership is refused', () => {
    expect(FX.idor.initialize_other_membership).toBe(404)
  })
  it('a fabricated membership id is refused', () => {
    expect(FX.idor.initialize_fabricated_membership).toBe(404)
  })
})

describe('member_cannot_access_other_member_payment', () => {
  it('every cross-member attempt was denied', () => {
    for (const [label, status] of Object.entries(FX.idor)) {
      expect(status, `${label} must be denied`).toBe(404)
    }
  })
})

/**
 * The static half: a fixture proves what production did once, this proves the
 * code cannot drift back between captures.
 */
describe('member portal — memberships never come from a paginated list', () => {
  const PORTAL = join(process.cwd(), 'app', 'm', 'portal')

  function pages(dir: string): string[] {
    const out: string[] = []
    for (const e of readdirSync(dir)) {
      const full = join(dir, e)
      if (statSync(full).isDirectory()) out.push(...pages(full))
      else if (e.endsWith('.tsx')) out.push(full)
    }
    return out
  }

  it('no portal screen derives the member’s groups from contributions-list', () => {
    const violations: string[] = []
    for (const f of pages(PORTAL)) {
      const src = readFileSync(f, 'utf8')
      if (!src.includes('contributions-list')) continue
      // Reading a page of contributions is fine. Deriving the SET of groups
      // from it is the bug: page one is not the member's group list.
      if (/susu_groups|group_id|group_name/.test(src)) {
        violations.push(f.replace(process.cwd() + '/', ''))
      }
    }
    expect(
      violations,
      'A page of contributions is not a list of groups — a member with more ' +
      `obligations than the page size will lose groups:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })

  it('no portal screen is typed against the retired MemberDashboard shape', () => {
    // Matches the type in USE — an import or a type argument — not prose
    // about it. The comment above this suite names it deliberately.
    const USES = /import\s+type\s*\{[^}]*\bMemberDashboard\b|callFunction<\s*MemberDashboard|useState<\s*MemberDashboard/
    const violations = pages(PORTAL)
      .filter(f => USES.test(readFileSync(f, 'utf8')))
      .map(f => f.replace(process.cwd() + '/', ''))
    expect(
      violations,
      'MemberDashboard describes a response member-profile no longer returns; ' +
      `it typechecks and then throws at runtime:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })
})
