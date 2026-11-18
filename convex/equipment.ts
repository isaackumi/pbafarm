/**
 * Equipment registry, maintenance and net inspections (Phase 6: RAS-002,
 * CAGE-002).
 *
 * - `equipment`: pumps, blowers, aerators, biofilters, nets, ... attached to
 *   a unit or a group, with a maintenance interval and next due date.
 * - `unitInspections`: net inspections, maintenance, repairs, cleaning and
 *   calibration on a unit and/or a piece of equipment. Logging one moves the
 *   next due date forward (equipment.nextMaintenanceDue or, for a net
 *   inspection, cages.nextMaintenanceDate) and can issue spare parts from
 *   non-feed inventory (Phase 9).
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertLocationAccess, assertOwns, logAudit, writeLocationId } from './lib/tenancy'
import { idempotentMutation } from './lib/idempotency'
import { addDays, isBusinessDate, todayFor } from './lib/dates'
import { issueItem } from './inventoryItems'
import { requireMember } from './lib/permissions'
import { validateCustom } from './lib/customFields'
import { customValues } from './schema'

export const equipmentKind = v.union(
  v.literal('pump'),
  v.literal('blower'),
  v.literal('aerator'),
  v.literal('biofilter'),
  v.literal('mechanical_filter'),
  v.literal('uv'),
  v.literal('oxygen_cone'),
  v.literal('net'),
  v.literal('mooring'),
  v.literal('feeder'),
  v.literal('generator'),
  v.literal('sensor'),
  v.literal('other'),
)

export const equipmentStatus = v.union(
  v.literal('in_service'),
  v.literal('standby'),
  v.literal('faulty'),
  v.literal('under_maintenance'),
  v.literal('retired'),
)

const inspectionKind = v.union(
  v.literal('net_inspection'),
  v.literal('maintenance'),
  v.literal('repair'),
  v.literal('cleaning'),
  v.literal('calibration'),
  v.literal('inspection'),
)

const inspectionResult = v.union(v.literal('ok'), v.literal('needs_attention'), v.literal('failed'))

/** Default checklist for a cage net inspection (CAGE-002). */
export const NET_CHECKLIST = [
  'Net free of holes and tears',
  'Seams and lacing intact',
  'Fouling acceptable',
  'Weights and sinker tube in place',
  'Mooring lines and buoys sound',
  'Bird and predator net intact',
  'Walkway and frame safe',
]

const MAX_SPARES = 20
const MAX_CHECKLIST = 30
const MAX_PARTS = 20

function cleanText(s: string | undefined, max = 2000) {
  const out = s?.trim()
  if (!out) return undefined
  if (out.length > max) throw new Error('Text is too long')
  return out
}

function checkDate(d: string | undefined, label: string) {
  if (d !== undefined && !isBusinessDate(d)) throw new Error(`${label} must be a real date (YYYY-MM-DD)`)
}

async function checkSpares(ctx: MutationCtx, user: Doc<'users'>, ids: Id<'inventoryItems'>[] | undefined) {
  if (!ids) return undefined
  if (ids.length > MAX_SPARES) throw new Error(`At most ${MAX_SPARES} spare parts per item`)
  for (const id of ids) {
    const item = await ctx.db.get(id)
    assertOwns(user, item, 'Spare part')
  }
  return [...new Set(ids)]
}

const equipmentFields = {
  name: v.string(),
  kind: equipmentKind,
  status: v.optional(equipmentStatus),
  unitId: v.optional(v.id('cages')),
  unitGroupId: v.optional(v.id('unitGroups')),
  locationId: v.optional(v.id('farmLocations')),
  make: v.optional(v.string()),
  model: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  rating: v.optional(v.string()),
  installedOn: v.optional(v.string()),
  maintenanceIntervalDays: v.optional(v.number()),
  lastMaintainedOn: v.optional(v.string()),
  nextMaintenanceDue: v.optional(v.string()),
  sparePartItemIds: v.optional(v.array(v.id('inventoryItems'))),
  notes: v.optional(v.string()),
  custom: v.optional(customValues),
}

/** Equipment of the company (optionally one unit or group), with attachment names. */
export const list = query({
  args: {
    unitId: v.optional(v.id('cages')),
    unitGroupId: v.optional(v.id('unitGroups')),
    locationId: v.optional(v.id('farmLocations')),
    includeRetired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    if (!user.companyId) return []
    const companyId = user.companyId
    const rows = args.unitId
      ? await ctx.db
          .query('equipment')
          .withIndex('by_unitId', (q) => q.eq('unitId', args.unitId))
          .take(200)
      : await ctx.db
          .query('equipment')
          .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
          .take(1000)
    const names = new Map<string, string>()
    const nameOf = async (id: Id<'cages'> | Id<'unitGroups'> | undefined) => {
      if (!id) return null
      if (!names.has(id)) names.set(id, ((await ctx.db.get(id)) as { name?: string } | null)?.name ?? '')
      return names.get(id) || null
    }
    const out = []
    for (const e of rows) {
      if (e.companyId !== companyId) continue
      if (!args.includeRetired && e.status === 'retired') continue
      if (args.unitGroupId && e.unitGroupId !== args.unitGroupId) continue
      if (args.locationId && e.locationId !== args.locationId) continue
      out.push({ ...e, unitName: await nameOf(e.unitId), groupName: await nameOf(e.unitGroupId) })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  },
})

/** Register equipment (admin). */
export const create = mutation({
  args: equipmentFields,
  returns: v.id('equipment'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.sites.manage' })
    const companyId = user.companyId
    if (!companyId) throw new Error('No company')
    const name = cleanText(args.name, 120)
    if (!name) throw new Error('Name is required')
    for (const [d, label] of [
      [args.installedOn, 'Installed on'],
      [args.lastMaintainedOn, 'Last maintained'],
      [args.nextMaintenanceDue, 'Next maintenance'],
    ] as const) checkDate(d, label)
    if (args.maintenanceIntervalDays !== undefined && !(args.maintenanceIntervalDays >= 1 && args.maintenanceIntervalDays <= 3650)) {
      throw new Error('Maintenance interval must be between 1 and 3650 days')
    }
    const unit = args.unitId ? await ctx.db.get(args.unitId) : null
    if (args.unitId) assertOwns(user, unit, 'Unit')
    const group = args.unitGroupId ? await ctx.db.get(args.unitGroupId) : null
    if (args.unitGroupId) assertOwns(user, group, 'Unit group')
    const locationId =
      (args.locationId ? await writeLocationId(ctx, user, args.locationId) : undefined) ??
      unit?.locationId ??
      group?.locationId
    const nextDue =
      args.nextMaintenanceDue ??
      (args.lastMaintainedOn && args.maintenanceIntervalDays
        ? addDays(args.lastMaintainedOn, args.maintenanceIntervalDays)
        : undefined)
    const custom = await validateCustom(ctx, {
      companyId,
      entity: 'equipment',
      custom: args.custom,
      mode: 'create',
      context: { locationId, core: args },
    })
    const id = await ctx.db.insert('equipment', {
      ...args,
      custom,
      name,
      companyId,
      locationId,
      status: args.status ?? 'in_service',
      make: cleanText(args.make, 120),
      model: cleanText(args.model, 120),
      serialNumber: cleanText(args.serialNumber, 120),
      rating: cleanText(args.rating, 200),
      notes: cleanText(args.notes),
      nextMaintenanceDue: nextDue,
      sparePartItemIds: await checkSpares(ctx, user, args.sparePartItemIds),
      createdBy: user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'equipment', recordId: id, newValues: args, locationId })
    return id
  },
})

/** Edit equipment (admin). Status changes are allowed in any direction. */
export const update = mutation({
  args: {
    id: v.id('equipment'),
    patch: v.object({
      name: v.optional(v.string()),
      kind: v.optional(equipmentKind),
      status: v.optional(equipmentStatus),
      unitId: v.optional(v.id('cages')),
      unitGroupId: v.optional(v.id('unitGroups')),
      make: v.optional(v.string()),
      model: v.optional(v.string()),
      serialNumber: v.optional(v.string()),
      rating: v.optional(v.string()),
      installedOn: v.optional(v.string()),
      maintenanceIntervalDays: v.optional(v.number()),
      nextMaintenanceDue: v.optional(v.string()),
      sparePartItemIds: v.optional(v.array(v.id('inventoryItems'))),
      notes: v.optional(v.string()),
      custom: v.optional(customValues),
    }),
  },
  returns: v.id('equipment'),
  handler: async (ctx, { id, patch }) => {
    const { user } = await requireMember(ctx, { permission: 'org.sites.manage' })
    const existing = await ctx.db.get(id)
    assertOwns(user, existing, 'Equipment')
    checkDate(patch.installedOn, 'Installed on')
    checkDate(patch.nextMaintenanceDue, 'Next maintenance')
    if (patch.maintenanceIntervalDays !== undefined && !(patch.maintenanceIntervalDays >= 1 && patch.maintenanceIntervalDays <= 3650)) {
      throw new Error('Maintenance interval must be between 1 and 3650 days')
    }
    if (patch.unitId) assertOwns(user, await ctx.db.get(patch.unitId), 'Unit')
    if (patch.unitGroupId) assertOwns(user, await ctx.db.get(patch.unitGroupId), 'Unit group')
    const next: Record<string, unknown> = { ...patch, updatedAt: Date.now() }
    if (patch.name !== undefined) {
      const name = cleanText(patch.name, 120)
      if (!name) throw new Error('Name is required')
      next.name = name
    }
    if (patch.sparePartItemIds) next.sparePartItemIds = await checkSpares(ctx, user, patch.sparePartItemIds)
    if (patch.custom !== undefined) {
      next.custom = await validateCustom(ctx, {
        companyId: existing.companyId,
        entity: 'equipment',
        custom: patch.custom,
        previous: existing.custom,
        mode: 'update',
        context: { locationId: existing.locationId, core: { ...existing, ...patch } },
      })
    }
    await ctx.db.patch(id, next)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'equipment',
      recordId: id,
      previousValues: existing,
      newValues: patch,
      locationId: existing.locationId,
    })
    return id
  },
})

/**
 * Log an inspection or maintenance job (any member at the site). Moves the
 * next due date, sets equipment status from the result, and issues the
 * spare parts used from inventory.
 */
export const logInspection = idempotentMutation('equipment.logInspection', {
  args: {
    kind: inspectionKind,
    unitId: v.optional(v.id('cages')),
    equipmentId: v.optional(v.id('equipment')),
    date: v.string(),
    result: inspectionResult,
    checklist: v.optional(v.array(v.object({ item: v.string(), ok: v.boolean(), note: v.optional(v.string()) }))),
    findings: v.optional(v.string()),
    actionsTaken: v.optional(v.string()),
    nextDueOn: v.optional(v.string()),
    performedBy: v.optional(v.string()),
    cost: v.optional(v.number()),
    partsUsed: v.optional(v.array(v.object({ itemId: v.id('inventoryItems'), quantity: v.number() }))),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.daily.record' })
    if (!args.unitId && !args.equipmentId) throw new Error('Choose a unit or a piece of equipment')
    const gear = args.equipmentId ? await ctx.db.get(args.equipmentId) : null
    if (args.equipmentId) assertOwns(user, gear, 'Equipment')
    const unitId = args.unitId ?? gear?.unitId
    const unit = unitId ? await ctx.db.get(unitId) : null
    if (unitId) assertOwns(user, unit, 'Unit')
    if (args.kind === 'net_inspection' && !unit) throw new Error('A net inspection needs a unit')
    const locationId = unit?.locationId ?? gear?.locationId
    assertLocationAccess(user, locationId)
    if (!isBusinessDate(args.date)) throw new Error('Date must be a real date (YYYY-MM-DD)')
    const today = await todayFor(ctx, { locationId, companyId: user.companyId })
    if (args.date > today) throw new Error(`Date ${args.date} is in the future for this site`)
    checkDate(args.nextDueOn, 'Next due')
    if (args.nextDueOn && args.nextDueOn < args.date) throw new Error('Next due date is before this job')
    if ((args.checklist?.length ?? 0) > MAX_CHECKLIST) throw new Error(`At most ${MAX_CHECKLIST} checklist items`)
    if ((args.partsUsed?.length ?? 0) > MAX_PARTS) throw new Error(`At most ${MAX_PARTS} parts per job`)
    if (args.cost !== undefined && !(Number.isFinite(args.cost) && args.cost >= 0)) {
      throw new Error('Cost must be zero or more')
    }
    const failedItems = (args.checklist ?? []).filter((c) => !c.ok)
    if (args.result === 'ok' && failedItems.length) {
      throw new Error('Some checklist items failed; record the result as needs attention or failed')
    }

    // Spares issued from inventory, at the unit's (or equipment's) site.
    const parts = []
    for (const p of args.partsUsed ?? []) {
      const movementId = await issueItem(ctx, user, {
        itemId: p.itemId,
        quantity: p.quantity,
        cageId: unit?._id,
        locationId: unit ? undefined : gear?.locationId,
        date: args.date,
        notes: `${args.kind.replace('_', ' ')}${gear ? ` of ${gear.name}` : ''}${unit ? ` on ${unit.name}` : ''}`,
      })
      parts.push({ itemId: p.itemId, quantity: p.quantity, movementId })
    }

    // Next due: given, else the equipment's interval from this job.
    const nextDue =
      args.nextDueOn ??
      (gear?.maintenanceIntervalDays && args.kind !== 'repair'
        ? addDays(args.date, gear.maintenanceIntervalDays)
        : undefined)

    const id = await ctx.db.insert('unitInspections', {
      companyId: (unit?.companyId ?? gear?.companyId)!,
      locationId,
      unitId: unit?._id,
      equipmentId: gear?._id,
      kind: args.kind,
      date: args.date,
      result: args.result,
      checklist: args.checklist?.map((c) => ({ item: c.item.trim().slice(0, 200), ok: c.ok, note: cleanText(c.note, 500) })),
      findings: cleanText(args.findings),
      actionsTaken: cleanText(args.actionsTaken),
      nextDueOn: nextDue,
      performedBy: cleanText(args.performedBy, 120),
      cost: args.cost,
      partsUsed: parts.length ? parts : undefined,
      createdBy: user._id,
      createdAt: Date.now(),
    })

    if (gear) {
      const isLatest = !gear.lastMaintainedOn || args.date >= gear.lastMaintainedOn
      await ctx.db.patch(gear._id, {
        ...(isLatest ? { lastMaintainedOn: args.date, ...(nextDue ? { nextMaintenanceDue: nextDue } : {}) } : {}),
        // The result sets the status unless the item is retired.
        ...(gear.status !== 'retired' && isLatest
          ? { status: args.result === 'failed' ? ('faulty' as const) : ('in_service' as const) }
          : {}),
        updatedAt: Date.now(),
      })
    }
    if (unit && !gear && (args.kind === 'net_inspection' || args.kind === 'maintenance' || args.kind === 'cleaning')) {
      const isLatest = !unit.lastMaintenanceDate || args.date >= unit.lastMaintenanceDate
      if (isLatest) {
        await ctx.db.patch(unit._id, {
          lastMaintenanceDate: args.date,
          ...(nextDue ? { nextMaintenanceDate: nextDue } : {}),
          updatedAt: Date.now(),
        })
      }
    }
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'unitInspections',
      recordId: id,
      newValues: { ...args, partsUsed: parts },
      locationId,
    })
    return { id, nextDueOn: nextDue ?? null, failedItems: failedItems.length }
  },
})

/** Inspection and maintenance history of a unit or a piece of equipment. */
export const listInspections = query({
  args: {
    unitId: v.optional(v.id('cages')),
    equipmentId: v.optional(v.id('equipment')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    if (!user.companyId) return []
    const companyId = user.companyId
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200)
    const rows = args.equipmentId
      ? await ctx.db
          .query('unitInspections')
          .withIndex('by_equipmentId_and_date', (q) => q.eq('equipmentId', args.equipmentId))
          .order('desc')
          .take(limit)
      : args.unitId
        ? await ctx.db
            .query('unitInspections')
            .withIndex('by_unitId_and_date', (q) => q.eq('unitId', args.unitId))
            .order('desc')
            .take(limit)
        : await ctx.db
            .query('unitInspections')
            .withIndex('by_companyId_and_date', (q) => q.eq('companyId', companyId))
            .order('desc')
            .take(limit)
    const names = new Map<string, string>()
    const out = []
    for (const r of rows) {
      if (r.companyId !== companyId) continue
      for (const id of [r.unitId, r.equipmentId]) {
        if (id && !names.has(id)) names.set(id, ((await ctx.db.get(id)) as { name?: string } | null)?.name ?? '')
      }
      out.push({
        ...r,
        unitName: r.unitId ? names.get(r.unitId) ?? null : null,
        equipmentName: r.equipmentId ? names.get(r.equipmentId) ?? null : null,
      })
    }
    return out
  },
})

/**
 * Maintenance due on or before `asOf + days`, overdue first: equipment and
 * units with a next net inspection / maintenance date. Pass `asOf` (the
 * client's today) so the result does not go stale.
 */
export const due = query({
  args: {
    asOf: v.string(),
    days: v.optional(v.number()),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    if (!user.companyId) return { overdue: [], dueSoon: [] }
    const companyId = user.companyId
    const until = addDays(args.asOf, Math.max(0, Math.min(90, args.days ?? 14)))
    const gear = await ctx.db
      .query('equipment')
      .withIndex('by_companyId_and_nextMaintenanceDue', (q) =>
        q.eq('companyId', companyId).gte('nextMaintenanceDue', '0000-01-01').lte('nextMaintenanceDue', until),
      )
      .take(200)
    const units = await ctx.db
      .query('cages')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(2000)
    type Item = {
      kind: 'equipment' | 'unit'
      id: string
      name: string
      detail: string
      due: string
      unitId: Id<'cages'> | null
      equipmentId: Id<'equipment'> | null
    }
    const items: Item[] = []
    for (const e of gear) {
      if (e.status === 'retired' || (args.locationId && e.locationId !== args.locationId)) continue
      items.push({
        kind: 'equipment',
        id: e._id,
        name: e.name,
        detail: e.kind.replace('_', ' '),
        due: e.nextMaintenanceDue!,
        unitId: e.unitId ?? null,
        equipmentId: e._id,
      })
    }
    for (const u of units) {
      if (u.archivedAt || !u.nextMaintenanceDate || u.nextMaintenanceDate > until) continue
      if (args.locationId && u.locationId !== args.locationId) continue
      items.push({
        kind: 'unit',
        id: u._id,
        name: u.name,
        detail: (u.unitType ?? 'cage') === 'cage' ? 'net inspection' : 'maintenance',
        due: u.nextMaintenanceDate,
        unitId: u._id,
        equipmentId: null,
      })
    }
    items.sort((a, b) => a.due.localeCompare(b.due))
    return {
      overdue: items.filter((i) => i.due < args.asOf),
      dueSoon: items.filter((i) => i.due >= args.asOf),
    }
  },
})
