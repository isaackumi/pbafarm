/**
 * Unit workspaces (Phase 6: CAGE-001, POND-001, RAS-001, PROD-013).
 *
 * Production units live in `cages` (any unitType). This module adds what the
 * unit pages need around them: unit groups (cage groups, pond blocks, RAS
 * systems), water bodies, a per-unit workspace read with density against the
 * farm rules, and status changes through the state machine.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertOwns, logAudit, writeCompanyId, writeLocationId } from './lib/tenancy'
import { scopedRows, tenantScope } from './lib/scope'
import { densityStatus, mergeSettings, unitTypeOf } from './lib/farmRules'
import { assertTransition, nextStatuses, STATUS_LABELS, type UnitStatus } from './lib/unitStatus'
import { requireMember } from './lib/permissions'
import { docFields, docValidator } from './lib/docValidators'

export const unitGroupKind = v.union(
  v.literal('cage_group'),
  v.literal('pond_block'),
  v.literal('ras_system'),
  v.literal('raceway_line'),
  v.literal('other'),
)

export const waterBodyKind = v.union(
  v.literal('lake'),
  v.literal('reservoir'),
  v.literal('river'),
  v.literal('sea'),
  v.literal('lagoon'),
  v.literal('borehole'),
  v.literal('canal'),
  v.literal('other'),
)

const unitStatus = v.union(
  v.literal('active'),
  v.literal('harvested'),
  v.literal('harvesting'),
  v.literal('maintenance'),
  v.literal('fallow'),
  v.literal('empty'),
)

function cleanName(name: string, label: string) {
  const out = name.trim()
  if (!out) throw new Error(`${label} name is required`)
  if (out.length > 80) throw new Error(`${label} name is too long`)
  return out
}

function checkCoords(lat?: number, lng?: number) {
  if (lat !== undefined && !(Number.isFinite(lat) && Math.abs(lat) <= 90)) {
    throw new Error('Latitude must be between -90 and 90')
  }
  if (lng !== undefined && !(Number.isFinite(lng) && Math.abs(lng) <= 180)) {
    throw new Error('Longitude must be between -180 and 180')
  }
  if ((lat === undefined) !== (lng === undefined)) {
    throw new Error('Give both latitude and longitude, or neither')
  }
}

async function companyGroups(ctx: QueryCtx, user: Doc<'users'>) {
  const scope = tenantScope(user)
  if (scope.kind !== 'company') return []
  return await ctx.db
    .query('unitGroups')
    .withIndex('by_companyId', (q) => q.eq('companyId', scope.companyId))
    .take(500)
}

async function companyWaterBodies(ctx: QueryCtx, user: Doc<'users'>) {
  const scope = tenantScope(user)
  if (scope.kind !== 'company') return []
  return await ctx.db
    .query('waterBodies')
    .withIndex('by_companyId', (q) => q.eq('companyId', scope.companyId))
    .take(200)
}

// ── Water bodies ─────────────────────────────────────────────────────────

export const listWaterBodies = query({
  args: { includeInactive: v.optional(v.boolean()) },
  returns: v.array(docValidator('waterBodies')),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const rows = await companyWaterBodies(ctx, user)
    return rows
      .filter((r) => args.includeInactive || r.active)
      .sort((a, b) => a.name.localeCompare(b.name))
  },
})

const waterBodyFields = {
  name: v.string(),
  kind: waterBodyKind,
  locationId: v.optional(v.id('farmLocations')),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  notes: v.optional(v.string()),
}

export const createWaterBody = mutation({
  args: waterBodyFields,
  returns: v.id('waterBodies'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.sites.manage' })
    checkCoords(args.latitude, args.longitude)
    const companyId = await writeCompanyId(user)
    const locationId = args.locationId ? await writeLocationId(ctx, user, args.locationId) : undefined
    const id = await ctx.db.insert('waterBodies', {
      ...args,
      name: cleanName(args.name, 'Water body'),
      locationId,
      companyId,
      active: true,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'waterBodies', recordId: id, newValues: args })
    return id
  },
})

export const updateWaterBody = mutation({
  args: {
    id: v.id('waterBodies'),
    patch: v.object({
      name: v.optional(v.string()),
      kind: v.optional(waterBodyKind),
      locationId: v.optional(v.id('farmLocations')),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      notes: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  returns: v.id('waterBodies'),
  handler: async (ctx, { id, patch }) => {
    const { user } = await requireMember(ctx, { permission: 'org.sites.manage' })
    const existing = await ctx.db.get(id)
    assertOwns(user, existing, 'Water body')
    const next: Record<string, unknown> = { ...patch, updatedAt: Date.now() }
    if (patch.name !== undefined) next.name = cleanName(patch.name, 'Water body')
    checkCoords(patch.latitude ?? existing.latitude, patch.longitude ?? existing.longitude)
    if (patch.locationId) next.locationId = await writeLocationId(ctx, user, patch.locationId)
    await ctx.db.patch(id, next)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'waterBodies',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })
    return id
  },
})

// ── Unit groups ──────────────────────────────────────────────────────────

export const listGroups = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    includeInactive: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      ...docFields('unitGroups'),
      waterBodyName: v.union(v.string(), v.null()),
      unitCount: v.number(),
      stockedCount: v.number(),
      fishCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const [groups, units, bodies] = await Promise.all([
      companyGroups(ctx, user),
      scopedRows(ctx, user, 'cages', { locationId: args.locationId }),
      companyWaterBodies(ctx, user),
    ])
    const bodyName = new Map(bodies.map((b) => [b._id, b.name]))
    const live = units.filter((u) => !u.archivedAt)
    return groups
      .filter((g) => (args.includeInactive || g.active) && (!args.locationId || g.locationId === args.locationId))
      .map((g) => {
        const members = live.filter((u) => u.unitGroupId === g._id)
        return {
          ...g,
          waterBodyName: g.waterBodyId ? bodyName.get(g.waterBodyId) ?? null : null,
          unitCount: members.length,
          stockedCount: members.filter((u) => u.status === 'active' || u.status === 'harvesting').length,
          fishCount: members.reduce((s, u) => s + (u.currentCount ?? 0), 0),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  },
})

const groupFields = {
  name: v.string(),
  kind: unitGroupKind,
  locationId: v.optional(v.id('farmLocations')),
  waterBodyId: v.optional(v.id('waterBodies')),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  systemVolumeM3: v.optional(v.number()),
  notes: v.optional(v.string()),
}

export const createGroup = mutation({
  args: groupFields,
  returns: v.id('unitGroups'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.sites.manage' })
    checkCoords(args.latitude, args.longitude)
    if (args.systemVolumeM3 !== undefined && !(args.systemVolumeM3 > 0)) {
      throw new Error('System volume must be a positive number')
    }
    const companyId = await writeCompanyId(user)
    if (args.waterBodyId) assertOwns(user, await ctx.db.get(args.waterBodyId), 'Water body')
    const locationId = args.locationId ? await writeLocationId(ctx, user, args.locationId) : undefined
    const id = await ctx.db.insert('unitGroups', {
      ...args,
      name: cleanName(args.name, 'Group'),
      locationId,
      companyId,
      active: true,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'unitGroups', recordId: id, newValues: args, locationId })
    return id
  },
})

export const updateGroup = mutation({
  args: {
    id: v.id('unitGroups'),
    patch: v.object({
      name: v.optional(v.string()),
      kind: v.optional(unitGroupKind),
      locationId: v.optional(v.id('farmLocations')),
      waterBodyId: v.optional(v.id('waterBodies')),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      systemVolumeM3: v.optional(v.number()),
      notes: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  returns: v.id('unitGroups'),
  handler: async (ctx, { id, patch }) => {
    const { user } = await requireMember(ctx, { permission: 'org.sites.manage' })
    const existing = await ctx.db.get(id)
    assertOwns(user, existing, 'Unit group')
    checkCoords(patch.latitude ?? existing.latitude, patch.longitude ?? existing.longitude)
    if (patch.waterBodyId) assertOwns(user, await ctx.db.get(patch.waterBodyId), 'Water body')
    const next: Record<string, unknown> = { ...patch, updatedAt: Date.now() }
    if (patch.name !== undefined) next.name = cleanName(patch.name, 'Group')
    if (patch.locationId) next.locationId = await writeLocationId(ctx, user, patch.locationId)
    await ctx.db.patch(id, next)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'unitGroups',
      recordId: id,
      previousValues: existing,
      newValues: patch,
      locationId: existing.locationId,
    })
    return id
  },
})

/** Put units in a group (or take them out with `groupId` omitted). */
export const assignToGroup = mutation({
  args: {
    unitIds: v.array(v.id('cages')),
    groupId: v.optional(v.id('unitGroups')),
  },
  returns: v.number(),
  handler: async (ctx, { unitIds, groupId }) => {
    const { user } = await requireMember(ctx, { permission: 'org.sites.manage' })
    if (unitIds.length > 200) throw new Error('Assign at most 200 units at a time')
    const group = groupId ? await ctx.db.get(groupId) : null
    if (groupId) assertOwns(user, group, 'Unit group')
    for (const unitId of unitIds) {
      const unit = await ctx.db.get(unitId)
      assertOwns(user, unit, 'Unit')
      await ctx.db.patch(unitId, {
        unitGroupId: groupId,
        // Keep the legacy free-text label in step for older screens.
        unitGroup: group?.name,
        ...(group?.waterBodyId && !unit.waterBodyId ? { waterBodyId: group.waterBodyId } : {}),
        updatedAt: Date.now(),
      })
    }
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'cages',
      newValues: { unitGroupId: groupId ?? null, unitIds },
    })
    return unitIds.length
  },
})

// ── Unit workspace ───────────────────────────────────────────────────────

/** What a unit is called and which fields matter, by type. */
export const UNIT_PROFILE: Record<
  string,
  { noun: string; groupNoun: string; densityNote: string }
> = {
  cage: { noun: 'Cage', groupNoun: 'Cage group', densityNote: 'per m³ inside the net' },
  pond: { noun: 'Pond', groupNoun: 'Pond block', densityNote: 'per m² of water surface' },
  tank: { noun: 'Tank', groupNoun: 'RAS system', densityNote: 'per m³ of water' },
  raceway: { noun: 'Raceway', groupNoun: 'Raceway line', densityNote: 'per m³ of water' },
  hatchery_tank: { noun: 'Hatchery tank', groupNoun: 'Hatchery system', densityNote: 'per m³ of water' },
  incubator: { noun: 'Incubator', groupNoun: 'Incubator rack', densityNote: 'per m³ of water' },
  hapa: { noun: 'Hapa', groupNoun: 'Hapa line', densityNote: 'per m² of surface' },
}

const levelValues = v.union(
  v.literal('ok'),
  v.literal('unknown'),
  v.literal('warn'),
  v.literal('over'),
)

const kindValues2 = v.union(
  v.literal('other'),
  v.literal('cage_group'),
  v.literal('pond_block'),
  v.literal('ras_system'),
  v.literal('raceway_line'),
)

const valueValues = v.union(
  v.literal('active'),
  v.literal('harvested'),
  v.literal('harvesting'),
  v.literal('maintenance'),
  v.literal('fallow'),
  v.literal('empty'),
)

const unitTypeValues = v.union(
  v.literal('cage'),
  v.literal('pond'),
  v.literal('tank'),
  v.literal('raceway'),
  v.literal('hatchery_tank'),
  v.literal('incubator'),
  v.literal('hapa'),
)

const kindValues = v.union(
  v.literal('lake'),
  v.literal('reservoir'),
  v.literal('river'),
  v.literal('sea'),
  v.literal('lagoon'),
  v.literal('borehole'),
  v.literal('canal'),
  v.literal('other'),
)

/**
 * Everything the unit page header and profile need: the unit, its group and
 * water body, density against the farm rule, and the statuses it may move to.
 */
export const workspace = query({
  args: { id: v.id('cages') },
  returns: v.union(
    v.object({
      unit: docValidator('cages'),
      unitType: unitTypeValues,
      profile: v.optional(
        v.object({ noun: v.string(), groupNoun: v.string(), densityNote: v.string() }),
      ),
      group: v.union(
        v.object({ _id: v.id('unitGroups'), name: v.string(), kind: kindValues2 }),
        v.null(),
      ),
      waterBody: v.union(
        v.object({ _id: v.id('waterBodies'), name: v.string(), kind: kindValues }),
        v.null(),
      ),
      site: v.union(
        v.object({
          _id: v.id('farmLocations'),
          name: v.string(),
          latitude: v.optional(v.number()),
          longitude: v.optional(v.number()),
        }),
        v.null(),
      ),
      density: v.object({
        density: v.union(v.number(), v.null()),
        max: v.union(v.number(), v.null()),
        unit: v.string(),
        measure: v.union(v.literal('area'), v.literal('volume')),
        sizeLabel: v.string(),
        pctOfMax: v.union(v.number(), v.null()),
        level: levelValues,
      }),
      status: v.object({
        value: valueValues,
        label: v.string(),
        changedAt: v.union(v.number(), v.null()),
      }),
      nextStatuses: v.array(
        v.object({
          status: valueValues,
          label: v.string(),
          allowed: v.boolean(),
          reason: v.union(v.string(), v.null()),
        }),
      ),
      archived: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const unit = await ctx.db.get(id)
    if (!unit) return null
    if ((user.role ?? 'user') !== 'super_admin' && unit.companyId !== user.companyId) return null
    const company = unit.companyId ? await ctx.db.get(unit.companyId) : null
    const { farmRules } = mergeSettings(company?.settings)
    const group = unit.unitGroupId ? await ctx.db.get(unit.unitGroupId) : null
    const waterBodyId = unit.waterBodyId ?? group?.waterBodyId
    const waterBody = waterBodyId ? await ctx.db.get(waterBodyId) : null
    const site = unit.locationId ? await ctx.db.get(unit.locationId) : null
    const type = unitTypeOf(unit)
    const live = unit.currentCount ?? 0
    const status = unit.status as UnitStatus
    return {
      unit,
      unitType: type,
      profile: UNIT_PROFILE[type] ?? UNIT_PROFILE.cage,
      group: group ? { _id: group._id, name: group.name, kind: group.kind } : null,
      waterBody: waterBody ? { _id: waterBody._id, name: waterBody.name, kind: waterBody.kind } : null,
      site: site
        ? { _id: site._id, name: site.name, latitude: site.latitude, longitude: site.longitude }
        : null,
      density: densityStatus(unit, live, farmRules),
      status: { value: status, label: STATUS_LABELS[status] ?? status, changedAt: unit.statusChangedAt ?? null },
      nextStatuses: nextStatuses(status, live),
      archived: !!unit.archivedAt,
    }
  },
})

/** Change a unit's status by hand, through the state machine (PROD-013). */
export const setStatus = mutation({
  args: {
    id: v.id('cages'),
    status: unitStatus,
    reason: v.optional(v.string()),
  },
  returns: v.id('cages'),
  handler: async (ctx, { id, status, reason }) => {
    const { user } = await requireMember(ctx, { permission: 'production.stock.adjust' })
    const unit = await ctx.db.get(id)
    assertOwns(user, unit, 'Unit')
    if (unit.archivedAt) throw new Error('This unit is archived; restore it first')
    if (unit.status === status) return id
    assertTransition(unit.status as UnitStatus, status, unit.currentCount ?? 0)
    const now = Date.now()
    await ctx.db.patch(id, { status, statusChangedAt: now, updatedAt: now })
    await logAudit(ctx, {
      actionType: 'status_change',
      tableName: 'cages',
      recordId: id,
      previousValues: { status: unit.status },
      newValues: { status, reason: reason?.trim() || undefined },
      locationId: unit.locationId,
    })
    return id
  },
})

/**
 * Units grouped for the unit board: each group with its units' status, fish
 * and density level; ungrouped units last. Archived units are left out.
 */
export const board = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  returns: v.object({
    sections: v.array(
      v.object({
        groupId: v.union(v.id('unitGroups'), v.null()),
        name: v.string(),
        kind: v.string(),
        latitude: v.union(v.number(), v.null()),
        longitude: v.union(v.number(), v.null()),
        units: v.array(
          v.object({
            _id: v.id('cages'),
            name: v.string(),
            code: v.optional(v.string()),
            unitType: unitTypeValues,
            status: valueValues,
            statusLabel: v.string(),
            fish: v.number(),
            abwG: v.union(v.number(), v.null()),
            species: v.union(v.string(), v.null()),
            density: v.union(v.number(), v.null()),
            densityUnit: v.string(),
            densityLevel: levelValues,
            densityPct: v.union(v.number(), v.null()),
            nextMaintenanceDate: v.union(v.string(), v.null()),
            latitude: v.union(v.number(), v.null()),
            longitude: v.union(v.number(), v.null()),
            locationId: v.union(v.id('farmLocations'), v.null()),
          }),
        ),
      }),
    ),
    totals: v.object({
      units: v.number(),
      stocked: v.number(),
      fish: v.number(),
      overDensity: v.number(),
      nearDensity: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const [units, groups] = await Promise.all([
      scopedRows(ctx, user, 'cages', { locationId: args.locationId }),
      companyGroups(ctx, user),
    ])
    const company = user.companyId ? await ctx.db.get(user.companyId) : null
    const { farmRules } = mergeSettings(company?.settings)
    const live = units.filter((u) => !u.archivedAt)
    const toCard = (u: Doc<'cages'>) => {
      const d = densityStatus(u, u.currentCount ?? 0, farmRules)
      return {
        _id: u._id,
        name: u.name,
        code: u.code,
        unitType: unitTypeOf(u),
        status: u.status,
        statusLabel: STATUS_LABELS[u.status as UnitStatus] ?? u.status,
        fish: u.currentCount ?? 0,
        abwG: u.currentWeight ?? null,
        species: u.species ?? null,
        density: d.density,
        densityUnit: d.unit,
        densityLevel: d.level,
        densityPct: d.pctOfMax,
        nextMaintenanceDate: u.nextMaintenanceDate ?? null,
        latitude: u.latitude ?? null,
        longitude: u.longitude ?? null,
        locationId: u.locationId ?? null,
      }
    }
    const byGroup = new Map<Id<'unitGroups'>, ReturnType<typeof toCard>[]>()
    const ungrouped: ReturnType<typeof toCard>[] = []
    for (const u of live) {
      const card = toCard(u)
      if (u.unitGroupId) {
        const list = byGroup.get(u.unitGroupId) ?? []
        list.push(card)
        byGroup.set(u.unitGroupId, list)
      } else ungrouped.push(card)
    }
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    const sections = groups
      .filter((g) => g.active && (byGroup.get(g._id)?.length || !args.locationId || g.locationId === args.locationId))
      .sort(byName)
      .map((g) => ({
        groupId: g._id as Id<'unitGroups'> | null,
        name: g.name,
        kind: g.kind as string,
        latitude: g.latitude ?? null,
        longitude: g.longitude ?? null,
        units: (byGroup.get(g._id) ?? []).sort(byName),
      }))
    // Units whose group was deactivated or deleted still show, ungrouped.
    const shown = new Set(sections.flatMap((s) => s.units.map((u) => u._id)))
    for (const [, list] of byGroup) for (const c of list) if (!shown.has(c._id)) ungrouped.push(c)
    if (ungrouped.length) {
      sections.push({ groupId: null, name: 'Not in a group', kind: 'none', latitude: null, longitude: null, units: ungrouped.sort(byName) })
    }
    const all = sections.flatMap((s) => s.units)
    return {
      sections,
      totals: {
        units: all.length,
        stocked: all.filter((u) => u.status === 'active' || u.status === 'harvesting').length,
        fish: all.reduce((s, u) => s + u.fish, 0),
        overDensity: all.filter((u) => u.densityLevel === 'over').length,
        nearDensity: all.filter((u) => u.densityLevel === 'warn').length,
      },
    }
  },
})

/**
 * Everything with coordinates, for the site map: sites, water bodies,
 * groups and units (status and fish). A unit without its own position is
 * counted at its group's.
 */
export const mapPoints = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  returns: v.object({
    sites: v.array(
      v.object({
        _id: v.id('farmLocations'),
        name: v.string(),
        latitude: v.number(),
        longitude: v.number(),
      }),
    ),
    waterBodies: v.array(
      v.object({
        _id: v.id('waterBodies'),
        name: v.string(),
        kind: kindValues,
        latitude: v.number(),
        longitude: v.number(),
      }),
    ),
    groups: v.array(
      v.object({
        _id: v.id('unitGroups'),
        name: v.string(),
        kind: kindValues2,
        latitude: v.number(),
        longitude: v.number(),
        unitCount: v.number(),
        stocked: v.number(),
        unplaced: v.number(),
      }),
    ),
    units: v.array(
      v.object({
        _id: v.id('cages'),
        name: v.string(),
        unitType: unitTypeValues,
        status: valueValues,
        statusLabel: v.string(),
        fish: v.number(),
        latitude: v.number(),
        longitude: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const scope = tenantScope(user)
    if (scope.kind !== 'company') return { sites: [], waterBodies: [], groups: [], units: [] }
    const [sites, bodies, groups, units] = await Promise.all([
      ctx.db
        .query('farmLocations')
        .withIndex('by_company', (q) => q.eq('companyId', scope.companyId))
        .take(200),
      companyWaterBodies(ctx, user),
      companyGroups(ctx, user),
      scopedRows(ctx, user, 'cages', { locationId: args.locationId }),
    ])
    const has = (r: { latitude?: number; longitude?: number }) => r.latitude != null && r.longitude != null
    const live = units.filter((u) => !u.archivedAt)
    return {
      sites: sites
        .filter((s) => s.active !== false && has(s) && (!args.locationId || s._id === args.locationId))
        .map((s) => ({ _id: s._id, name: s.name, latitude: s.latitude!, longitude: s.longitude! })),
      waterBodies: bodies
        .filter((b) => b.active && has(b))
        .map((b) => ({ _id: b._id, name: b.name, kind: b.kind, latitude: b.latitude!, longitude: b.longitude! })),
      groups: groups
        .filter((g) => g.active && has(g) && (!args.locationId || !g.locationId || g.locationId === args.locationId))
        .map((g) => {
          const members = live.filter((u) => u.unitGroupId === g._id)
          return {
            _id: g._id,
            name: g.name,
            kind: g.kind,
            latitude: g.latitude!,
            longitude: g.longitude!,
            unitCount: members.length,
            stocked: members.filter((u) => u.status === 'active' || u.status === 'harvesting').length,
            unplaced: members.filter((u) => !has(u)).length,
          }
        }),
      units: live.filter(has).map((u) => ({
        _id: u._id,
        name: u.name,
        unitType: unitTypeOf(u),
        status: u.status,
        statusLabel: STATUS_LABELS[u.status as UnitStatus] ?? u.status,
        fish: u.currentCount ?? 0,
        latitude: u.latitude!,
        longitude: u.longitude!,
      })),
    }
  },
})
