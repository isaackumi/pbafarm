import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

import { biomassKg, fcr, sgr, adg, daysBetween, round, occupancyKpis } from './kpi'
import { compareLedger, eventsForPair, eventsForUnit, openBatchInUnit, samplesFor } from './productionEngine'
import { feedFor } from './productionDualWrite'

/** Formulas live in ./kpi (one definition each, PROD-008); re-exported for older imports. */
export { biomassKg, fcr, sgr, adg, daysBetween }

type Ctx = QueryCtx | MutationCtx

/** The approved stocking whose cycle is still open (or the latest one). */
export async function currentStocking(ctx: Ctx, cageId: Id<'cages'>) {
  const rows = await ctx.db
    .query('stockingHistory')
    .withIndex('by_cage', (q) => q.eq('cageId', cageId))
    .collect()
  const approved = rows
    .filter((s) => s.status === 'approved' && !s.deletedAt)
    .sort((a, b) => b.stockingDate.localeCompare(a.stockingDate))
  return approved.find((s) => !s.closedAt) ?? approved[0] ?? null
}

/**
 * Growth for the cage's current production cycle (since its open stocking):
 * latest ABW from bi-weekly sampling, biomass, feed used, eFCR, SGR, ADG.
 */
export async function cageCycleGrowth(
  ctx: Ctx,
  cage: Doc<'cages'>,
  asOf: string = new Date().toISOString().split('T')[0],
) {
  const stocking = await currentStocking(ctx, cage._id)
  const startDate = stocking?.stockingDate ?? cage.stockingDate ?? null
  const endDate = stocking?.closedAt ?? asOf
  const initialAbw = stocking?.initialAbw ?? cage.initialAbw ?? 0
  const stockedCount = stocking?.fishCount ?? cage.initialCount ?? 0
  const initialBiomass =
    stocking?.initialBiomass && stocking.initialBiomass > 0
      ? stocking.initialBiomass
      : biomassKg(stockedCount, initialAbw)

  const samples = startDate
    ? await ctx.db
        .query('biweeklyRecords')
        .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
        .collect()
    : []
  const inCycle = samples
    .filter((s) => s.date >= startDate! && s.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  const latest = inCycle[inCycle.length - 1] ?? null
  // Without a sample in this cycle the fish are still at their stocking
  // weight. cages.currentWeight may hold the previous cycle's last sample
  // (doc 09 S7), so it is only used for cages with no cycle start at all.
  const currentAbw =
    latest?.averageBodyWeight ??
    (startDate ? initialAbw : (cage.currentWeight ?? initialAbw))
  const abwDate = latest?.date ?? startDate

  const daily = startDate
    ? await ctx.db
        .query('dailyRecords')
        .withIndex('by_cage_date', (q) =>
          q.eq('cageId', cage._id).gte('date', startDate).lte('date', endDate),
        )
        .collect()
    : []
  const feedKg = daily.reduce((s, r) => s + (r.feedAmount || 0), 0)
  const feedCost = daily.reduce((s, r) => s + (r.feedCost || 0), 0)
  const mortality = daily.reduce((s, r) => s + (r.mortality || 0), 0)

  const liveCount = cage.currentCount ?? Math.max(0, stockedCount - mortality)
  const currentBiomass = biomassKg(liveCount, currentAbw)
  const gainKg = currentBiomass - initialBiomass
  const growthDays = startDate && abwDate ? daysBetween(startDate, abwDate) : 0

  return {
    stocking_id: stocking?._id ?? null,
    batch_number: stocking?.batchNumber ?? null,
    stocking_date: startDate,
    cycle_closed: Boolean(stocking?.closedAt),
    days_of_culture: startDate ? daysBetween(startDate, endDate) : null,
    stocked_count: stockedCount,
    live_count: liveCount,
    mortality,
    survival_pct: stockedCount > 0 ? round((liveCount / stockedCount) * 100, 1) : null,
    initial_abw_g: round(initialAbw, 1),
    current_abw_g: round(currentAbw, 1),
    abw_measured_on: latest?.date ?? null,
    initial_biomass_kg: round(initialBiomass, 1),
    current_biomass_kg: round(currentBiomass, 1),
    feed_kg: round(feedKg, 1),
    feed_cost: round(feedCost, 2),
    efcr: round(fcr(feedKg, gainKg), 2),
    sgr_pct_day: round(sgr(initialAbw, currentAbw, growthDays), 2),
    adg_g_day: round(adg(initialAbw, currentAbw, growthDays), 2),
  }
}

/**
 * FCR for a harvest: feed used in the cycle divided by fish weight produced
 * (harvested weight minus what was stocked).
 */
export async function harvestFcr(
  ctx: Ctx,
  cage: Doc<'cages'>,
  harvestDate: string,
  harvestedKg: number,
) {
  const g = await cageCycleGrowth(ctx, cage, harvestDate)
  const feedKg = g.feed_kg ?? 0
  const gain = harvestedKg - (g.initial_biomass_kg ?? 0)
  return {
    fcr: round(fcr(feedKg, gain), 2),
    feed_kg: feedKg,
    stocked_biomass_kg: g.initial_biomass_kg,
    stocking_date: g.stocking_date,
  }
}

/**
 * Point the cage's current weight at its latest bi-weekly ABW in the current
 * cycle, or at the stocking ABW when the cycle has no sample yet. Samples from
 * an earlier cycle never set the weight of fish stocked after them.
 */
export async function syncCageAbw(ctx: MutationCtx, cageId: Id<'cages'>) {
  const cage = await ctx.db.get(cageId)
  if (!cage) return
  const rows = await ctx.db
    .query('biweeklyRecords')
    .withIndex('by_cage', (q) => q.eq('cageId', cageId))
    .collect()
  const start = cage.stockingDate
  const latest = rows
    .filter((r) => !start || r.date >= start)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  const next = latest?.averageBodyWeight ?? (start ? cage.initialAbw : undefined)
  if (next !== cage.currentWeight) {
    await ctx.db.patch(cageId, { currentWeight: next, updatedAt: Date.now() })
  }
}

/**
 * Growth for a cage's current (or last) occupancy from the stock ledger,
 * with the KPI definitions of ./kpi (PROD-008): flows in and out of the cage
 * count, so transfers, top-ups and partial harvests no longer distort eFCR
 * or survival. Falls back to `cageCycleGrowth` until the cage's ledger is in
 * step with its count (before the backfill). Same keys as `cageCycleGrowth`,
 * plus `source` and `definitions_version`.
 */
export async function cageGrowth(ctx: Ctx, cage: Doc<'cages'>, asOf?: string) {
  const legacy = await cageCycleGrowth(ctx, cage, asOf)
  const date = asOf ?? new Date().toISOString().slice(0, 10)
  const unitEvents = await eventsForUnit(ctx, cage._id, date)
  const inStep =
    unitEvents.length > 0 &&
    unitEvents.reduce((s, e) => s + e.qtyDelta, 0) === (cage.currentCount ?? 0)
  const fallback = { ...legacy, batch_id: null, source: 'legacy' as const, definitions_version: 2 }
  if (!inStep) return fallback
  const sorted = [...unitEvents].sort(compareLedger)
  const lastEvent = sorted[sorted.length - 1]
  const batchId = (await openBatchInUnit(ctx, cage._id, date)) ?? lastEvent?.batchId ?? null
  const batch = batchId ? await ctx.db.get(batchId) : null
  if (!batch) return fallback

  const events = (await eventsForPair(ctx, cage._id, batch._id)).filter((e) => e.eventDate <= date)
  const openedOn = events.find((e) => e.qtyDelta > 0)?.eventDate ?? batch.openedOn
  const total = events.reduce((s, e) => s + e.qtyDelta, 0)
  const end =
    total <= 0 && events.length
      ? events.reduce((m, e) => (e.eventDate > m ? e.eventDate : m), openedOn)
      : date
  const feed = await feedFor(ctx, cage._id, batch._id, openedOn, end)
  const k = occupancyKpis({
    events,
    samples: await samplesFor(ctx, cage._id, batch._id),
    feedKg: feed.kg,
    feedCost: feed.cost,
    asOf: date,
  })
  return {
    stocking_id: legacy.stocking_id,
    batch_id: batch._id,
    batch_number: batch.batchNumber,
    stocking_date: k.opened_on,
    cycle_closed: k.closed_on != null,
    days_of_culture: k.days_of_culture,
    stocked_count: k.stocked_count + k.in_count,
    live_count: k.count,
    mortality: k.mortality,
    survival_pct: k.survival_pct,
    mortality_pct: k.mortality_pct,
    harvested_count: k.harvested_count,
    harvested_kg: k.harvested_kg,
    unaccounted: k.unaccounted,
    initial_abw_g: k.initial_abw_g,
    current_abw_g: k.current_abw_g,
    abw_measured_on: k.abw_measured_on,
    initial_biomass_kg: k.stocked_biomass_kg,
    current_biomass_kg: k.current_biomass_kg,
    gain_kg: k.gain_kg,
    feed_kg: k.feed_kg,
    feed_cost: k.feed_cost,
    efcr: k.efcr,
    biological_fcr: k.biological_fcr,
    sgr_pct_day: k.sgr_pct_day,
    adg_g_day: k.adg_g_day,
    source: 'ledger' as const,
    definitions_version: 2,
  }
}
