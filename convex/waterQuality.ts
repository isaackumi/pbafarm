/**
 * Water quality and pond water management (Phase 6: POND-002, RAS-001,
 * PROD-014 context; roadmap M15).
 *
 * - `waterQualityReadings`: manual log entries plus mirrors of the DO,
 *   temperature and Secchi captured on daily and bi-weekly records. Sensor
 *   readings stay in `sensorReadings` and are merged when a unit's log is read.
 * - Thresholds: defaults per unit type (convex/lib/waterQuality.ts) with
 *   organization overrides in `waterQualityThresholds`. A reading outside
 *   them emits `water.threshold.breached` for automation (Phase 10).
 * - `waterManagementLogs`: fill, drain, exchange, liming, fertilization,
 *   treatment and aeration events per unit; products can be issued from
 *   non-feed inventory.
 */
import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { assertLocationAccess, assertOwns, logAudit } from './lib/tenancy'
import { emitDomainEvent } from './lib/events'
import { idempotentMutation } from './lib/idempotency'
import { todayFor, isBusinessDate } from './lib/dates'
import { unitTypeOf, type UnitType } from './lib/farmRules'
import { unitTypeValidator } from './schema'
import { issueItem } from './inventoryItems'
import {
  breachSummary,
  checkValues,
  DEFAULT_THRESHOLDS,
  effectiveThresholds,
  evaluateBreaches,
  SENSOR_TO_FIELD,
  WQ_KEYS,
  WQ_PARAMETERS,
  type Breach,
  type ThresholdOverride,
  type WqParameter,
  type WqValues,
} from './lib/waterQuality'
import { assertUserCan, requireMember } from './lib/permissions'

const valueFields = {
  dissolvedOxygen: v.optional(v.number()),
  temperatureC: v.optional(v.number()),
  ph: v.optional(v.number()),
  ammonia: v.optional(v.number()),
  nitrite: v.optional(v.number()),
  nitrate: v.optional(v.number()),
  salinity: v.optional(v.number()),
  turbidityNtu: v.optional(v.number()),
  secchiCm: v.optional(v.number()),
  alkalinity: v.optional(v.number()),
  co2: v.optional(v.number()),
}

type Ctx = QueryCtx | MutationCtx

async function overridesFor(ctx: Ctx, companyId: Id<'companies'>): Promise<ThresholdOverride[]> {
  const rows = await ctx.db
    .query('waterQualityThresholds')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .take(300)
  return rows.map((r) => ({ unitType: r.unitType, parameter: r.parameter, min: r.min, max: r.max }))
}

/** A unit the caller may read or write: same company, assigned site. */
async function loadUnit(ctx: Ctx, user: Doc<'users'>, unitId: Id<'cages'>) {
  const unit = await ctx.db.get(unitId)
  assertOwns(user, unit, 'Unit')
  assertLocationAccess(user, unit.locationId)
  return unit
}

function pickValues(row: Partial<Record<WqParameter, number | undefined>>): Partial<Record<WqParameter, number>> {
  const out: Partial<Record<WqParameter, number>> = {}
  for (const k of WQ_KEYS) if (row[k] != null) out[k] = row[k] as number
  return out
}

/** Emit the reading event, and the breach event when any parameter is out of range. */
async function emitReadingEvents(
  ctx: MutationCtx,
  unit: Doc<'cages'>,
  reading: { id: string; date: string; measuredAt: number; source: string; values: WqValues },
  breaches: Breach[],
) {
  if (!unit.companyId) return
  const base = {
    readingId: reading.id,
    unitId: unit._id,
    unitName: unit.name,
    cageName: unit.name,
    unitType: unitTypeOf(unit),
    date: reading.date,
    source: reading.source,
    ...pickValues(reading.values as any),
  }
  await emitDomainEvent(ctx, 'water.reading.recorded', { ...base, breachCount: breaches.length }, {
    companyId: unit.companyId,
    locationId: unit.locationId,
  })
  if (breaches.length) {
    await emitDomainEvent(
      ctx,
      'water.threshold.breached',
      {
        ...base,
        breachCount: breaches.length,
        parameters: breaches.map((b) => b.parameter).join(', '),
        summary: breachSummary(breaches),
        lowOxygen: breaches.some((b) => b.parameter === 'dissolvedOxygen' && b.direction === 'low'),
      },
      { companyId: unit.companyId, locationId: unit.locationId },
    )
  }
}

/**
 * Insert one reading for a unit and evaluate it. Shared by the manual log,
 * the daily/bi-weekly mirror and the backfill (which passes `quiet`).
 */
export async function insertReading(
  ctx: MutationCtx,
  unit: Doc<'cages'>,
  args: {
    values: Partial<Record<WqParameter, number>>
    measuredAt: number
    date: string
    source: Doc<'waterQualityReadings'>['source']
    sourceId?: string
    sampleDepthM?: number
    notes?: string
    createdBy?: Id<'users'>
    quiet?: boolean
  },
): Promise<{ id: Id<'waterQualityReadings'>; breaches: Breach[] }> {
  if (!unit.companyId) throw new Error('Unit has no company')
  const thresholds = effectiveThresholds(unitTypeOf(unit), await overridesFor(ctx, unit.companyId))
  const breaches = evaluateBreaches(args.values, thresholds)
  const id = await ctx.db.insert('waterQualityReadings', {
    companyId: unit.companyId,
    locationId: unit.locationId,
    unitId: unit._id,
    measuredAt: args.measuredAt,
    date: args.date,
    ...args.values,
    sampleDepthM: args.sampleDepthM,
    source: args.source,
    sourceId: args.sourceId,
    breachCount: breaches.length,
    notes: args.notes?.trim() || undefined,
    createdBy: args.createdBy,
  })
  if (!args.quiet) {
    await emitReadingEvents(
      ctx,
      unit,
      { id, date: args.date, measuredAt: args.measuredAt, source: args.source, values: args.values },
      breaches,
    )
  }
  return { id, breaches }
}

/** Noon UTC of a business date: a stable time for once-a-day records. */
function middayOf(date: string) {
  return Date.parse(`${date}T12:00:00Z`)
}

/**
 * Keep the mirror of a daily or bi-weekly record's water fields in step
 * (dual-write, roadmap Phase 6). Called after the record is created,
 * edited or deleted; a record with no water values has no mirror.
 */
export async function mirrorRecordReading(
  ctx: MutationCtx,
  source: 'daily_record' | 'biweekly_record',
  recordId: Id<'dailyRecords'> | Id<'biweeklyRecords'>,
  record: Pick<Doc<'dailyRecords'>, 'cageId' | 'date' | 'dissolvedOxygen' | 'temperatureC' | 'secchiCm' | 'createdBy'> | null,
  opts: { quiet?: boolean } = {},
) {
  const existing = await ctx.db
    .query('waterQualityReadings')
    .withIndex('by_sourceId', (q) => q.eq('sourceId', recordId))
    .first()
  const values: Partial<Record<WqParameter, number>> = {}
  if (record?.dissolvedOxygen != null) values.dissolvedOxygen = record.dissolvedOxygen
  if (record?.temperatureC != null) values.temperatureC = record.temperatureC
  if (record?.secchiCm != null) values.secchiCm = record.secchiCm
  const empty = !record || Object.keys(values).length === 0
  if (empty) {
    if (existing) await ctx.db.delete(existing._id)
    return null
  }
  const unit = await ctx.db.get(record.cageId)
  if (!unit?.companyId) return null
  if (existing) {
    const thresholds = effectiveThresholds(unitTypeOf(unit), await overridesFor(ctx, unit.companyId))
    await ctx.db.patch(existing._id, {
      unitId: unit._id,
      locationId: unit.locationId,
      date: record.date,
      measuredAt: middayOf(record.date),
      dissolvedOxygen: values.dissolvedOxygen,
      temperatureC: values.temperatureC,
      secchiCm: values.secchiCm,
      breachCount: evaluateBreaches(values, thresholds).length,
    })
    return existing._id
  }
  const { id } = await insertReading(ctx, unit, {
    values,
    date: record.date,
    measuredAt: middayOf(record.date),
    source,
    sourceId: recordId,
    createdBy: record.createdBy,
    quiet: opts.quiet,
  })
  return id
}

/**
 * Evaluate a batch of sensor readings against thresholds (INT-007 hook):
 * one breach event per unit, using the worst value of each parameter.
 */
export async function evaluateSensorReadings(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  readings: { cageId?: Id<'cages'>; parameter: string; value: number; measuredAt: number }[],
) {
  const byUnit = new Map<Id<'cages'>, { values: WqValues; measuredAt: number }>()
  for (const r of readings) {
    const field = SENSOR_TO_FIELD[r.parameter]
    if (!r.cageId || !field) continue
    const entry = byUnit.get(r.cageId) ?? { values: {}, measuredAt: 0 }
    entry.values[field] = r.value
    entry.measuredAt = Math.max(entry.measuredAt, r.measuredAt)
    byUnit.set(r.cageId, entry)
  }
  if (!byUnit.size) return 0
  const overrides = await overridesFor(ctx, companyId)
  let events = 0
  for (const [unitId, entry] of byUnit) {
    const unit = await ctx.db.get(unitId)
    if (!unit || unit.companyId !== companyId) continue
    const breaches = evaluateBreaches(entry.values, effectiveThresholds(unitTypeOf(unit), overrides))
    if (!breaches.length) continue
    const date = await todayFor(ctx, { locationId: unit.locationId, companyId }, entry.measuredAt)
    await emitDomainEvent(
      ctx,
      'water.threshold.breached',
      {
        unitId: unit._id,
        unitName: unit.name,
        cageName: unit.name,
        unitType: unitTypeOf(unit),
        date,
        source: 'sensor',
        ...pickValues(entry.values as any),
        breachCount: breaches.length,
        parameters: breaches.map((b) => b.parameter).join(', '),
        summary: breachSummary(breaches),
        lowOxygen: breaches.some((b) => b.parameter === 'dissolvedOxygen' && b.direction === 'low'),
      },
      { companyId, locationId: unit.locationId },
    )
    events += 1
  }
  return events
}

// ── Readings ─────────────────────────────────────────────────────────────

/** Log a water-quality reading for a unit (any member at the unit's site). */
export const record = idempotentMutation('waterQuality.record', {
  args: {
    unitId: v.id('cages'),
    /** Epoch ms; defaults to now. */
    measuredAt: v.optional(v.number()),
    sampleDepthM: v.optional(v.number()),
    notes: v.optional(v.string()),
    ...valueFields,
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.daily.record' })
    const unit = await loadUnit(ctx, user, args.unitId)
    if (unit.archivedAt) throw new Error('This unit is archived')
    const now = Date.now()
    const measuredAt = args.measuredAt ?? now
    if (measuredAt > now + 5 * 60 * 1000) throw new Error('The reading time is in the future')
    if (args.sampleDepthM !== undefined && !(args.sampleDepthM >= 0 && args.sampleDepthM <= 100)) {
      throw new Error('Sample depth must be between 0 and 100 m')
    }
    const values = checkValues(args)
    const date = await todayFor(ctx, { locationId: unit.locationId, companyId: unit.companyId }, measuredAt)
    const { id, breaches } = await insertReading(ctx, unit, {
      values,
      measuredAt,
      date,
      source: 'manual',
      sampleDepthM: args.sampleDepthM,
      notes: args.notes,
      createdBy: user._id,
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'waterQualityReadings',
      recordId: id,
      newValues: { unitId: unit._id, ...values },
      locationId: unit.locationId,
    })
    return { id, breaches: breaches.map((b) => ({ parameter: b.parameter, label: b.label, value: b.value, direction: b.direction, limit: b.limit })) }
  },
})

/** Delete a manual reading (its author or an admin). Mirrors follow their record. */
export const remove = mutation({
  args: { id: v.id('waterQualityReadings') },
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.daily.record' })
    const row = await ctx.db.get(id)
    assertOwns(user, row, 'Reading')
    if (row.source !== 'manual') throw new Error('Edit the daily or bi-weekly record this reading came from')
    if (row.createdBy !== user._id) await assertUserCan(ctx, user, 'production.records.delete')
    await ctx.db.delete(id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'waterQualityReadings',
      recordId: id,
      previousValues: row,
      locationId: row.locationId,
    })
  },
})

type LogRow = {
  id: string
  measuredAt: number
  date: string | null
  source: 'manual' | 'sensor' | 'daily_record' | 'biweekly_record'
  values: Partial<Record<WqParameter, number>>
  breaches: { parameter: WqParameter; direction: 'low' | 'high'; limit: number }[]
  notes?: string
  sampleDepthM?: number
  deviceId?: string
}

/**
 * A unit's water-quality log since `since` (epoch ms), newest first: logged
 * and mirrored readings plus sensor readings (grouped per device and
 * minute), with breaches against the unit's thresholds. Pass `since` from
 * the client (no clock reads in queries).
 */
export const listForUnit = query({
  args: {
    unitId: v.id('cages'),
    since: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const unit = await ctx.db.get(args.unitId)
    if (!unit || ((user.role ?? 'user') !== 'super_admin' && unit.companyId !== user.companyId)) return null
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500)
    const thresholds = unit.companyId
      ? effectiveThresholds(unitTypeOf(unit), await overridesFor(ctx, unit.companyId))
      : DEFAULT_THRESHOLDS[unitTypeOf(unit)]
    const logged = await ctx.db
      .query('waterQualityReadings')
      .withIndex('by_unitId_and_measuredAt', (q) => q.eq('unitId', unit._id).gte('measuredAt', args.since))
      .order('desc')
      .take(limit)
    const rows: LogRow[] = logged.map((r) => ({
      id: r._id,
      measuredAt: r.measuredAt,
      date: r.date,
      source: r.source,
      values: pickValues(r as any),
      breaches: [],
      notes: r.notes,
      sampleDepthM: r.sampleDepthM,
    }))
    // Sensors: one row per device and minute.
    const sensorRows = new Map<string, LogRow>()
    for (const parameter of Object.keys(SENSOR_TO_FIELD)) {
      const field = SENSOR_TO_FIELD[parameter]
      const readings = await ctx.db
        .query('sensorReadings')
        .withIndex('by_cageId_and_parameter_and_measuredAt', (q) =>
          q.eq('cageId', unit._id).eq('parameter', parameter).gte('measuredAt', args.since),
        )
        .order('desc')
        .take(limit)
      for (const s of readings) {
        const minute = Math.floor(s.measuredAt / 60000) * 60000
        const key = `${s.deviceId}:${minute}`
        const row = sensorRows.get(key) ?? {
          id: key,
          measuredAt: minute,
          date: null,
          source: 'sensor' as const,
          values: {},
          breaches: [],
          deviceId: s.deviceId,
        }
        row.values[field] = s.value
        sensorRows.set(key, row)
      }
    }
    const all = [...rows, ...sensorRows.values()]
      .sort((a, b) => b.measuredAt - a.measuredAt)
      .slice(0, limit)
    for (const r of all) {
      r.breaches = evaluateBreaches(r.values, thresholds).map((b) => ({
        parameter: b.parameter,
        direction: b.direction,
        limit: b.limit,
      }))
    }
    return {
      unitType: unitTypeOf(unit),
      thresholds,
      parameters: WQ_PARAMETERS,
      rows: all,
    }
  },
})

/**
 * Latest logged reading per unit (newest 500 readings of the company), with
 * its breach count: for the unit board and the water-quality overview.
 */
export const latestByUnit = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  handler: async (ctx, { locationId }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    if (!user.companyId) return []
    const companyId = user.companyId
    const rows = await ctx.db
      .query('waterQualityReadings')
      .withIndex('by_companyId_and_measuredAt', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(500)
    const seen = new Set<string>()
    const out = []
    for (const r of rows) {
      if (locationId && r.locationId !== locationId) continue
      if (seen.has(r.unitId)) continue
      seen.add(r.unitId)
      out.push({
        unitId: r.unitId,
        measuredAt: r.measuredAt,
        date: r.date,
        source: r.source,
        values: pickValues(r as any),
        breachCount: r.breachCount ?? 0,
      })
    }
    return out
  },
})

// ── Thresholds ───────────────────────────────────────────────────────────

const UNIT_TYPES: UnitType[] = ['cage', 'pond', 'tank', 'raceway', 'hatchery_tank', 'incubator', 'hapa']

/** Effective thresholds for every unit type, and the organization's overrides. */
export const thresholds = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const overrides = user.companyId ? await overridesFor(ctx, user.companyId) : []
    return {
      parameters: WQ_PARAMETERS,
      overrides,
      byUnitType: Object.fromEntries(UNIT_TYPES.map((t) => [t, effectiveThresholds(t, overrides)])),
    }
  },
})

/**
 * Set (or with `reset`, remove) an organization threshold for a parameter
 * and unit type ('all' for every type). Neither min nor max turns that
 * parameter's alert off. Admin only.
 */
export const setThreshold = mutation({
  args: {
    unitType: v.union(unitTypeValidator, v.literal('all')),
    parameter: v.string(),
    min: v.optional(v.number()),
    max: v.optional(v.number()),
    reset: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.settings.manage' })
    const companyId = user.companyId
    if (!companyId) throw new Error('No company')
    if (!(args.parameter in WQ_PARAMETERS)) throw new Error('Unknown parameter')
    if (args.min != null && args.max != null && args.min > args.max) throw new Error('Minimum cannot exceed maximum')
    const spec = WQ_PARAMETERS[args.parameter as WqParameter]
    for (const n of [args.min, args.max]) {
      if (n != null && (!Number.isFinite(n) || n < spec.min || n > spec.max)) {
        throw new Error(`${spec.label} limits must be between ${spec.min} and ${spec.max}`)
      }
    }
    const existing = (
      await ctx.db
        .query('waterQualityThresholds')
        .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
        .take(300)
    ).find((r) => r.unitType === args.unitType && r.parameter === args.parameter)
    if (args.reset) {
      if (existing) await ctx.db.delete(existing._id)
    } else if (existing) {
      await ctx.db.patch(existing._id, { min: args.min, max: args.max, updatedBy: user._id, updatedAt: Date.now() })
    } else {
      await ctx.db.insert('waterQualityThresholds', {
        companyId,
        unitType: args.unitType,
        parameter: args.parameter,
        min: args.min,
        max: args.max,
        updatedBy: user._id,
        updatedAt: Date.now(),
      })
    }
    await logAudit(ctx, {
      actionType: args.reset ? 'delete' : 'update',
      tableName: 'waterQualityThresholds',
      previousValues: existing,
      newValues: args,
    })
    return null
  },
})

// ── Pond water management and treatments (POND-002) ──────────────────────

const waterEventKind = v.union(
  v.literal('fill'),
  v.literal('drain'),
  v.literal('exchange'),
  v.literal('liming'),
  v.literal('fertilization'),
  v.literal('treatment'),
  v.literal('aeration'),
  v.literal('other'),
)

/** Record a water management event; a product from inventory is issued to the unit. */
export const logWaterEvent = idempotentMutation('waterQuality.logWaterEvent', {
  args: {
    unitId: v.id('cages'),
    date: v.string(),
    kind: waterEventKind,
    exchangePct: v.optional(v.number()),
    volumeM3: v.optional(v.number()),
    hours: v.optional(v.number()),
    product: v.optional(v.string()),
    quantity: v.optional(v.number()),
    quantityUnit: v.optional(v.string()),
    inventoryItemId: v.optional(v.id('inventoryItems')),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.daily.record' })
    const unit = await loadUnit(ctx, user, args.unitId)
    if (!isBusinessDate(args.date)) throw new Error('Date must be a real date (YYYY-MM-DD)')
    const today = await todayFor(ctx, { locationId: unit.locationId, companyId: unit.companyId })
    if (args.date > today) throw new Error(`Date ${args.date} is in the future for this site`)
    if (args.exchangePct !== undefined && !(args.exchangePct > 0 && args.exchangePct <= 100)) {
      throw new Error('Exchange must be between 0 and 100%')
    }
    for (const [k, n] of [['Volume', args.volumeM3], ['Hours', args.hours], ['Quantity', args.quantity]] as const) {
      if (n !== undefined && !(Number.isFinite(n) && n > 0)) throw new Error(`${k} must be a positive number`)
    }
    if (args.kind === 'exchange' && args.exchangePct === undefined && args.volumeM3 === undefined) {
      throw new Error('Give the exchange as a % or a volume')
    }
    if (['liming', 'fertilization', 'treatment'].includes(args.kind) && !args.product?.trim() && !args.inventoryItemId) {
      throw new Error('Name the product used')
    }
    let movementId: Id<'inventoryMovements'> | undefined
    let product = args.product?.trim() || undefined
    let quantityUnit = args.quantityUnit?.trim() || undefined
    if (args.inventoryItemId) {
      if (!args.quantity) throw new Error('Give the quantity used to issue it from inventory')
      const item = await ctx.db.get(args.inventoryItemId)
      assertOwns(user, item, 'Item')
      product = product ?? item.name
      quantityUnit = quantityUnit ?? item.unit
      movementId = await issueItem(ctx, user, {
        itemId: item._id,
        quantity: args.quantity,
        cageId: unit._id,
        date: args.date,
        notes: `${args.kind} on ${unit.name}`,
      })
    }
    const id = await ctx.db.insert('waterManagementLogs', {
      companyId: unit.companyId!,
      locationId: unit.locationId,
      unitId: unit._id,
      date: args.date,
      kind: args.kind,
      exchangePct: args.exchangePct,
      volumeM3: args.volumeM3,
      hours: args.hours,
      product,
      quantity: args.quantity,
      quantityUnit,
      inventoryItemId: args.inventoryItemId,
      inventoryMovementId: movementId,
      notes: args.notes?.trim() || undefined,
      createdBy: user._id,
      createdAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'waterManagementLogs',
      recordId: id,
      newValues: args,
      locationId: unit.locationId,
    })
    return id
  },
})

/** A unit's water management events, newest first. */
export const listWaterEvents = query({
  args: { unitId: v.id('cages'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const unit = await ctx.db.get(args.unitId)
    if (!unit || ((user.role ?? 'user') !== 'super_admin' && unit.companyId !== user.companyId)) return []
    return await ctx.db
      .query('waterManagementLogs')
      .withIndex('by_unitId_and_date', (q) => q.eq('unitId', unit._id))
      .order('desc')
      .take(Math.min(Math.max(args.limit ?? 50, 1), 200))
  },
})

// ── M15 backfill ─────────────────────────────────────────────────────────

/**
 * M15: mirror DO, temperature and Secchi already captured on daily and
 * bi-weekly records into waterQualityReadings (originals untouched). Dry run
 * by default; a real run continues itself page by page and emits no
 * events. Idempotent: records that already have a mirror are skipped.
 */
export const backfillFromRecords = internalMutation({
  args: {
    table: v.union(v.literal('dailyRecords'), v.literal('biweeklyRecords')),
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false
    const page = await ctx.db
      .query(args.table)
      .paginate({ cursor: args.cursor ?? null, numItems: Math.min(args.batchSize ?? 200, 500) })
    let withWater = 0
    let created = 0
    let skipped = 0
    for (const r of page.page) {
      if (r.dissolvedOxygen == null && r.temperatureC == null && r.secchiCm == null) continue
      withWater += 1
      const mirror = await ctx.db
        .query('waterQualityReadings')
        .withIndex('by_sourceId', (q) => q.eq('sourceId', r._id))
        .first()
      if (mirror) {
        skipped += 1
        continue
      }
      if (!dryRun) {
        const id = await mirrorRecordReading(
          ctx,
          args.table === 'dailyRecords' ? 'daily_record' : 'biweekly_record',
          r._id,
          r,
          { quiet: true },
        )
        if (id) created += 1
      }
    }
    if (!dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.waterQuality.backfillFromRecords, {
        table: args.table,
        dryRun: false,
        cursor: page.continueCursor,
        batchSize: args.batchSize,
      })
    }
    return {
      dryRun,
      scanned: page.page.length,
      withWater,
      alreadyMirrored: skipped,
      created,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    }
  },
})
