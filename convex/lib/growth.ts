import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

/** Standard aquaculture growth formulas. Weights in grams, biomass in kg. */

export const biomassKg = (count: number, abwG: number) =>
  count > 0 && abwG > 0 ? (count * abwG) / 1000 : 0

/** Feed conversion ratio: kg feed per kg of fish gained. Null when there is no gain. */
export function fcr(feedKg: number, gainKg: number): number | null {
  if (!(feedKg > 0) || !(gainKg > 0)) return null
  return feedKg / gainKg
}

/** Specific growth rate, % body weight per day. */
export function sgr(abwStart: number, abwEnd: number, days: number): number | null {
  if (!(abwStart > 0) || !(abwEnd > 0) || !(days > 0)) return null
  return ((Math.log(abwEnd) - Math.log(abwStart)) / days) * 100
}

/** Average daily gain, grams per fish per day. */
export function adg(abwStart: number, abwEnd: number, days: number): number | null {
  if (!(abwStart > 0) || !(abwEnd > 0) || !(days > 0)) return null
  return (abwEnd - abwStart) / days
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(`${toIso}T12:00:00Z`).getTime() - new Date(`${fromIso}T12:00:00Z`).getTime()
  return Math.max(0, Math.round(ms / 86_400_000))
}

const round = (n: number | null, dp: number) =>
  n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp

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
