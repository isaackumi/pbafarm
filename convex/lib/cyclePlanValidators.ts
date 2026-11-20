/**
 * Cycle planner validators (lib/cyclePlan), in their own module so the
 * schema and the Ask Anowa draft payloads (convex/bot/tables.ts) share them
 * without an import cycle.
 */
import { v } from 'convex/values'

/** Cycle planner inputs (lib/cyclePlan PlanInputs, without the unit count). */
export const cyclePlanInputs = v.object({
  stockOn: v.string(),
  fishPerUnit: v.number(),
  stockAbwG: v.number(),
  harvestAbwG: v.number(),
  feedPricePerBag: v.number(),
  bagKg: v.number(),
  salePricePerKg: v.number(),
  fingerlingPrice: v.number(),
})
const planSource = v.union(v.literal('history'), v.literal('default'), v.literal('edited'))
/** Cycle planner assumptions as saved (lib/cyclePlan PlanAssumptions + where each came from). */
export const cyclePlanAssumptions = v.object({
  speciesKey: v.union(v.string(), v.null()),
  survivalPct: v.number(),
  fcr: v.number(),
  tgc: v.number(),
  tempC: v.number(),
  /** 12 entries, Jan..Dec. */
  monthlyTempC: v.union(v.array(v.union(v.number(), v.null())), v.null()),
  sources: v.object({ survival: planSource, fcr: planSource, growth: planSource }),
  /** Closed cycles the history figures came from. */
  cycles: v.number(),
})
