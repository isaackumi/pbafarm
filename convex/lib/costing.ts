import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { scopedRows } from './scope'

/**
 * Production costing (INV-006 weighted average, INV-007, INV-008).
 *
 * One place for cost per kg so it can move onto the Phase 4 KPI library
 * (convex/lib/kpi.ts) without touching the reports that call it.
 *
 * Feed cost is what the feed cost when it was bought: the weighted average
 * price of the feed type's purchases up to the feeding date (doc 09 §2.5).
 * Daily records store `feedCost` at the feed type's list price, which can be
 * far from what was paid; it is used only when a feed type has no purchases.
 */

type Ctx = QueryCtx | MutationCtx

export const EXPENSE_CATEGORIES = [
  { key: 'fingerlings', label: 'Fingerlings' },
  { key: 'feed', label: 'Feed (not in purchases)' },
  { key: 'labour', label: 'Labour' },
  { key: 'treatment', label: 'Treatment' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'utilities', label: 'Utilities' },
  { key: 'transport', label: 'Transport' },
  { key: 'other', label: 'Other' },
] as const

export const BUILT_IN_CATEGORY_KEYS = new Set<string>(EXPENSE_CATEGORIES.map((c) => c.key))

/** Category key for a custom label: lower case, words joined by `_`. */
export function categoryKey(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

type PricePoint = { date: string; cumKg: number; cumCost: number }
export type PriceBook = Map<string, PricePoint[]>

/** Running totals of each feed type's purchases, oldest first. */
export function buildPriceBook(
  purchases: Pick<Doc<'feedPurchases'>, 'feedTypeId' | 'quantity' | 'pricePerKg' | 'purchaseDate' | 'deletedAt'>[],
): PriceBook {
  const byType = new Map<string, { date: string; kg: number; price: number }[]>()
  for (const p of purchases) {
    if (p.deletedAt || !(p.quantity > 0) || !(p.pricePerKg >= 0)) continue
    const key = String(p.feedTypeId)
    const list = byType.get(key) ?? []
    list.push({ date: p.purchaseDate, kg: p.quantity, price: p.pricePerKg })
    byType.set(key, list)
  }
  const book: PriceBook = new Map()
  for (const [key, list] of byType) {
    list.sort((a, b) => a.date.localeCompare(b.date))
    let cumKg = 0
    let cumCost = 0
    book.set(
      key,
      list.map((p) => {
        cumKg += p.kg
        cumCost += p.kg * p.price
        return { date: p.date, cumKg, cumCost }
      }),
    )
  }
  return book
}

/**
 * Weighted average purchase price of a feed type as of `date`: every
 * purchase on or before that day. Feed used before the first recorded
 * purchase is priced at the first purchases' average. Null when the feed
 * type has no purchases.
 */
export function ledgerPricePerKg(
  book: PriceBook,
  feedTypeId: Id<'feedTypes'> | string,
  date: string,
): number | null {
  const points = book.get(String(feedTypeId))
  if (!points || points.length === 0) return null
  let lo = 0
  let hi = points.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].date <= date) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  // Nothing bought yet on that date: use the earliest day's purchases.
  if (found < 0) {
    const first = points[0].date
    found = 0
    while (found + 1 < points.length && points[found + 1].date === first) found++
  }
  const p = points[found]
  return p.cumKg > 0 ? p.cumCost / p.cumKg : null
}

export type FeedCost = {
  /** Feed cost at purchase prices (list price only where nothing was bought). */
  cost: number
  /** The same feed at list price, as stored on the daily records. */
  listCost: number
  kg: number
  /** Kg with no purchase price to go on, costed at list price. */
  listPricedKg: number
}

/** Feed cost of daily records at purchase prices. */
export function feedCostFromLedger(
  records: Pick<Doc<'dailyRecords'>, 'feedAmount' | 'feedTypeId' | 'feedCost' | 'date'>[],
  book: PriceBook,
): FeedCost {
  let cost = 0
  let listCost = 0
  let kg = 0
  let listPricedKg = 0
  for (const r of records) {
    const amount = r.feedAmount || 0
    const stored = r.feedCost || 0
    kg += amount
    listCost += stored
    if (!(amount > 0)) continue
    const price = r.feedTypeId ? ledgerPricePerKg(book, r.feedTypeId, r.date) : null
    if (price == null) {
      cost += stored
      listPricedKg += amount
    } else {
      cost += amount * price
    }
  }
  return { cost, listCost, kg, listPricedKg }
}

export type ExpenseSplit = {
  fingerlings: number
  other: number
  total: number
  byCategory: Record<string, number>
}

/** Expenses split into fingerling cost and everything else. */
export function splitExpenses(
  expenses: Pick<Doc<'expenses'>, 'category' | 'amount' | 'deletedAt'>[],
): ExpenseSplit {
  const byCategory: Record<string, number> = {}
  let fingerlings = 0
  let other = 0
  for (const e of expenses) {
    if (e.deletedAt) continue
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount
    if (e.category === 'fingerlings') fingerlings += e.amount
    else other += e.amount
  }
  return { fingerlings, other, total: fingerlings + other, byCategory }
}

export type CostSummary = {
  total_cost: number
  /** Total cost over harvested kg (sold kg when nothing was harvested). */
  cost_per_kg: number | null
  cost_basis_kg: number
  net_margin: number
  net_margin_pct: number | null
}

export function summarizeCost(args: {
  feedCost: number
  fingerlingCost: number
  otherExpenses: number
  revenue: number
  harvestKg: number
  soldKg: number
}): CostSummary {
  const total = args.feedCost + args.fingerlingCost + args.otherExpenses
  const basis = args.harvestKg > 0 ? args.harvestKg : args.soldKg
  const net = args.revenue - total
  return {
    total_cost: total,
    cost_per_kg: basis > 0 ? total / basis : null,
    cost_basis_kg: basis,
    net_margin: net,
    net_margin_pct: args.revenue > 0 ? (net / args.revenue) * 100 : null,
  }
}

/** The caller's company feed purchases as a price book. */
export async function loadPriceBook(ctx: Ctx, user: Doc<'users'>): Promise<PriceBook> {
  return buildPriceBook(await scopedRows(ctx, user, 'feedPurchases'))
}

const inRange = (date: string, from?: string | null, to?: string | null) =>
  (!from || date >= from) && (!to || date <= to)

/** A cage's live expenses dated in [from, to]. */
export async function cageExpenses(
  ctx: Ctx,
  cage: Doc<'cages'>,
  from?: string | null,
  to?: string | null,
): Promise<Doc<'expenses'>[]> {
  if (!cage.companyId) return []
  const rows = await ctx.db
    .query('expenses')
    .withIndex('by_company_and_cage', (q) =>
      q.eq('companyId', cage.companyId!).eq('cageId', cage._id),
    )
    .collect()
  return rows.filter((e) => !e.deletedAt && inRange(e.date, from, to))
}
