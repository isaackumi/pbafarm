import { v } from 'convex/values'

/**
 * Validators of the rollup tables (PLAT-002, D-006). Kept apart from
 * schema.ts so the rollup code and its tests share one shape.
 */

const num = v.number()
const numOrNull = v.union(v.number(), v.null())

/** One day's fish flows of one occupancy, folded with kpi.addToFlows. */
export const dayFlows = v.object({
  /** Net change of the fish count that day. */
  count: num,
  stockedCount: num,
  stockedKg: num,
  inCount: num,
  inKg: num,
  outCount: num,
  outKg: num,
  mortalityCount: num,
  mortalityKgEst: num,
  harvestedCount: num,
  harvestedKg: num,
  adjustmentCount: num,
  unaccountedCount: num,
})

/**
 * One unit (cage, pond, tank) on one business date, per batch in it. Facts of
 * that day only, never running totals, so a back-dated entry rewrites one row
 * and nothing after it. Maintained in the same mutation as the daily record,
 * sample or stock event it summarizes.
 */
export const unitDailyStatsFields = {
  companyId: v.id('companies'),
  locationId: v.optional(v.id('farmLocations')),
  unitId: v.id('cages'),
  /** Batch in the unit that day; unset when nothing is on record. */
  batchId: v.optional(v.id('batches')),
  date: v.string(),
  feedKg: num,
  /** Feed at the list price stored on the daily records. */
  feedCostList: num,
  /** Feed by type, for pricing at purchase prices (lib/costing). One per daily record. */
  feed: v.array(
    v.object({ feedTypeId: v.optional(v.id('feedTypes')), kg: num, listCost: num }),
  ),
  /** Deaths written on the daily records (the ledger's count is in `flows`). */
  mortalityRecorded: num,
  flows: dayFlows,
  /** Latest sample's ABW that day (g). */
  sampleAbwG: v.optional(num),
  dissolvedOxygen: v.optional(num),
  temperatureC: v.optional(num),
  updatedAt: num,
}

/** Every KPI of an occupancy (kpi.OccupancyKpis), stored as computed. */
export const occupancyKpisValidator = v.object({
  opened_on: v.union(v.string(), v.null()),
  closed_on: v.union(v.string(), v.null()),
  days_of_culture: numOrNull,
  count: num,
  stocked_count: num,
  in_count: num,
  out_count: num,
  harvested_count: num,
  harvested_kg: num,
  mortality: num,
  unaccounted: num,
  initial_abw_g: numOrNull,
  current_abw_g: numOrNull,
  abw_measured_on: v.union(v.string(), v.null()),
  stocked_biomass_kg: num,
  current_biomass_kg: num,
  gain_kg: num,
  feed_kg: num,
  feed_cost: num,
  efcr: numOrNull,
  biological_fcr: numOrNull,
  survival_pct: numOrNull,
  mortality_pct: numOrNull,
  sgr_pct_day: numOrNull,
  adg_g_day: numOrNull,
})

/**
 * Cumulative state of an occupancy at the end of a date (each Sunday, and
 * the as-of date). Differences of two snapshots give a period's figures.
 */
export const snapshotValidator = v.object({
  date: v.string(),
  count: num,
  abwG: numOrNull,
  biomassKg: num,
  feedKg: num,
  /** At purchase prices (lib/costing). */
  feedCost: num,
  gainKg: num,
  stockedCount: num,
  inCount: num,
  outCount: num,
  harvestedCount: num,
  harvestedKg: num,
  mortality: num,
  efcr: numOrNull,
  sgr: numOrNull,
  survivalPct: numOrNull,
})

/**
 * One occupancy (a batch in a unit): KPIs as of `asOf` and weekly snapshots.
 * Recomputed from the ledger by the rollup job when a write marks it dirty,
 * so dashboards read one row per occupancy.
 */
export const batchStatsFields = {
  companyId: v.id('companies'),
  locationId: v.optional(v.id('farmLocations')),
  unitId: v.id('cages'),
  batchId: v.id('batches'),
  batchNumber: v.string(),
  speciesCode: v.optional(v.string()),
  open: v.boolean(),
  /** closedOn, or '9999-12-31' while open: index for "active in a period". */
  lastDate: v.string(),
  asOf: v.string(),
  kpis: occupancyKpisValidator,
  /** Feed at purchase prices (lib/costing), as-of. */
  feedCostLedger: num,
  /** SGR between the last two samples, % per day. */
  recentSgr: numOrNull,
  recentSampleDate: v.union(v.string(), v.null()),
  /** Deaths in the 28 days to `asOf` (forecast input). */
  recentMortality: num,
  /** Oldest first; bounded (MAX_SNAPSHOTS). */
  weekly: v.array(snapshotValidator),
  updatedAt: num,
}
