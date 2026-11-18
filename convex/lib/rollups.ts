/**
 * Rollups (PLAT-002, D-006): read models so dashboards read one row per unit
 * or occupancy instead of scanning daily records and the ledger.
 *
 * - `unitDailyStats`: one unit, one batch, one day. Facts of that day only
 *   (feed, deaths, fish flows, sample ABW), rewritten from that day's source
 *   rows in the same mutation as every write that changes them
 *   (`refreshUnitDays`). A back-dated entry rewrites one row.
 * - `batchStats`: one occupancy (batch in a unit) with its KPIs and weekly
 *   snapshots. Writes mark the pair dirty (`rollupDirty`); the rollup job
 *   (convex/rollups.ts, every few minutes) recomputes it from the ledger with
 *   convex/lib/kpi.ts, so its figures equal the raw computation.
 *
 * No formulas here: KPIs come from lib/kpi, costs from lib/costing.
 */
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import {
  addToFlows,
  daysBetween,
  emptyFlows,
  flowsOf,
  occupancyKpis,
  sgr,
  type Flows,
  type Sample,
} from './kpi'
import { buildPriceBook, feedCostFromLedger, type PriceBook } from './costing'
import { addDays, todayFor } from './dates'
import { compareLedger, eventsForPair, openBatchInUnit, samplesFor } from './productionEngine'

/** Weekly snapshots kept per occupancy (a year and a bit). */
export const MAX_SNAPSHOTS = 60
/** Days of an occupancy read by the job (bounded like the ledger). */
const MAX_DAYS = 5000
export const OPEN_LAST_DATE = '9999-12-31'

type UnitDay = { unitId: Id<'cages'>; date: string }

/**
 * Rewrite the unitDailyStats rows of each (unit, date), once per distinct
 * pair. Call after writing daily records, samples or stock events.
 */
export async function refreshUnitDays(ctx: MutationCtx, pairs: UnitDay[]) {
  const seen = new Set<string>()
  for (const p of pairs) {
    const key = `${p.unitId}|${p.date}`
    if (seen.has(key)) continue
    seen.add(key)
    await refreshUnitDay(ctx, p.unitId, p.date)
  }
}

type DayAcc = {
  batchId?: Id<'batches'>
  feedKg: number
  feedCostList: number
  feed: Array<{ feedTypeId?: Id<'feedTypes'>; kg: number; listCost: number }>
  mortalityRecorded: number
  flows: Flows
  events: number
  sampleAbwG?: number
  sampleAt?: number
  doSum: number
  doN: number
  tSum: number
  tN: number
}

const keyOf = (batchId?: Id<'batches'> | null) => (batchId ? String(batchId) : '')

/** Rebuild one unit's rows for one date from its daily records, events and samples. */
export async function refreshUnitDay(ctx: MutationCtx, unitId: Id<'cages'>, date: string) {
  const cage = await ctx.db.get(unitId)
  if (!cage?.companyId) return
  const companyId = cage.companyId

  const daily = await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage_date', (q) => q.eq('cageId', unitId).eq('date', date))
    .take(50)
  const events = await ctx.db
    .query('stockEvents')
    .withIndex('by_unitId_and_eventDate', (q) => q.eq('unitId', unitId).eq('eventDate', date))
    .take(500)
  const samples = await ctx.db
    .query('biweeklyRecords')
    .withIndex('by_cage_and_date', (q) => q.eq('cageId', unitId).eq('date', date))
    .take(50)
  const existing = await ctx.db
    .query('unitDailyStats')
    .withIndex('by_unitId_and_date', (q) => q.eq('unitId', unitId).eq('date', date))
    .take(50)

  // Untagged daily rows and samples belong to the batch in the unit that day.
  let fallback: Id<'batches'> | null | undefined
  const batchFor = async (batchId?: Id<'batches'>) => {
    if (batchId) return batchId
    if (fallback === undefined) fallback = await openBatchInUnit(ctx, unitId, date)
    return fallback ?? undefined
  }

  const groups = new Map<string, DayAcc>()
  const acc = (batchId?: Id<'batches'>) => {
    const k = keyOf(batchId)
    let g = groups.get(k)
    if (!g) {
      g = {
        batchId,
        feedKg: 0,
        feedCostList: 0,
        feed: [],
        mortalityRecorded: 0,
        flows: emptyFlows(),
        events: 0,
        doSum: 0,
        doN: 0,
        tSum: 0,
        tN: 0,
      }
      groups.set(k, g)
    }
    return g
  }

  for (const r of daily) {
    const g = acc(await batchFor(r.batchId))
    const kg = r.feedAmount || 0
    const listCost = r.feedCost || 0
    g.feedKg += kg
    g.feedCostList += listCost
    if (kg > 0 || listCost > 0) g.feed.push({ feedTypeId: r.feedTypeId, kg, listCost })
    g.mortalityRecorded += r.mortality || 0
    if (r.dissolvedOxygen != null && Number.isFinite(r.dissolvedOxygen)) {
      g.doSum += r.dissolvedOxygen
      g.doN++
    }
    if (r.temperatureC != null && Number.isFinite(r.temperatureC)) {
      g.tSum += r.temperatureC
      g.tN++
    }
  }
  for (const e of [...events].sort(compareLedger)) {
    const g = acc(e.batchId)
    addToFlows(g.flows, e)
    g.events++
  }
  for (const s of samples) {
    if (!(s.averageBodyWeight > 0)) continue
    const g = acc(await batchFor(s.batchId))
    if (g.sampleAt == null || s._creationTime > g.sampleAt) {
      g.sampleAbwG = s.averageBodyWeight
      g.sampleAt = s._creationTime
    }
  }

  const old = new Map(existing.map((r) => [keyOf(r.batchId), r]))
  const touched = new Set<Id<'batches'>>()
  const now = Date.now()
  for (const [k, g] of groups) {
    const row = {
      companyId,
      locationId: cage.locationId,
      unitId,
      batchId: g.batchId,
      date,
      feedKg: g.feedKg,
      feedCostList: g.feedCostList,
      feed: g.feed,
      mortalityRecorded: g.mortalityRecorded,
      flows: { ...g.flows },
      sampleAbwG: g.sampleAbwG,
      dissolvedOxygen: g.doN ? g.doSum / g.doN : undefined,
      temperatureC: g.tN ? g.tSum / g.tN : undefined,
      updatedAt: now,
    }
    const prev = old.get(k)
    if (prev) {
      await ctx.db.replace('unitDailyStats', prev._id, row)
      old.delete(k)
    } else {
      await ctx.db.insert('unitDailyStats', row)
    }
    if (g.batchId) touched.add(g.batchId)
  }
  for (const stale of old.values()) {
    await ctx.db.delete('unitDailyStats', stale._id)
    if (stale.batchId) touched.add(stale.batchId)
  }
  for (const batchId of touched) await markDirty(ctx, companyId, unitId, batchId)
}

/** Queue an occupancy for the rollup job (one row per pair). */
export async function markDirty(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  unitId: Id<'cages'>,
  batchId: Id<'batches'>,
) {
  const queued = await ctx.db
    .query('rollupDirty')
    .withIndex('by_unitId_and_batchId', (q) => q.eq('unitId', unitId).eq('batchId', batchId))
    .first()
  if (!queued) {
    await ctx.db.insert('rollupDirty', { companyId, unitId, batchId, markedAt: Date.now() })
  }
}

/** The company's feed purchases as a price book (lib/costing). */
export async function companyPriceBook(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
): Promise<PriceBook> {
  const rows = await ctx.db
    .query('feedPurchases')
    .withIndex('by_company', (q) => q.eq('companyId', companyId))
    .take(10_000)
  return buildPriceBook(rows)
}

const isSunday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0

/** Each Sunday from `from` up to (not including) `to`, then `to`. */
export function snapshotDates(from: string, to: string): string[] {
  const out: string[] = []
  let d = from
  while (!isSunday(d)) d = addDays(d, 1)
  for (; d < to; d = addDays(d, 7)) out.push(d)
  out.push(to)
  return out.slice(-MAX_SNAPSHOTS)
}

type Snapshot = Doc<'batchStats'>['weekly'][number]

/** Cumulative state of an occupancy at the end of `date` (lib/kpi). */
export function snapshotAt(input: {
  events: Doc<'stockEvents'>[]
  samples: Sample[]
  days: Doc<'unitDailyStats'>[]
  book: PriceBook
  date: string
}): Snapshot & { kpis: ReturnType<typeof occupancyKpis> } {
  const events = input.events.filter((e) => e.eventDate <= input.date)
  const days = input.days.filter((d) => d.date <= input.date)
  const feedKg = days.reduce((s, d) => s + d.feedKg, 0)
  const listCost = days.reduce((s, d) => s + d.feedCostList, 0)
  const ledger = feedCostFromLedger(
    days.flatMap((d) =>
      d.feed.map((f) => ({
        feedAmount: f.kg,
        feedTypeId: f.feedTypeId,
        feedCost: f.listCost,
        date: d.date,
      })),
    ),
    input.book,
  )
  const k = occupancyKpis({
    events,
    samples: input.samples,
    feedKg,
    feedCost: listCost,
    asOf: input.date,
  })
  const f = flowsOf(events)
  return {
    date: input.date,
    count: k.count,
    abwG: k.current_abw_g,
    biomassKg: k.current_biomass_kg,
    feedKg,
    feedCost: ledger.cost,
    gainKg: k.gain_kg,
    stockedCount: f.stockedCount,
    inCount: f.inCount,
    outCount: f.outCount,
    harvestedCount: f.harvestedCount,
    harvestedKg: f.harvestedKg,
    mortality: f.mortalityCount,
    efcr: k.efcr,
    sgr: k.sgr_pct_day,
    survivalPct: k.survival_pct,
    kpis: k,
  }
}

/** SGR between the last two samples on different days. */
export function recentSampleSgr(samples: Sample[]) {
  const s = samples
    .filter((x) => x.abwG > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  for (let i = s.length - 1; i > 0; i--) {
    const prev = s.slice(0, i).reverse().find((x) => x.date < s[i].date)
    if (prev) {
      return { sgr: sgr(prev.abwG, s[i].abwG, daysBetween(prev.date, s[i].date)), date: s[i].date }
    }
  }
  return { sgr: null, date: s.length ? s[s.length - 1].date : null }
}

/**
 * Recompute one occupancy's batchStats row from the ledger, its samples and
 * its unitDailyStats. Deletes the row when the pair has no events.
 */
export async function refreshBatchStats(
  ctx: MutationCtx,
  unitId: Id<'cages'>,
  batchId: Id<'batches'>,
  opts: { now?: number; books?: Map<string, PriceBook> } = {},
) {
  const existing = await ctx.db
    .query('batchStats')
    .withIndex('by_unitId_and_batchId', (q) => q.eq('unitId', unitId).eq('batchId', batchId))
    .first()
  const cage = await ctx.db.get(unitId)
  const batch = await ctx.db.get(batchId)
  const events = cage && batch ? await eventsForPair(ctx, unitId, batchId) : []
  if (!cage?.companyId || !batch || events.length === 0) {
    if (existing) await ctx.db.delete('batchStats', existing._id)
    return null
  }
  const companyId = cage.companyId
  const samples = await samplesFor(ctx, unitId, batchId)
  const days = await ctx.db
    .query('unitDailyStats')
    .withIndex('by_unitId_and_batchId_and_date', (q) =>
      q.eq('unitId', unitId).eq('batchId', batchId),
    )
    .take(MAX_DAYS)

  let book = opts.books?.get(String(companyId))
  if (!book) {
    book = await companyPriceBook(ctx, companyId)
    opts.books?.set(String(companyId), book)
  }

  const sorted = [...events].sort(compareLedger)
  const total = sorted.reduce((s, e) => s + e.qtyDelta, 0)
  const lastEvent = sorted[sorted.length - 1].eventDate
  const openedOn = sorted.find((e) => e.qtyDelta > 0)?.eventDate ?? sorted[0].eventDate
  const open = total > 0
  const today = await todayFor(ctx, { locationId: cage.locationId, companyId }, opts.now)
  const asOf = open ? (lastEvent > today ? lastEvent : today) : lastEvent

  const weekly = snapshotDates(openedOn, asOf).map((date) =>
    snapshotAt({ events: sorted, samples, days, book: book!, date }),
  )
  const current = weekly[weekly.length - 1]
  const recent = recentSampleSgr(samples.filter((s) => s.date <= asOf))
  const from28 = addDays(asOf, -27)
  const recentMortality = days
    .filter((d) => d.date >= from28 && d.date <= asOf)
    .reduce((s, d) => s + d.flows.mortalityCount, 0)

  const row = {
    companyId,
    locationId: cage.locationId,
    unitId,
    batchId,
    batchNumber: batch.batchNumber,
    speciesCode: batch.speciesCode,
    open,
    lastDate: open ? OPEN_LAST_DATE : lastEvent,
    asOf,
    kpis: current.kpis,
    feedCostLedger: current.feedCost,
    recentSgr: recent.sgr,
    recentSampleDate: recent.date,
    recentMortality,
    weekly: weekly.map(({ kpis: _k, ...s }) => s),
    updatedAt: Date.now(),
  }
  if (existing) await ctx.db.replace('batchStats', existing._id, row)
  else await ctx.db.insert('batchStats', row)
  return row
}

/** Recompute up to `limit` queued occupancies, oldest first. Returns how many remain queued. */
export async function processDirtyQueue(ctx: MutationCtx, limit: number, now?: number) {
  const queue = await ctx.db.query('rollupDirty').withIndex('by_markedAt').take(limit + 1)
  const books = new Map<string, PriceBook>()
  const batch = queue.slice(0, limit)
  for (const d of batch) {
    await ctx.db.delete('rollupDirty', d._id)
    await refreshBatchStats(ctx, d.unitId, d.batchId, { now, books })
  }
  return { processed: batch.length, more: queue.length > limit }
}
