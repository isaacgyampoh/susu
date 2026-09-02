import { describe, it, expect } from 'vitest'
import {
  refuseJoin, PUBLIC_JOINABLE, ADMIN_JOINABLE, type GroupState,
} from '../../../supabase/functions/_shared/group-join'

/**
 * These run against the exact module both edge functions import, so a rule
 * that passes here is the rule production applies. There is no mirrored copy.
 */
const g = (over: Partial<GroupState> = {}): GroupState => ({
  name: 'Gold Weekly', status: 'open', max_members: 20, current_members: 1, ...over,
})

describe('joining a group — the reason must match what actually blocked it', () => {
  it('allows an open group with slots free', () => {
    expect(refuseJoin(g(), 1, PUBLIC_JOINABLE)).toBeNull()
    expect(refuseJoin(g({ current_members: 19 }), 1, PUBLIC_JOINABLE)).toBeNull()
  })

  it('refuses a full group by saying it is full', () => {
    expect(refuseJoin(g({ current_members: 20 }), 1, PUBLIC_JOINABLE))
      .toBe('"Gold Weekly" is full.')
  })

  /*
   * The regression this file exists for. A closed group with nineteen free
   * slots used to answer "cannot take 1 slot — only 19 left": a capacity
   * refusal for a group that had plenty of capacity. The reason must be the
   * group's state, and must not mention slots at all.
   */
  it('refuses a CLOSED group by its state, never by capacity', () => {
    const msg = refuseJoin(g({ status: 'closed', current_members: 1 }), 1, PUBLIC_JOINABLE)
    expect(msg).toBe('"Gold Weekly" is closed.')
    expect(msg).not.toMatch(/slot|left|\d/)
  })

  it('refuses a STARTED group by its state', () => {
    const msg = refuseJoin(g({ status: 'active' }), 1, PUBLIC_JOINABLE)
    expect(msg).toMatch(/already started/)
    expect(msg).not.toMatch(/slot|left/)
  })

  it('refuses a COMPLETED (paid-out) group by its state', () => {
    const msg = refuseJoin(g({ status: 'completed' }), 1, PUBLIC_JOINABLE)
    expect(msg).toMatch(/finished and paid out/)
    expect(msg).not.toMatch(/slot|left/)
  })

  it('refuses an unknown state without inventing a capacity reason', () => {
    const msg = refuseJoin(g({ status: 'suspended' }), 1, PUBLIC_JOINABLE)
    expect(msg).toBe('"Gold Weekly" is not accepting applications at the moment.')
  })

  it('reports capacity only when capacity is genuinely the problem', () => {
    expect(refuseJoin(g({ current_members: 18 }), 5, PUBLIC_JOINABLE))
      .toBe('"Gold Weekly" has 2 slots left, and you asked for 5.')
    expect(refuseJoin(g({ current_members: 19 }), 2, PUBLIC_JOINABLE))
      .toBe('"Gold Weekly" has 1 slot left, and you asked for 2.')
  })

  it('never contradicts itself: a stated slot count always covers the request', () => {
    for (const used of [0, 5, 18, 19, 20]) {
      for (const want of [1, 2, 5]) {
        const msg = refuseJoin(g({ current_members: used }), want, PUBLIC_JOINABLE)
        const m = msg?.match(/has (\d+) slots? left, and you asked for (\d+)/)
        if (m) expect(Number(m[1]), msg!).toBeLessThan(Number(m[2]))
      }
    }
  })

  // The admin door may add somebody to a group that has already started; the
  // public form may not. Both refuse a finished one.
  it('lets an admin add to a running group, but not a finished one', () => {
    expect(refuseJoin(g({ status: 'active' }), 1, ADMIN_JOINABLE)).toBeNull()
    expect(refuseJoin(g({ status: 'completed' }), 1, ADMIN_JOINABLE)).toMatch(/finished/)
    expect(refuseJoin(g({ status: 'closed' }), 1, ADMIN_JOINABLE)).toMatch(/closed/)
  })

  it('treats missing capacity data as no room rather than as room', () => {
    expect(refuseJoin(g({ max_members: null, current_members: null }), 1, PUBLIC_JOINABLE))
      .toBe('"Gold Weekly" is full.')
  })
})
