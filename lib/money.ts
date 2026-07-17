/**
 * Money formatting. One place, because four copies drifted and all four rounded
 * pesewas away — a GHS 10.90 contribution displayed as "GHS 11", which is not
 * the amount anyone pays.
 *
 * Whole cedis stay clean. Anything with pesewas shows them.
 */
export function ghs(n: unknown): string {
  const v = Number(n ?? 0)
  return v % 1 === 0
    ? v.toLocaleString('en-GH', { maximumFractionDigits: 0 })
    : v.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Always two decimals — for a line a member is being asked to pay right now. */
export const ghs2 = (n: unknown) =>
  Number(n ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
