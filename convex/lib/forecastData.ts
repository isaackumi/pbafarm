/**
 * Inputs of the growth forecast (AI-004, lib/growthForecast) for one
 * occupancy, read as of a date: ledger events, samples, daily temperatures
 * and feed (unitDailyStats, sensors), deaths, eFCR and the species defaults.
 * Everything is filtered to `asOf`, so the same call rebuilds a past
 * forecast for the error check. Reads are bounded; no wall clock.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { compareEvents, flowsOf } from './kpi'
import { addDays } from './dates'
import { eventsForPair, samplesFor } from './productionEngine'
import { snapAt } from './analytics'
import { DEFAULT_SPECIES, type HarvestGrade } from './species'
import { bandOn, forecastError, forecastGrowth, type Forecast, type SpeciesPrior } from './growthForecast'

type Ctx = QueryCtx | MutationCtx

/** Days of daily temperatures and feed read before asOf (older days use their mean). */
const DAILY_LOOKBACK_DAYS = 120
/** Sensor readings read for the last 14 days' temperature. */
const SENSOR_TAKE = 96
const DAY_MS = 86_400_000

/** How long before a harvest the checked forecast was made (AI-004 error tracking). */
export const FORECAST_CHECK_DAYS = 28

export type SpeciesInfo = {
  prior: SpeciesPrior
  name: string | null
  grades: HarvestGrade[]
}

/** The company's species row, else the built-in default for the key. */
export async function speciesInfo(
  ctx: Ctx,
  companyId: Id<'companies'> | undefined,
  key: string | null | undefined,
): Promise<SpeciesInfo> {
  if (!key) return { prior: null, name: null, grades: [] }
  const row = companyId
    ? await ctx.db
        .query('species')
        .withIndex('by_companyId_and_key', (q) => q.eq('companyId', companyId).eq('key', key))
        .first()
    : null
  const builtIn = DEFAULT_SPECIES.find((s) => s.key === key)
  return {
    prior: {
      key,
      targetFcr: row?.targetFcr ?? builtIn?.targetFcr ?? null,
      targetHarvestAbwG: row?.targetHarvestAbwG ?? builtIn?.targetHarvestAbwG ?? null,
      expectedDailyGrowthG: row?.expectedDailyGrowthG ?? builtIn?.expectedDailyGrowthG ?? null,
    },
    name: row?.name ?? builtIn?.name ?? null,
    grades: (row?.harvestGrades ?? builtIn?.harvestGrades ?? []).map((g) => ({ ...g })),
  }
}

export type OccupancyForecast = {
  forecast: Forecast
  batchId: Id<'batches'>
  batchNumber: string | null
  openedOn: string
  speciesKey: string | null
  species: SpeciesInfo
}

/** Forecast of a batch in a unit as of a date, or null when it has no fish or weight then. */
export async function occupancyForecast(
  ctx: Ctx,
  unit: Doc<'cages'>,
  batchId: Id<'batches'>,
  asOf: string,
  opts: { horizonDays?: number; stats?: Doc<'batchStats'> | null } = {},
): Promise<OccupancyForecast | null> {
  const events = (await eventsForPair(ctx, unit._id, batchId)).filter((e) => e.eventDate <= asOf)
  if (!events.length) return null
  const flows = flowsOf(events)
  if (flows.count <= 0) return null
  const sorted = [...events].sort(compareEvents)
  const openedOn = sorted.find((e) => e.qtyDelta > 0)?.eventDate
  if (!openedOn) return null
  const initialAbwG = sorted.find((e) => e.qtyDelta > 0 && e.abwG && e.abwG > 0)?.abwG ?? null
  const deathsLast28 = flows.mortalityCount - flowsOf(events, addDays(asOf, -28)).mortalityCount

  const stats =
    opts.stats !== undefined
      ? opts.stats
      : await ctx.db
          .query('batchStats')
          .withIndex('by_unitId_and_batchId', (q) => q.eq('unitId', unit._id).eq('batchId', batchId))
          .unique()
  const efcr = stats ? (stats.asOf <= asOf ? stats.kpis.efcr : (snapAt(stats, asOf)?.efcr ?? null)) : null
  const batch = await ctx.db.get(batchId)
  const speciesKey = stats?.speciesCode ?? batch?.speciesCode ?? unit.species ?? null
  const species = await speciesInfo(ctx, unit.companyId, speciesKey)

  const from = openedOn > addDays(asOf, -DAILY_LOOKBACK_DAYS) ? openedOn : addDays(asOf, -DAILY_LOOKBACK_DAYS)
  const daily = (
    await ctx.db
      .query('unitDailyStats')
      .withIndex('by_unitId_and_date', (q) => q.eq('unitId', unit._id).gte('date', from).lte('date', asOf))
      .take(DAILY_LOOKBACK_DAYS * 2 + 10)
  ).filter((r) => !r.batchId || r.batchId === batchId)
  const temps = new Map<string, number>()
  const feed = new Map<string, number>()
  for (const r of daily) {
    if (r.temperatureC != null && Number.isFinite(r.temperatureC)) temps.set(r.date, r.temperatureC)
    feed.set(r.date, (feed.get(r.date) ?? 0) + (r.feedKg || 0))
  }
  // Sensor temperatures (PROD-014) fill the recent days nobody recorded by hand.
  const sensorFrom = Date.parse(`${addDays(asOf, -14)}T00:00:00Z`)
  const sensorTo = Date.parse(`${asOf}T00:00:00Z`) + DAY_MS
  const readings = await ctx.db
    .query('sensorReadings')
    .withIndex('by_cageId_and_parameter_and_measuredAt', (q) =>
      q.eq('cageId', unit._id).eq('parameter', 'temperature_c').gte('measuredAt', sensorFrom).lt('measuredAt', sensorTo),
    )
    .order('desc')
    .take(SENSOR_TAKE)
  const sensorDays = new Map<string, number[]>()
  for (const r of readings) {
    const d = new Date(r.measuredAt).toISOString().slice(0, 10)
    sensorDays.set(d, [...(sensorDays.get(d) ?? []), r.value])
  }
  for (const [d, xs] of sensorDays) {
    if (!temps.has(d)) temps.set(d, xs.reduce((s, x) => s + x, 0) / xs.length)
  }

  const forecast = forecastGrowth({
    asOf,
    openedOn,
    initialAbwG,
    samples: await samplesFor(ctx, unit._id, batchId),
    temps: [...temps].map(([date, value]) => ({ date, value })),
    feed: [...feed].map(([date, value]) => ({ date, value })),
    count: flows.count,
    deathsLast28,
    efcr,
    species: species.prior,
    horizonDays: opts.horizonDays,
  })
  if (!forecast) return null
  return { forecast, batchId, batchNumber: stats?.batchNumber ?? batch?.batchNumber ?? null, openedOn, speciesKey, species }
}

/**
 * Store the forecast error of a harvest: the forecast as it stood
 * FORECAST_CHECK_DAYS before the harvest date against the harvested ABW.
 * Replaces any earlier check of the record; writes nothing when there was no
 * forecast then (cycle too young, no weight on record, a sampling-page row).
 */
export async function recordForecastCheck(ctx: MutationCtx, harvestId: Id<'harvestRecords'>) {
  await deleteForecastChecks(ctx, harvestId)
  const h = await ctx.db.get(harvestId)
  if (!h || !h.batchId || !h.companyId || h.source === 'sampling_page' || !(h.averageBodyWeight > 0)) return null
  const unit = await ctx.db.get(h.cageId)
  if (!unit) return null
  const madeOn = addDays(h.harvestDate, -FORECAST_CHECK_DAYS)
  const f = await occupancyForecast(ctx, unit, h.batchId, madeOn, { horizonDays: FORECAST_CHECK_DAYS + 7 })
  if (!f) return null
  const p = bandOn(f.forecast, h.harvestDate)
  const err = p ? forecastError(p, h.averageBodyWeight) : null
  if (!p || !err) return null
  return await ctx.db.insert('harvestForecastChecks', {
    companyId: h.companyId,
    locationId: h.locationId,
    harvestRecordId: h._id,
    unitId: h.cageId,
    batchId: h.batchId,
    harvestDate: h.harvestDate,
    horizonDays: FORECAST_CHECK_DAYS,
    forecastMadeOn: madeOn,
    method: f.forecast.method,
    predictedLowG: p.low,
    predictedAbwG: p.expected,
    predictedHighG: p.high,
    actualAbwG: h.averageBodyWeight,
    ...err,
    createdAt: Date.now(),
  })
}

export async function deleteForecastChecks(ctx: MutationCtx, harvestId: Id<'harvestRecords'>) {
  const rows = await ctx.db
    .query('harvestForecastChecks')
    .withIndex('by_harvestRecordId', (q) => q.eq('harvestRecordId', harvestId))
    .take(10)
  for (const r of rows) await ctx.db.delete(r._id)
}
