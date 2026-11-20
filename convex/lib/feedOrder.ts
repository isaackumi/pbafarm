/**
 * How much feed Ask Anowa proposes to order (spec 2026-11-20 §2): the ration
 * the feeding plan suggests for each unit, times the cover period, summed,
 * minus the stock the site already has, rounded up to whole bags. Pure, no
 * imports, so tests and the browser can share it.
 */

/** Days of feed an order should cover. */
export const ORDER_COVER_DAYS = 14
/** Bag weight when the feed type has none (same default as feedLedger.bagsFromKg). */
export const DEFAULT_BAG_KG = 20

export type FeedOrder = {
  days: number
  /** Ration need over `days`, kg. */
  needKg: number
  /** Stock on hand counted against the need, kg (never negative). */
  stockKg: number
  /** Need not covered by stock, kg. */
  shortKg: number
  bagKg: number
  /** Whole bags to order (0 when stock covers the need). */
  bags: number
  /** bags × bagKg. */
  quantityKg: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function feedOrderQuantity(args: {
  /** Suggested kg/day per unit (feeding plan). Non-finite or negative values are ignored. */
  dailyKg: number[]
  stockKg: number
  days?: number
  bagKg?: number | null
}): FeedOrder {
  const days = Number.isFinite(args.days) && (args.days as number) > 0 ? Math.round(args.days as number) : ORDER_COVER_DAYS
  const bagKg = args.bagKg && args.bagKg > 0 ? args.bagKg : DEFAULT_BAG_KG
  const perDay = args.dailyKg.filter((x) => Number.isFinite(x) && x > 0).reduce((s, x) => s + x, 0)
  const needKg = round1(perDay * days)
  const stockKg = round1(Math.max(0, Number.isFinite(args.stockKg) ? args.stockKg : 0))
  const shortKg = round1(Math.max(0, needKg - stockKg))
  // Tolerance so 1000 kg / 25 kg is 40 bags, not 41 from float noise.
  const bags = shortKg > 0 ? Math.ceil(shortKg / bagKg - 1e-9) : 0
  return { days, needKg, stockKg, shortKg, bagKg, bags, quantityKg: round1(bags * bagKg) }
}
