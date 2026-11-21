/**
 * The cage card under the scanner (Paper 54 Mobile, Scan & QR): what a
 * keeper needs at the cage after scanning its label. One cage, read through
 * indexes only: its batch, fish and average weight, whether it was fed today,
 * and its latest dissolved oxygen against the farm's low-DO threshold.
 */
import { v } from 'convex/values'
import { query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { requireMember } from './lib/permissions'
import { listForCompany } from './lib/tenancy'
import { isBusinessDate } from './lib/dates'
import { userError } from './lib/errors'
import { unitTypeOf } from './lib/farmRules'
import { DEFAULT_THRESHOLDS, effectiveThresholds } from './lib/waterQuality'
import { overridesFor } from './waterQuality'

/** Logged readings looked through for the newest one that has DO. */
const DO_LOOKBACK = 20

async function batchNumberOf(ctx: QueryCtx, cage: Doc<'cages'>): Promise<string | null> {
  if (cage.currentBatchId) {
    const batch = await ctx.db.get(cage.currentBatchId)
    if (batch && batch.companyId === cage.companyId) return batch.batchNumber
  }
  // Legacy cycles: the newest open, approved stocking of this cage.
  const stockings = await ctx.db
    .query('stockingHistory')
    .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
    .order('desc')
    .take(10)
  const open = stockings.find((s) => s.status === 'approved' && !s.closedAt && !s.deletedAt)
  return open?.batchNumber ?? null
}

async function latestDo(ctx: QueryCtx, cage: Doc<'cages'>): Promise<{ value: number; at: number } | null> {
  const logged = await ctx.db
    .query('waterQualityReadings')
    .withIndex('by_unitId_and_measuredAt', (q) => q.eq('unitId', cage._id))
    .order('desc')
    .take(DO_LOOKBACK)
  const reading = logged.find((r) => r.dissolvedOxygen != null && Number.isFinite(r.dissolvedOxygen))
  const sensor = await ctx.db
    .query('sensorReadings')
    .withIndex('by_cageId_and_parameter_and_measuredAt', (q) =>
      q.eq('cageId', cage._id).eq('parameter', 'dissolved_oxygen'),
    )
    .order('desc')
    .first()
  const fromLog = reading ? { value: reading.dissolvedOxygen as number, at: reading.measuredAt } : null
  const fromSensor = sensor && Number.isFinite(sensor.value) ? { value: sensor.value, at: sensor.measuredAt } : null
  if (fromLog && fromSensor) return fromSensor.at > fromLog.at ? fromSensor : fromLog
  return fromLog ?? fromSensor
}

export const cageCard = query({
  args: {
    id: v.id('cages'),
    /** The phone's today (YYYY-MM-DD): "fed today" is a daily record on this date. */
    today: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id('cages'),
      name: v.string(),
      code: v.union(v.string(), v.null()),
      batchNumber: v.union(v.string(), v.null()),
      fish: v.union(v.number(), v.null()),
      abwG: v.union(v.number(), v.null()),
      /** Today's daily record: when it was saved and what it holds. */
      logged: v.union(
        v.null(),
        v.object({ at: v.number(), feedKg: v.number(), mortality: v.number() }),
      ),
      dissolvedOxygen: v.union(
        v.null(),
        v.object({
          value: v.number(),
          at: v.number(),
          /** The farm's low-DO alert floor for this unit type (mg/L), when one is set. */
          min: v.union(v.number(), v.null()),
          low: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { id, today }) => {
    if (!isBusinessDate(today)) throw userError('VALIDATION', 'today must be YYYY-MM-DD')
    const m = await requireMember(ctx, { permission: 'production.view' })
    const cage = await ctx.db.get(id)
    if (!cage || cage.archivedAt) return null
    // Same company and a site in the member's scope, or it does not exist.
    const [allowed] = await listForCompany(m.user, [cage])
    if (!allowed) return null
    if (m.siteScope !== 'all' && cage.locationId && !m.siteScope.has(cage.locationId)) return null

    const record = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) => q.eq('cageId', cage._id).eq('date', today))
      .first()
    const reading = await latestDo(ctx, cage)
    let dissolvedOxygen = null
    if (reading) {
      const thresholds = cage.companyId
        ? effectiveThresholds(unitTypeOf(cage), await overridesFor(ctx, cage.companyId))
        : DEFAULT_THRESHOLDS[unitTypeOf(cage)]
      const min = thresholds.dissolvedOxygen?.min ?? null
      dissolvedOxygen = { ...reading, min, low: min != null && reading.value < min }
    }

    return {
      id: cage._id,
      name: cage.name,
      code: cage.code ?? null,
      batchNumber: await batchNumberOf(ctx, cage),
      fish: cage.currentCount ?? null,
      abwG: cage.currentWeight ?? null,
      logged: record
        ? { at: record._creationTime, feedKg: record.feedAmount, mortality: record.mortality }
        : null,
      dissolvedOxygen,
    }
  },
})
