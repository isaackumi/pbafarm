/**
 * Ask Anowa's farm read tools (forecast, sampling, water, money, stock
 * movements, approvals, hatchery, traceability, cycle plans, alerts).
 *
 * Shared by the web assistant (`read`, the signed-in member) and the chat bot
 * (`botRead`, a channel binding). Company, sites and permissions always come
 * from the member scope, never from the model: what the model types (a unit
 * name, a batch or lot code, a period) is only matched against what the
 * member can see. Every read is bounded (indexes + take) and returns compact
 * JSON the model cites.
 */
import { v, type Infer } from 'convex/values'
import { internalQuery } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { can, requireMember, type Permission } from '../lib/permissions'
import { addDays, isBusinessDate } from '../lib/dates'
import { daysBetween, round } from '../lib/kpi'
import { unitTypeOf } from '../lib/farmRules'
import { effectiveThresholds } from '../lib/waterQuality'
import { overridesFor } from '../waterQuality'
import { amountPaidOf } from '../invoices'
import { plannerRows, unitForecast } from '../forecasts'
import { checkBinding, farmDate, inScope, matchUnit, unitsInScope, type MemberScope } from '../bot/scope'
import { webMember } from './scope'
import { abwChart, answerChartValidator, feedChart, forecastChart, moneyChart, waterChart, type AnswerChart } from '../lib/answerCharts'

export const farmReadTool = v.union(
  v.literal('forecast_unit'),
  v.literal('harvest_planner'),
  v.literal('sampling_history'),
  v.literal('water_quality'),
  v.literal('sales_summary'),
  v.literal('stocking_transfers'),
  v.literal('pending_approvals'),
  v.literal('hatchery_summary'),
  v.literal('lot_lookup'),
  v.literal('cycle_plans'),
  v.literal('sensor_alerts'),
)

export const farmReadArgs = v.object({
  unit: v.optional(v.string()),
  batch: v.optional(v.string()),
  targetG: v.optional(v.number()),
  weeks: v.optional(v.number()),
  days: v.optional(v.number()),
  from: v.optional(v.string()),
  to: v.optional(v.string()),
  code: v.optional(v.string()),
})

export type FarmReadTool = Infer<typeof farmReadTool>
export type FarmReadArgs = Infer<typeof farmReadArgs>
type ReadOut = { ok: true; data: string; charts?: AnswerChart[] } | { ok: false; error: string }

/**
 * `charts`: trends the server drew from the same records (lib/answerCharts),
 * kept out of `data` so the model never sees or writes the points; the web
 * agent offers them by id (attachChart). The bot ignores them.
 */
const readResult = v.union(
  v.object({ ok: v.literal(true), data: v.string(), charts: v.optional(v.array(answerChartValidator)) }),
  v.object({ ok: v.literal(false), error: v.string() }),
)

/** Units looked through to match a typed name (1,000-unit farms). */
const UNIT_SCAN = 2000
/** Rows of one table a period summary reads at most. */
const PERIOD_SCAN = 2000
const MAX_ROWS = 20

/** Thrown inside a tool to return a plain refusal to the model. */
class Refusal extends Error {}
const refuse = (message: string): never => {
  throw new Refusal(message)
}

const clampInt = (n: number | undefined, min: number, max: number, dflt: number) =>
  n != null && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt

function need(bound: MemberScope, permission: Permission) {
  if (!can(bound.member, permission)) refuse(`You do not have ${permission} permission.`)
}

/** A row's site is the member's chosen site (when set) and in their scope. */
function siteOk(bound: MemberScope, locationId: Id<'farmLocations'> | undefined | null) {
  if (bound.site && locationId !== bound.site._id) return false
  return inScope(bound, locationId ?? undefined)
}

async function findUnit(ctx: QueryCtx, bound: MemberScope, typed: string | undefined) {
  if (!typed?.trim()) refuse('Which unit? Give its name or code.')
  const m = matchUnit(await unitsInScope(ctx, bound, UNIT_SCAN), typed!)
  if (!m.unit) refuse(m.candidates.length ? `Which unit? Matches: ${m.candidates.join(', ')}` : 'No such unit in your sites.')
  return m.unit!
}

/** The period asked for: from/to dates, else the last `days` (default `dflt`) to today. */
function period(args: FarmReadArgs, today: string, dflt: number, maxDays = 366) {
  const to = args.to && isBusinessDate(args.to) ? args.to : today
  const days = clampInt(args.days, 1, maxDays, dflt)
  let from = args.from && isBusinessDate(args.from) ? args.from : addDays(to, -(days - 1))
  if (from > to) refuse('The period starts after it ends.')
  if (daysBetween(from, to) > maxDays) from = addDays(to, -maxDays)
  return { from, to }
}

const nameCache = (ctx: QueryCtx) => {
  const cache = new Map<string, string>()
  return async (id: Id<'cages'> | Id<'users'> | Id<'farmLocations'> | undefined | null) => {
    if (!id) return null
    const key = String(id)
    if (!cache.has(key)) {
      const doc = (await ctx.db.get(id)) as { name?: string; email?: string } | null
      cache.set(key, doc?.name || doc?.email || '—')
    }
    return cache.get(key)!
  }
}

// ── Forecasts ────────────────────────────────────────────────────────────

async function forecastUnit(ctx: QueryCtx, bound: MemberScope, args: FarmReadArgs, now: number) {
  need(bound, 'production.view')
  const unit = await findUnit(ctx, bound, args.unit)
  const today = await farmDate(ctx, bound, unit.locationId, now)
  const target = args.targetG && args.targetG > 0 && args.targetG < 100000 ? args.targetG : undefined
  const f = await unitForecast(ctx, bound.binding.companyId, unit, today, target)
  if (!f) return { unit: unit.name, forecast: null, note: 'No open batch with enough records to forecast.' }
  return {
    unit: unit.name,
    batch: f.batch_number,
    species: f.species_name,
    asOf: f.as_of,
    abwNowG: f.now ? { low: round(f.now.low, 1), expected: round(f.now.expected, 1), high: round(f.now.high, 1) } : null,
    lastWeighed: { date: f.start.date, abwG: round(f.start.abw_g, 1), measured: f.start.measured },
    fish: f.count,
    targetG: f.plan.target_g,
    targetFrom: f.target_source,
    reachesTarget: {
      ready: f.plan.ready,
      earliest: f.plan.earliest,
      expected: f.plan.expected,
      latest: f.plan.latest,
      expectedFish: f.plan.expected_count,
      expectedBiomassKg: round(f.plan.expected_biomass_kg, 0),
      biomassRangeKg: [round(f.plan.biomass_low_kg, 0), round(f.plan.biomass_high_kg, 0)],
    },
    method: f.method,
    samples: f.points,
    fewSamples: f.few_samples,
    feedLimited: f.feed.limited,
    charts: [forecastChart(unit.name, f.series)],
  }
}

async function harvestPlanner(ctx: QueryCtx, bound: MemberScope, args: FarmReadArgs, now: number) {
  need(bound, 'reports.view')
  const today = await farmDate(ctx, bound, bound.site?._id, now)
  const weeks = clampInt(args.weeks, 1, 26, 8)
  const until = addDays(today, weeks * 7)
  const target = args.targetG && args.targetG > 0 && args.targetG < 100000 ? args.targetG : undefined
  const unitSite = new Map<string, Id<'farmLocations'> | undefined>()
  const r = await plannerRows(
    ctx,
    bound.binding.companyId,
    async (rows) => {
      const out = []
      for (const s of rows) {
        let site = s.locationId
        if (!site) {
          const k = String(s.unitId)
          if (!unitSite.has(k)) unitSite.set(k, (await ctx.db.get(s.unitId))?.locationId)
          site = unitSite.get(k)
        }
        if (siteOk(bound, site)) out.push(s)
      }
      return out
    },
    { asOf: today, targetAbwG: target },
  )
  const due = r.rows.filter((row) => row.plan.ready || (row.plan.expected != null && row.plan.expected <= until))
  return {
    asOf: today,
    windowWeeks: weeks,
    until,
    targetG: target ?? 'per species / farm rule',
    unitsForecast: r.rows.length,
    openBatches: r.total,
    partial: r.truncated,
    reachTarget: due.length,
    units: due.slice(0, 25).map((row) => ({
      unit: row.unit_name,
      site: row.site_name,
      batch: row.batch_number,
      abwNowG: round(row.abw_now_g, 0),
      targetG: row.plan.target_g,
      ready: row.plan.ready,
      expected: row.plan.expected,
      earliest: row.plan.earliest,
      biomassKg: round(row.plan.expected_biomass_kg, 0),
      fewSamples: row.few_samples,
    })),
    more: Math.max(0, due.length - 25),
    expectedBiomassKg: round(due.reduce((s, row) => s + (row.plan.expected_biomass_kg ?? 0), 0), 0),
  }
}

// ── Sampling ─────────────────────────────────────────────────────────────

async function samplingHistory(ctx: QueryCtx, bound: MemberScope, args: FarmReadArgs) {
  need(bound, 'production.view')
  const companyId = bound.binding.companyId
  let rows: Doc<'biweeklyRecords'>[]
  let label: string
  if (args.unit?.trim()) {
    const unit = await findUnit(ctx, bound, args.unit)
    label = unit.name
    rows = await ctx.db
      .query('biweeklyRecords')
      .withIndex('by_cage_and_date', (q) => q.eq('cageId', unit._id))
      .order('desc')
      .take(12)
  } else if (args.batch?.trim()) {
    const code = args.batch.trim().slice(0, 60)
    label = code
    // A batch number (stocking) first: its unit's samples; else a sample's batch code.
    const stocking = await ctx.db
      .query('stockingHistory')
      .withIndex('by_company_and_batchNumber', (q) => q.eq('companyId', companyId).eq('batchNumber', code))
      .first()
    if (stocking && !stocking.deletedAt) {
      const cage = await ctx.db.get(stocking.cageId)
      if (!cage || !siteOk(bound, cage.locationId)) refuse('No such batch in your sites.')
      const all = await ctx.db
        .query('biweeklyRecords')
        .withIndex('by_cage_and_date', (q) => q.eq('cageId', stocking.cageId).gte('date', stocking.stockingDate))
        .order('desc')
        .take(12)
      rows = stocking.batchId ? all.filter((r) => !r.batchId || r.batchId === stocking.batchId) : all
      label = `${code} (${cage!.name})`
    } else {
      rows = await ctx.db
        .query('biweeklyRecords')
        .withIndex('by_company_and_batchCode', (q) => q.eq('companyId', companyId).eq('batchCode', code))
        .take(12)
      rows.sort((a, b) => b.date.localeCompare(a.date))
    }
  } else {
    return refuse('Which unit or batch?')
  }
  rows = rows.filter((r) => r.companyId === companyId && siteOk(bound, r.locationId))
  if (!rows.length) return { for: label, samples: [], note: 'No samples on record.' }
  const asc = [...rows].reverse()
  const samples = asc.map((r, i) => {
    const prev = asc[i - 1]
    const days = prev ? daysBetween(prev.date, r.date) : 0
    return {
      date: r.date,
      abwG: round(r.averageBodyWeight, 1),
      fishSampled: r.totalFishCount,
      adgGDay: prev && days > 0 ? round((r.averageBodyWeight - prev.averageBodyWeight) / days, 2) : null,
    }
  })
  const first = asc[0]
  const last = asc[asc.length - 1]
  const span = daysBetween(first.date, last.date)
  return {
    for: label,
    charts: [abwChart(label, samples)],
    samples,
    trend: {
      from: first.date,
      to: last.date,
      abwGainG: round(last.averageBodyWeight - first.averageBodyWeight, 1),
      adgGDay: span > 0 ? round((last.averageBodyWeight - first.averageBodyWeight) / span, 2) : null,
      lastAdgGDay: samples[samples.length - 1].adgGDay,
    },
  }
}

// ── Water quality ────────────────────────────────────────────────────────

const stats = (xs: number[]) =>
  xs.length
    ? { min: round(Math.min(...xs), 2), avg: round(xs.reduce((s, x) => s + x, 0) / xs.length, 2), max: round(Math.max(...xs), 2), n: xs.length }
    : null

async function waterQuality(ctx: QueryCtx, bound: MemberScope, args: FarmReadArgs, now: number) {
  need(bound, 'production.view')
  const companyId = bound.binding.companyId
  const days = clampInt(args.days, 1, 30, 7)
  const since = now - days * 86_400_000
  const overrides = await overridesFor(ctx, companyId)
  if (args.unit?.trim()) {
    const unit = await findUnit(ctx, bound, args.unit)
    const th = effectiveThresholds(unitTypeOf(unit), overrides)
    const rows = await ctx.db
      .query('waterQualityReadings')
      .withIndex('by_unitId_and_measuredAt', (q) => q.eq('unitId', unit._id).gte('measuredAt', since))
      .order('desc')
      .take(500)
    const latestEver =
      rows[0] ??
      (await ctx.db
        .query('waterQualityReadings')
        .withIndex('by_unitId_and_measuredAt', (q) => q.eq('unitId', unit._id))
        .order('desc')
        .first())
    const doMin = th.dissolvedOxygen?.min
    const lowDo = doMin != null ? rows.filter((r) => r.dissolvedOxygen != null && r.dissolvedOxygen < doMin) : []
    // Live probes (INT-007): latest DO and temperature of this unit.
    const sensor: Record<string, { value: number; at: string }> = {}
    for (const parameter of ['dissolved_oxygen', 'temperature']) {
      const s = await ctx.db
        .query('sensorReadings')
        .withIndex('by_cageId_and_parameter_and_measuredAt', (q) => q.eq('cageId', unit._id).eq('parameter', parameter))
        .order('desc')
        .first()
      if (s && s.companyId === companyId) sensor[parameter] = { value: round(s.value, 2)!, at: new Date(s.measuredAt).toISOString() }
    }
    const pick = (r: Doc<'waterQualityReadings'>) => ({
      date: r.date,
      at: new Date(r.measuredAt).toISOString(),
      source: r.source,
      doMgL: r.dissolvedOxygen ?? null,
      tempC: r.temperatureC ?? null,
      ph: r.ph ?? null,
      ammonia: r.ammonia ?? null,
      breaches: r.breachCount ?? 0,
    })
    return {
      unit: unit.name,
      days,
      latest: latestEver ? pick(latestEver) : null,
      sensor: Object.keys(sensor).length ? sensor : null,
      doMgL: stats(rows.flatMap((r) => (r.dissolvedOxygen != null ? [r.dissolvedOxygen] : []))),
      tempC: stats(rows.flatMap((r) => (r.temperatureC != null ? [r.temperatureC] : []))),
      doMinimum: doMin ?? null,
      lowDoEvents: lowDo.length,
      lowDo: lowDo.slice(0, 10).map((r) => ({ date: r.date, at: new Date(r.measuredAt).toISOString(), doMgL: r.dissolvedOxygen })),
      readings: rows.length,
      partial: rows.length >= 500,
      charts: [waterChart(unit.name, rows.map((r) => ({ date: r.date, doMgL: r.dissolvedOxygen, tempC: r.temperatureC })))],
    }
  }
  // Farm-wide: units with readings outside their thresholds in the period.
  const rows = await ctx.db
    .query('waterQualityReadings')
    .withIndex('by_companyId_and_measuredAt', (q) => q.eq('companyId', companyId).gte('measuredAt', since))
    .order('desc')
    .take(1000)
  const byUnit = new Map<string, { unitId: Id<'cages'>; breaches: number; lowDo: number; minDo: number | null; last: string }>()
  const units = new Map<string, Doc<'cages'> | null>()
  for (const r of rows) {
    if (!(r.breachCount ?? 0) || !siteOk(bound, r.locationId)) continue
    const k = String(r.unitId)
    if (!units.has(k)) units.set(k, await ctx.db.get(r.unitId))
    const unit = units.get(k)
    if (!unit || unit.archivedAt) continue
    const doMin = effectiveThresholds(unitTypeOf(unit), overrides).dissolvedOxygen?.min
    const e = byUnit.get(k) ?? { unitId: r.unitId, breaches: 0, lowDo: 0, minDo: null, last: r.date }
    e.breaches += 1
    if (r.dissolvedOxygen != null) {
      if (doMin != null && r.dissolvedOxygen < doMin) e.lowDo += 1
      e.minDo = e.minDo == null ? r.dissolvedOxygen : Math.min(e.minDo, r.dissolvedOxygen)
    }
    byUnit.set(k, e)
  }
  const list = [...byUnit.values()].sort((a, b) => b.lowDo - a.lowDo || b.breaches - a.breaches)
  return {
    days,
    site: bound.site?.name ?? 'all sites in scope',
    readingsScanned: rows.length,
    partial: rows.length >= 1000,
    unitsWithBreaches: list.length,
    units: list.slice(0, 15).map((e) => ({
      unit: units.get(String(e.unitId))?.name ?? '—',
      breachReadings: e.breaches,
      lowDoReadings: e.lowDo,
      lowestDoMgL: e.minDo,
      lastBreach: e.last,
    })),
    more: Math.max(0, list.length - 15),
  }
}

// ── Money ────────────────────────────────────────────────────────────────

async function salesSummary(ctx: QueryCtx, bound: MemberScope, args: FarmReadArgs, now: number) {
  need(bound, 'finance.view')
  const companyId = bound.binding.companyId
  const today = await farmDate(ctx, bound, bound.site?._id, now)
  const { from, to } =
    args.from || args.to || args.days ? period(args, today, 30) : { from: `${today.slice(0, 8)}01`, to: today }
  const currency = bound.company.settings?.locale?.currency ?? null

  const harvests = (
    await ctx.db
      .query('harvestRecords')
      .withIndex('by_company_and_harvestDate', (q) => q.eq('companyId', companyId).gte('harvestDate', from).lte('harvestDate', to))
      .take(PERIOD_SCAN)
  ).filter((h) => h.source !== 'sampling_page' && siteOk(bound, h.locationId))
  const sales = (
    await ctx.db
      .query('sales')
      .withIndex('by_company_and_saleDate', (q) => q.eq('companyId', companyId).gte('saleDate', from).lte('saleDate', to))
      .take(PERIOD_SCAN)
  ).filter((s) => siteOk(bound, s.locationId))
  const expenses = (
    await ctx.db
      .query('expenses')
      .withIndex('by_company_and_date', (q) => q.eq('companyId', companyId).gte('date', from).lte('date', to))
      .take(PERIOD_SCAN)
  ).filter((e) => !e.deletedAt && siteOk(bound, e.locationId))
  // Feed fed in the period at the list price on the daily records (rollups).
  const days = (
    await ctx.db
      .query('unitDailyStats')
      .withIndex('by_companyId_and_date', (q) => q.eq('companyId', companyId).gte('date', from).lte('date', to))
      .take(PERIOD_SCAN * 2)
  ).filter((d) => siteOk(bound, d.locationId))
  // Outstanding: unpaid balances of recent sales (any date in the last year).
  const open = (
    await ctx.db
      .query('sales')
      .withIndex('by_company_and_saleDate', (q) => q.eq('companyId', companyId).gte('saleDate', addDays(today, -365)))
      .order('desc')
      .take(PERIOD_SCAN)
  ).filter((s) => siteOk(bound, s.locationId))

  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + (f(x) || 0), 0)
  const harvestedKg = sum(harvests, (h) => h.totalWeight)
  const soldKg = sum(sales, (s) => s.weightKg)
  const revenue = sum(sales, (s) => s.totalAmount)
  const expenseTotal = sum(expenses, (e) => e.amount)
  const feedCost = sum(days, (d) => d.feedCostList)
  const costs = expenseTotal + feedCost
  const byCategory = new Map<string, number>()
  for (const e of expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount)
  const balances = open.map((s) => ({ s, due: Math.max(0, s.totalAmount - amountPaidOf(s)) })).filter((b) => b.due > 0.005)
  const byCustomer = new Map<string, number>()
  for (const b of balances) {
    const k = b.s.customerName || 'Unnamed buyer'
    byCustomer.set(k, (byCustomer.get(k) ?? 0) + b.due)
  }
  const partial = [harvests, sales, expenses, open].some((xs) => xs.length >= PERIOD_SCAN) || days.length >= PERIOD_SCAN * 2
  return {
    from,
    to,
    currency,
    site: bound.site?.name ?? 'all sites in scope',
    harvests: { count: harvests.length, kg: round(harvestedKg, 1) },
    sales: { count: sales.length, kg: round(soldKg, 1), revenue: round(revenue, 2), revenuePerKg: soldKg > 0 ? round(revenue / soldKg, 2) : null },
    costs: {
      total: round(costs, 2),
      feedAtListPrice: round(feedCost, 2),
      expenses: round(expenseTotal, 2),
      byCategory: Object.fromEntries([...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => [k, round(n, 2)])),
      perKgHarvested: harvestedKg > 0 ? round(costs / harvestedKg, 2) : null,
    },
    profit: round(revenue - costs, 2),
    marginPct: revenue > 0 ? round(((revenue - costs) / revenue) * 100, 1) : null,
    outstanding: {
      total: round(sum(balances, (b) => b.due), 2),
      sales: balances.length,
      topCustomers: [...byCustomer.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([customer, due]) => ({ customer, due: round(due, 2) })),
    },
    partial,
    note: 'Costs are recorded expenses plus feed at list price; fingerlings and labour count only when entered as expenses.',
    charts: [
      moneyChart(from, to, currency, [
        ...sales.map((x) => ({ date: x.saleDate, revenue: x.totalAmount })),
        ...expenses.map((e) => ({ date: e.date, cost: e.amount })),
        ...days.map((d) => ({ date: d.date, cost: d.feedCostList })),
      ]),
      feedChart(days.map((d) => ({ date: d.date, feedKg: d.feedKg })), bound.site?.name ?? 'all sites in scope'),
    ],
  }
}

// ── Stock movements and approvals ────────────────────────────────────────

async function stockingTransfers(ctx: QueryCtx, bound: MemberScope, args: FarmReadArgs, now: number) {
  need(bound, 'production.view')
  const companyId = bound.binding.companyId
  const today = await farmDate(ctx, bound, bound.site?._id, now)
  const { from, to } = period(args, today, 30)
  const name = nameCache(ctx)
  const inPeriod = (d: string) => d >= from && d <= to
  // No date index on these tables: the newest rows of the company, filtered.
  const stockings = (
    await ctx.db
      .query('stockingHistory')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(PERIOD_SCAN)
  ).filter((s) => !s.deletedAt && inPeriod(s.stockingDate) && siteOk(bound, s.locationId))
  const topups = (
    await ctx.db
      .query('topupHistory')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(PERIOD_SCAN)
  ).filter((t) => inPeriod(t.topupDate) && siteOk(bound, t.locationId))
  const transfers = (
    await ctx.db
      .query('fishTransfers')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(PERIOD_SCAN)
  ).filter((t) => inPeriod(t.transferDate) && (siteOk(bound, t.sourceLocationId) || siteOk(bound, t.destinationLocationId)))
  const stockingRows = []
  for (const s of stockings.slice(0, 15)) {
    stockingRows.push({ unit: await name(s.cageId), date: s.stockingDate, batch: s.batchNumber, fish: s.fishCount, abwG: s.initialAbw, status: s.status })
  }
  const topupRows = []
  for (const tp of topups.slice(0, 15)) {
    const st = await ctx.db.get(tp.stockingId)
    topupRows.push({ unit: await name(st?.cageId), date: tp.topupDate, fish: tp.fishCount, abwG: tp.abw, status: tp.status })
  }
  const transferRows = []
  for (const t of transfers.slice(0, 15)) {
    transferRows.push({
      from: await name(t.sourceCageId),
      to: await name(t.destinationCageId),
      date: t.transferDate,
      fish: t.quantity,
      abwG: t.abw,
      status: t.reversedAt ? 'reversed' : t.status,
    })
  }
  const total = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)
  return {
    from,
    to,
    stockings: { count: stockings.length, fish: total(stockings, (s) => s.fishCount), rows: stockingRows },
    topups: { count: topups.length, fish: total(topups, (t) => t.fishCount), rows: topupRows },
    transfers: { count: transfers.length, fish: total(transfers, (t) => t.quantity), rows: transferRows },
  }
}

async function pendingApprovals(ctx: QueryCtx, bound: MemberScope) {
  const canStock = can(bound.member, 'production.stocking.approve')
  const canTransfer = can(bound.member, 'production.transfer.approve')
  if (!canStock && !canTransfer) refuse('You cannot approve stockings or transfers.')
  const companyId = bound.binding.companyId
  const me = bound.member.user._id
  const name = nameCache(ctx)
  const pendingTransfers = () =>
    ctx.db
      .query('fishTransfers')
      .withIndex('by_company_and_status', (q) => q.eq('companyId', companyId).eq('status', 'pending_approval'))
      .take(500)
  const transfers = canTransfer
    ? (await pendingTransfers()).filter((t) => siteOk(bound, t.sourceLocationId) || siteOk(bound, t.destinationLocationId))
    : []
  // A stocking or top-up a transfer created is decided with the transfer.
  const allTransfers = canStock ? await pendingTransfers() : transfers
  const linkedS = new Set(allTransfers.map((t) => String(t.destinationStockingId ?? '')))
  const linkedT = new Set(allTransfers.map((t) => String(t.destinationTopupId ?? '')))
  const stockings = canStock
    ? (
        await ctx.db
          .query('stockingHistory')
          .withIndex('by_company_and_status', (q) => q.eq('companyId', companyId).eq('status', 'pending_approval'))
          .take(500)
      ).filter((s) => !s.deletedAt && !linkedS.has(String(s._id)) && siteOk(bound, s.locationId))
    : []
  const topups = canStock
    ? (
        await ctx.db
          .query('topupHistory')
          .withIndex('by_company_and_status', (q) => q.eq('companyId', companyId).eq('status', 'pending_approval'))
          .take(500)
      ).filter((t) => !linkedT.has(String(t._id)) && siteOk(bound, t.locationId))
    : []
  const rows: Array<Record<string, unknown> & { created: number }> = []
  for (const s of stockings) {
    rows.push({
      kind: 'stocking',
      ref: s._id,
      unit: await name(s.cageId),
      date: s.stockingDate,
      fish: s.fishCount,
      abwG: s.initialAbw,
      batch: s.batchNumber,
      requestedBy: await name(s.createdBy),
      youRequested: s.createdBy === me,
      created: s._creationTime,
    })
  }
  for (const tp of topups) {
    const st = await ctx.db.get(tp.stockingId)
    rows.push({
      kind: 'topup',
      ref: tp._id,
      unit: await name(st?.cageId),
      date: tp.topupDate,
      fish: tp.fishCount,
      abwG: tp.abw,
      requestedBy: await name(tp.createdBy),
      youRequested: tp.createdBy === me,
      created: tp._creationTime,
    })
  }
  for (const t of transfers) {
    rows.push({
      kind: 'transfer',
      ref: t._id,
      unit: `${await name(t.sourceCageId)} → ${await name(t.destinationCageId)}`,
      date: t.transferDate,
      fish: t.quantity,
      abwG: t.abw,
      requestedBy: await name(t.createdBy),
      youRequested: t.createdBy === me,
      created: t._creationTime,
    })
  }
  rows.sort((a, b) => a.created - b.created)
  const differentApprover = bound.company.settings?.stockingRules?.requireDifferentApprover === true
  return {
    pending: rows.length,
    requests: rows.slice(0, MAX_ROWS).map(({ created: _c, ...r }) => r),
    more: Math.max(0, rows.length - MAX_ROWS),
    rule: differentApprover ? 'Someone other than the requester must approve (youRequested = true cannot be approved by you).' : null,
  }
}

// ── Hatchery and traceability ────────────────────────────────────────────

async function hatcherySummary(ctx: QueryCtx, bound: MemberScope, args: FarmReadArgs, now: number) {
  need(bound, 'hatchery.view')
  const companyId = bound.binding.companyId
  const today = await farmDate(ctx, bound, bound.site?._id, now)
  const { from, to } = period(args, today, 30)
  const statuses = ['conditioning', 'ready', 'resting', 'spent'] as const
  const brood: Record<string, { groups: number; fish: number }> = {}
  for (const status of statuses) {
    const rows = (
      await ctx.db
        .query('broodstock')
        .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', status))
        .take(500)
    ).filter((b) => siteOk(bound, b.locationId))
    brood[status] = { groups: rows.length, fish: rows.reduce((s, b) => s + b.count, 0) }
  }
  const spawns = (
    await ctx.db
      .query('spawningEvents')
      .withIndex('by_companyId_and_spawnDate', (q) => q.eq('companyId', companyId).gte('spawnDate', from).lte('spawnDate', to))
      .take(500)
  ).filter((s) => siteOk(bound, s.locationId))
  const lotRows: Doc<'incubationLots'>[] = []
  for (const s of spawns) {
    lotRows.push(
      ...(await ctx.db
        .query('incubationLots')
        .withIndex('by_spawningEventId', (q) => q.eq('spawningEventId', s._id))
        .take(20)),
    )
  }
  const incubating = (
    await ctx.db
      .query('incubationLots')
      .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', 'incubating'))
      .take(500)
  ).filter((l) => siteOk(bound, l.locationId))
  const hatched = lotRows.filter((l) => l.status === 'hatched')
  const eggs = spawns.reduce((s, x) => s + (x.eggsCollected ?? 0), 0)
  const larvae = hatched.reduce((s, l) => s + (l.larvaeCount ?? 0), 0)
  const lotEggs = hatched.reduce((s, l) => s + l.eggs, 0)
  return {
    from,
    to,
    broodstock: brood,
    spawns: {
      count: spawns.length,
      failed: spawns.filter((s) => s.status === 'failed').length,
      eggsCollected: eggs,
      meanFertilizationPct: (() => {
        const f = spawns.flatMap((s) => (s.fertilizationPct != null ? [s.fertilizationPct] : []))
        return f.length ? round(f.reduce((a, b) => a + b, 0) / f.length, 1) : null
      })(),
    },
    fryOutput: { lotsHatched: hatched.length, larvae, hatchPct: lotEggs > 0 ? round((larvae / lotEggs) * 100, 1) : null },
    incubatingNow: { lots: incubating.length, eggs: incubating.reduce((s, l) => s + l.eggs, 0) },
  }
}

async function lotLookup(ctx: QueryCtx, bound: MemberScope, args: FarmReadArgs) {
  need(bound, 'production.view')
  const code = (args.code ?? args.batch ?? '').trim().toUpperCase().slice(0, 60)
  if (!code) return refuse('Which lot code?')
  const companyId = bound.binding.companyId
  const lot = await ctx.db
    .query('harvestLots')
    .withIndex('by_companyId_and_lotCode', (q) => q.eq('companyId', companyId).eq('lotCode', code))
    .first()
  if (!lot || !siteOk(bound, lot.locationId)) refuse(`No lot ${code} in your sites.`)
  const l = lot!
  const cage = await ctx.db.get(l.cageId)
  const batch = l.batchId ? await ctx.db.get(l.batchId) : null
  const harvest = await ctx.db.get(l.harvestId)
  const dispatches = await ctx.db
    .query('dispatches')
    .withIndex('by_harvestLotId', (q) => q.eq('harvestLotId', l._id))
    .take(20)
  const dispatched = dispatches.reduce((s, d) => s + d.weightKg, 0)
  return {
    lot: l.lotCode,
    harvestDate: l.harvestDate,
    unit: cage?.name ?? null,
    batch: batch?.batchNumber ?? null,
    weightKg: l.weightKg,
    fish: l.fishCount ?? null,
    grade: l.grade ?? null,
    destination: l.destination ?? null,
    harvest: harvest ? { type: harvest.harvestType ?? null, abwG: harvest.averageBodyWeight, totalKg: harvest.totalWeight } : null,
    withdrawal: harvest?.withdrawalOverride ? 'harvested under an admin withdrawal override' : 'no withdrawal override on record',
    dispatches: dispatches.slice(0, 10).map((d) => ({ date: d.dispatchDate, kg: d.weightKg, customer: d.customerName ?? null, vehicle: d.vehicle ?? null })),
    dispatchedKg: round(dispatched, 1),
    remainingKg: round(Math.max(0, l.weightKg - dispatched), 1),
  }
}

// ── Plans and alerts ─────────────────────────────────────────────────────

async function cyclePlans(ctx: QueryCtx, bound: MemberScope) {
  need(bound, 'production.plan.manage')
  const companyId = bound.binding.companyId
  const plans = await ctx.db
    .query('cyclePlans')
    .withIndex('by_companyId_and_updatedAt', (q) => q.eq('companyId', companyId))
    .order('desc')
    .take(20)
  const out = []
  for (const p of plans) {
    const names: string[] = []
    let ok = true
    for (const id of p.unitIds) {
      const cage = await ctx.db.get(id)
      if (!cage) continue
      if (cage.companyId !== companyId || !inScope(bound, cage.locationId)) {
        ok = false
        break
      }
      names.push(cage.name)
    }
    if (!ok || (!names.length && bound.member.siteScope !== 'all')) continue
    if (bound.site && p.locationId && p.locationId !== bound.site._id) continue
    out.push({
      name: p.name,
      units: names.length,
      unitNames: names.slice(0, 8),
      stockOn: p.inputs.stockOn,
      fishPerUnit: p.inputs.fishPerUnit,
      stockAbwG: p.inputs.stockAbwG,
      harvestAbwG: p.inputs.harvestAbwG,
      salePricePerKg: p.inputs.salePricePerKg,
      survivalPct: p.assumptions.survivalPct,
      fcr: p.assumptions.fcr,
      updated: new Date(p.updatedAt).toISOString().slice(0, 10),
    })
  }
  return { plans: out, note: out.length ? null : 'No saved cycle plans you can see.' }
}

async function sensorAlerts(ctx: QueryCtx, bound: MemberScope, now: number) {
  need(bound, 'production.view')
  const companyId = bound.binding.companyId
  const rank = { critical: 0, warning: 1, info: 2 } as const
  const alerts = (
    await ctx.db
      .query('farmAlerts')
      .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', 'open'))
      .take(500)
  ).filter((a) => siteOk(bound, a.locationId))
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || b.lastSeenDate.localeCompare(a.lastSeenDate))
  // Sensor readings of the last 24 h outside the water thresholds.
  const since = now - 86_400_000
  const breaches = (
    await ctx.db
      .query('waterQualityReadings')
      .withIndex('by_companyId_and_measuredAt', (q) => q.eq('companyId', companyId).gte('measuredAt', since))
      .order('desc')
      .take(500)
  ).filter((r) => (r.breachCount ?? 0) > 0 && siteOk(bound, r.locationId))
  const name = nameCache(ctx)
  const seen = new Set<string>()
  const water = []
  for (const r of breaches) {
    if (seen.has(String(r.unitId))) continue
    seen.add(String(r.unitId))
    water.push({ unit: await name(r.unitId), at: new Date(r.measuredAt).toISOString(), source: r.source, doMgL: r.dissolvedOxygen ?? null, tempC: r.temperatureC ?? null })
    if (water.length >= 10) break
  }
  return {
    openAlerts: alerts.length,
    alerts: alerts.slice(0, MAX_ROWS).map((a) => ({
      unit: a.unitName,
      rule: a.rule,
      severity: a.severity,
      since: a.date,
      lastSeen: a.lastSeenDate,
      evidence: a.evidence,
    })),
    more: Math.max(0, alerts.length - MAX_ROWS),
    waterBreachesLast24h: { units: seen.size, latest: water },
  }
}

// ── Entry points ─────────────────────────────────────────────────────────

/** One farm read tool for a member scope (web member or chat binding). */
export async function farmReadFor(
  ctx: QueryCtx,
  bound: MemberScope,
  tool: FarmReadTool,
  args: FarmReadArgs,
  now: number,
): Promise<ReadOut> {
  try {
    let data: unknown
    if (tool === 'forecast_unit') data = await forecastUnit(ctx, bound, args, now)
    else if (tool === 'harvest_planner') data = await harvestPlanner(ctx, bound, args, now)
    else if (tool === 'sampling_history') data = await samplingHistory(ctx, bound, args)
    else if (tool === 'water_quality') data = await waterQuality(ctx, bound, args, now)
    else if (tool === 'sales_summary') data = await salesSummary(ctx, bound, args, now)
    else if (tool === 'stocking_transfers') data = await stockingTransfers(ctx, bound, args, now)
    else if (tool === 'pending_approvals') data = await pendingApprovals(ctx, bound)
    else if (tool === 'hatchery_summary') data = await hatcherySummary(ctx, bound, args, now)
    else if (tool === 'lot_lookup') data = await lotLookup(ctx, bound, args)
    else if (tool === 'cycle_plans') data = await cyclePlans(ctx, bound)
    else data = await sensorAlerts(ctx, bound, now)
    const { charts, ...rest } = data as { charts?: (AnswerChart | null)[] }
    const drawn = (charts ?? []).filter((c): c is AnswerChart => c !== null)
    return { ok: true as const, data: JSON.stringify(rest), ...(drawn.length ? { charts: drawn } : {}) }
  } catch (err) {
    if (err instanceof Refusal) return { ok: false as const, error: err.message }
    throw err
  }
}

/** A farm read for the signed-in member (Ask Anowa web). */
export const read = internalQuery({
  args: { siteId: v.optional(v.id('farmLocations')), tool: farmReadTool, args: farmReadArgs, now: v.number() },
  returns: readResult,
  handler: async (ctx, { siteId, tool, args, now }) => {
    const w = await webMember(ctx, await requireMember(ctx, { permission: 'ai.use' }), siteId)
    if (!can(w.member, 'ai.use')) return { ok: false as const, error: 'The assistant is not available to you.' }
    return await farmReadFor(ctx, w, tool, args, now)
  },
})

/** A farm read for a chat binding (the farm bot). */
export const botRead = internalQuery({
  args: { bindingId: v.id('channelBindings'), tool: farmReadTool, args: farmReadArgs, now: v.number() },
  returns: readResult,
  handler: async (ctx, { bindingId, tool, args, now }) => {
    const binding = await ctx.db.get(bindingId)
    if (!binding) return { ok: false as const, error: 'not connected' }
    const checked = await checkBinding(ctx, binding)
    if (!checked.ok) return { ok: false as const, error: 'not connected' }
    return await farmReadFor(ctx, checked.bound, tool, args, now)
  },
})
