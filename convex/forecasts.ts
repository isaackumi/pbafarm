import { v } from 'convex/values'
import { query, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember, type MemberContext } from './lib/permissions'
import { userError } from './lib/errors'
import { addDays, isBusinessDate } from './lib/dates'
import { daysBetween } from './lib/kpi'
import { mergeSettings } from './lib/farmRules'
import { inSiteScope, rollupRowsInSiteScope } from './lib/scope'
import { bandOn, bandSeries, harvestPlan, accuracySummary } from './lib/growthForecast'
import { FORECAST_CHECK_DAYS, occupancyForecast, type OccupancyForecast } from './lib/forecastData'

/**
 * Growth and harvest forecasts (AI-004): per unit (cage page), the farm's
 * harvest planner, and the forecast error of recorded harvests. Estimates
 * from lib/growthForecast; "today" comes from the client, never the clock.
 */

/** Open occupancies the planner forecasts at most (each reads its own history). */
const MAX_PLANNER_ROWS = 80
const MAX_CHECKS = 500

const num = v.number()
const numOrNull = v.union(v.number(), v.null())
const strOrNull = v.union(v.string(), v.null())
const band = v.object({ date: v.string(), low: num, expected: num, high: num })

const planValidator = v.object({
  target_g: num,
  ready: v.boolean(),
  earliest: strOrNull,
  expected: strOrNull,
  latest: strOrNull,
  expected_count: numOrNull,
  expected_biomass_kg: numOrNull,
  biomass_low_kg: numOrNull,
  biomass_high_kg: numOrNull,
})

const targetSource = v.union(v.literal('input'), v.literal('species'), v.literal('farm'))

function assertDate(value: string, label: string) {
  if (!isBusinessDate(value)) throw userError('VALIDATION', `${label} must be a date (YYYY-MM-DD)`)
}

function inScope(m: MemberContext, cage: Doc<'cages'>) {
  return m.siteScope === 'all' || (!!cage.locationId && m.siteScope.has(cage.locationId))
}

async function farmTargetG(ctx: QueryCtx, companyId: Id<'companies'>) {
  const company = await ctx.db.get(companyId)
  return mergeSettings(company?.settings).farmRules.targetHarvestAbwG
}

/** Harvest weight: the caller's, else the species', else the farm rule. */
function chooseTarget(input: number | undefined, f: OccupancyForecast, farmG: number) {
  if (input && input > 0) return { g: input, source: 'input' as const }
  const sp = f.species.prior?.targetHarvestAbwG
  if (sp && sp > 0) return { g: sp, source: 'species' as const }
  return { g: farmG, source: 'farm' as const }
}

function planOut(f: OccupancyForecast, asOf: string, targetG: number) {
  const p = harvestPlan(f.forecast, asOf, targetG)
  return {
    target_g: p.targetG,
    ready: p.ready,
    earliest: p.earliest,
    expected: p.expected,
    latest: p.latest,
    expected_count: p.expectedCount,
    expected_biomass_kg: p.expectedBiomassKg,
    biomass_low_kg: p.biomassLowKg,
    biomass_high_kg: p.biomassHighKg,
  }
}

/** The batch in the unit to forecast: its current batch, else its open occupancy. */
async function openBatchOf(ctx: QueryCtx, cage: Doc<'cages'>) {
  const rows = await ctx.db
    .query('batchStats')
    .withIndex('by_unitId_and_batchId', (q) => q.eq('unitId', cage._id))
    .take(200)
  const current = cage.currentBatchId ? rows.find((r) => r.batchId === cage.currentBatchId) : undefined
  if (current) return { batchId: current.batchId, stats: current }
  const open = rows.filter((r) => r.open).sort((a, b) => b.asOf.localeCompare(a.asOf))[0]
  if (open) return { batchId: open.batchId, stats: open }
  return cage.currentBatchId ? { batchId: cage.currentBatchId, stats: null } : null
}

/**
 * The cage page forecast: ABW band from the last weight on record, the inputs
 * it used, and when the fish reach the target weight.
 */
export const forUnit = query({
  args: {
    unitId: v.id('cages'),
    /** Client's today. */
    asOf: v.string(),
    /** Harvest weight (g); default the species' target, else the farm rule. */
    targetAbwG: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      batch_id: v.id('batches'),
      batch_number: strOrNull,
      species_key: strOrNull,
      species_name: strOrNull,
      grades: v.array(v.object({ key: v.string(), label: v.string(), min_g: numOrNull })),
      as_of: v.string(),
      method: v.union(v.literal('fitted'), v.literal('species_curve')),
      points: num,
      few_samples: v.boolean(),
      start: v.object({ date: v.string(), abw_g: num, measured: v.boolean() }),
      tgc: v.object({ low: num, expected: num, high: num, prior: num }),
      temperature: v.object({ c: num, source: v.union(v.literal('recorded'), v.literal('default')) }),
      feed: v.object({
        rate_pct_bw: numOrNull,
        fcr: num,
        fcr_source: v.union(v.literal('cycle'), v.literal('species'), v.literal('default')),
        limited: v.boolean(),
      }),
      daily_mortality_pct: numOrNull,
      count: num,
      now: v.union(band, v.null()),
      series: v.array(band),
      target_source: targetSource,
      plan: planValidator,
    }),
  ),
  handler: async (ctx, args) => {
    assertDate(args.asOf, 'As of')
    const m = await requireMember(ctx, { permission: 'production.view' })
    const cage = await ctx.db.get(args.unitId)
    if (!cage || !m.companyId || cage.companyId !== m.companyId || cage.archivedAt || !inScope(m, cage)) return null
    return await unitForecast(ctx, m.companyId, cage, args.asOf, args.targetAbwG)
  },
})

/**
 * The forecast of one unit the caller may already see (tenant and site
 * checked by the caller): the cage page and Ask Anowa share it.
 */
export async function unitForecast(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
  cage: Doc<'cages'>,
  asOf: string,
  targetAbwG?: number,
) {
  const args = { asOf, targetAbwG }
  const open = await openBatchOf(ctx, cage)
  if (!open) return null
  const f = await occupancyForecast(ctx, cage, open.batchId, args.asOf, { stats: open.stats })
  if (!f) return null
  const target = chooseTarget(args.targetAbwG, f, await farmTargetG(ctx, companyId))
  const plan = planOut(f, args.asOf, target.g)
  // Show the band to the latest harvest date (or 8 weeks), at most 26 weeks ahead.
  const end = plan.latest ?? plan.expected ?? addDays(args.asOf, 56)
  const weeks = Math.min(Math.ceil((daysBetween(f.forecast.start.date, end) + 7) / 7), Math.ceil(daysBetween(f.forecast.start.date, args.asOf) / 7) + 26)
  const fc = f.forecast
  return {
    batch_id: f.batchId,
    batch_number: f.batchNumber,
    species_key: f.speciesKey,
    species_name: f.species.name,
    grades: f.species.grades
      .filter((g) => g.minG != null && g.minG > 0)
      .map((g) => ({ key: g.key, label: g.label, min_g: g.minG ?? null })),
    as_of: args.asOf,
    method: fc.method,
    points: fc.points,
    few_samples: fc.fewSamples,
    start: { date: fc.start.date, abw_g: fc.start.abwG, measured: fc.start.measured },
    tgc: fc.tgc,
    temperature: fc.temperature,
    feed: {
      rate_pct_bw: fc.feed.ratePctBw,
      fcr: fc.feed.fcr,
      fcr_source: fc.feed.fcrSource,
      limited: fc.feed.limited,
    },
    daily_mortality_pct: fc.dailyMortalityPct,
    count: fc.count,
    now: bandOn(fc, args.asOf),
    series: bandSeries(fc, fc.start.date, Math.max(1, weeks)),
    target_source: target.source,
    plan,
  }
}

/**
 * Farm harvest planner: every open occupancy with the dates it reaches the
 * target weight and the biomass expected then, soonest first. The client
 * picks the window (next N weeks) from `earliest`.
 */
export const harvestPlanner = query({
  args: {
    asOf: v.string(),
    targetAbwG: v.optional(v.number()),
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: v.object({
    as_of: v.string(),
    truncated: v.boolean(),
    rows: v.array(
      v.object({
        unit_id: v.id('cages'),
        unit_name: v.string(),
        site_name: strOrNull,
        batch_id: v.id('batches'),
        batch_number: strOrNull,
        species_key: strOrNull,
        method: v.union(v.literal('fitted'), v.literal('species_curve')),
        few_samples: v.boolean(),
        abw_now_g: numOrNull,
        count: num,
        feed_limited: v.boolean(),
        target_source: targetSource,
        plan: planValidator,
      }),
    ),
  }),
  handler: async (ctx, args) => {
    assertDate(args.asOf, 'As of')
    const m = await requireMember(ctx, { permission: 'reports.view', locationId: args.locationId })
    if (!m.companyId) return { as_of: args.asOf, truncated: false, rows: [] }
    const r = await plannerRows(ctx, m.companyId, (rows) => rollupRowsInSiteScope(ctx, m.user, rows), args)
    return { as_of: r.as_of, truncated: r.truncated, rows: r.rows }
  },
})

/**
 * The planner rows of a company's open occupancies that `filterRows` keeps
 * (the caller's site scope), soonest first; at most `maxRows` forecasts.
 */
export async function plannerRows(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
  filterRows: (rows: Doc<'batchStats'>[]) => Promise<Doc<'batchStats'>[]>,
  args: { asOf: string; targetAbwG?: number; locationId?: Id<'farmLocations'> },
  maxRows = MAX_PLANNER_ROWS,
) {
  const open = await ctx.db
    .query('batchStats')
    .withIndex('by_companyId_and_open', (q) => q.eq('companyId', companyId).eq('open', true))
    .take(2000)
  const scoped = (await filterRows(open)).filter((s) => !args.locationId || s.locationId === args.locationId)
  const farmG = await farmTargetG(ctx, companyId)
  const siteNames = new Map<string, string>()
  const rows = []
  for (const s of scoped.slice(0, maxRows)) {
    const cage = await ctx.db.get(s.unitId)
    if (!cage || cage.archivedAt || cage.companyId !== companyId) continue
    const f = await occupancyForecast(ctx, cage, s.batchId, args.asOf, { stats: s })
    if (!f) continue
    const target = chooseTarget(args.targetAbwG, f, farmG)
    const locationId = s.locationId ?? cage.locationId
    if (locationId && !siteNames.has(locationId)) {
      siteNames.set(locationId, (await ctx.db.get(locationId))?.name ?? '')
    }
    rows.push({
      unit_id: cage._id,
      unit_name: cage.name,
      site_name: locationId ? siteNames.get(locationId) || null : null,
      batch_id: f.batchId,
      batch_number: f.batchNumber,
      species_key: f.speciesKey,
      method: f.forecast.method,
      few_samples: f.forecast.fewSamples,
      abw_now_g: bandOn(f.forecast, args.asOf)?.expected ?? null,
      count: f.forecast.count,
      feed_limited: f.forecast.feed.limited,
      target_source: target.source,
      plan: planOut(f, args.asOf, target.g),
    })
  }
  rows.sort(
    (a, b) =>
      (a.plan.expected ?? '9999').localeCompare(b.plan.expected ?? '9999') ||
      a.unit_name.localeCompare(b.unit_name, undefined, { numeric: true }),
  )
  return { as_of: args.asOf, truncated: scoped.length > maxRows, total: scoped.length, rows }
}

/**
 * Forecast error against actual harvests (AI-004 acceptance): for each
 * harvest in [from, to], the ABW forecast FORECAST_CHECK_DAYS earlier vs the
 * ABW harvested, and the mean absolute error, bias and band hit rate.
 */
export const accuracy = query({
  args: {
    from: v.string(),
    to: v.string(),
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: v.object({
    horizon_days: num,
    summary: v.object({ n: num, mapePct: numOrNull, biasPct: numOrNull, withinBandPct: numOrNull }),
    rows: v.array(
      v.object({
        harvest_id: v.id('harvestRecords'),
        unit_name: v.string(),
        harvest_date: v.string(),
        forecast_made_on: v.string(),
        method: v.union(v.literal('fitted'), v.literal('species_curve')),
        predicted_low_g: num,
        predicted_g: num,
        predicted_high_g: num,
        actual_g: num,
        error_pct: num,
        within_band: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    assertDate(args.from, 'From')
    assertDate(args.to, 'To')
    const m = await requireMember(ctx, { permission: 'reports.view', locationId: args.locationId })
    const empty = { horizon_days: FORECAST_CHECK_DAYS, summary: accuracySummary([]), rows: [] }
    if (!m.companyId) return empty
    const companyId = m.companyId
    const checks = await ctx.db
      .query('harvestForecastChecks')
      .withIndex('by_companyId_and_harvestDate', (q) =>
        q.eq('companyId', companyId).gte('harvestDate', args.from).lte('harvestDate', args.to),
      )
      .order('desc')
      .take(MAX_CHECKS)
    const visible = inSiteScope(m.user, checks).filter((c) => !args.locationId || c.locationId === args.locationId)
    const unitNames = new Map<string, string>()
    const rows = []
    for (const c of visible) {
      if (!unitNames.has(c.unitId)) unitNames.set(c.unitId, (await ctx.db.get(c.unitId))?.name ?? '—')
      rows.push({
        harvest_id: c.harvestRecordId,
        unit_name: unitNames.get(c.unitId)!,
        harvest_date: c.harvestDate,
        forecast_made_on: c.forecastMadeOn,
        method: c.method,
        predicted_low_g: c.predictedLowG,
        predicted_g: c.predictedAbwG,
        predicted_high_g: c.predictedHighG,
        actual_g: c.actualAbwG,
        error_pct: c.errorPct,
        within_band: c.withinBand,
      })
    }
    return {
      horizon_days: FORECAST_CHECK_DAYS,
      summary: accuracySummary(rows.map((r) => ({ errorPct: r.error_pct, withinBand: r.within_band }))),
      rows,
    }
  },
})
