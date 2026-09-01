import { Money } from '../../../domain/shared/money'

/**
 * The conversion boundary. DECIMAL(10,2) arrives from PostgREST as a STRING,
 * and that string is exact — `Number("10.90") * 100` is 1089.9999999999998.
 *
 * Every value crossing from the database into the domain passes through here,
 * once. Nothing downstream ever sees a raw number for an amount.
 */
export const toMoney = (v: unknown): Money => Money.fromDatabase(v)

/** Domain → database. Always the decimal string form the column expects. */
export const fromMoney = (m: Money): string => m.toDecimalString()
