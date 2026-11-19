import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { cageGrowth } from './lib/growth'
import { mergeSettings, unitTypeOf } from './lib/farmRules'
import { assertTransition, type UnitStatus } from './lib/unitStatus'
import { customValues, unitTypeValidator } from './schema'
import { validateCustom } from './lib/customFields'
import { beginStockWrite, shadowCountEdit } from './lib/productionDualWrite'
import { assertOwns, listForCompany, writeCompanyId, writeLocationId, ensureDefaultLocation, logAudit } from './lib/tenancy'
import { scopedRows, tenantScope, PLATFORM_SCAN_LIMIT } from './lib/scope'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertUserCan, requireMember } from './lib/permissions'

/**
 * The caller's stocked cages (optionally one site): status active or
 * harvesting (fish are still in, fed and counted), via `by_company_status`.
 */
async function activeCages(
  ctx: QueryCtx,
  user: Doc<'users'>,
  locationId?: Id<'farmLocations'>,
): Promise<Doc<'cages'>[]> {
  const scope = tenantScope(user)
  if (scope.kind === 'none') return []
  const rows: Doc<'cages'>[] = []
  for (const status of ['active', 'harvesting'] as const) {
    rows.push(
      ...(scope.kind === 'company'
        ? await ctx.db
            .query('cages')
            .withIndex('by_company_status', (q) =>
              q.eq('companyId', scope.companyId).eq('status', status),
            )
            .collect()
        : await ctx.db
            .query('cages')
            .withIndex('by_status', (q) => q.eq('status', status))
            .take(PLATFORM_SCAN_LIMIT)),
    )
  }
  const live = rows.filter((c) => !c.archivedAt)
  return locationId ? live.filter((c) => c.locationId === locationId) : live
}

const STOCKED = new Set(['active', 'harvesting'])

/** A group or water body given to a unit must be the caller's company's. */
async function assertUnitLinks(
  ctx: QueryCtx,
  user: Doc<'users'>,
  links: { unitGroupId?: Id<'unitGroups'>; waterBodyId?: Id<'waterBodies'> },
) {
  if (links.unitGroupId) assertOwns(user, await ctx.db.get(links.unitGroupId), 'Unit group')
  if (links.waterBodyId) assertOwns(user, await ctx.db.get(links.waterBodyId), 'Water body')
}

/** Typed geometry for production units (FARM-002); all optional, metres. */
const geometryArgs = {
  unitType: v.optional(unitTypeValidator),
  areaM2: v.optional(v.number()),
  depthM: v.optional(v.number()),
  volumeM3: v.optional(v.number()),
  diameterM: v.optional(v.number()),
  unitGroup: v.optional(v.string()),
  // Unit workspace (CAGE-001, POND-001, RAS-001).
  unitGroupId: v.optional(v.id('unitGroups')),
  waterBodyId: v.optional(v.id('waterBodies')),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  netVolumeM3: v.optional(v.number()),
  meshSizeMm: v.optional(v.number()),
  lengthM: v.optional(v.number()),
  widthM: v.optional(v.number()),
  flowM3h: v.optional(v.number()),
  waterSource: v.optional(v.string()),
  maxDensity: v.optional(v.number()),
}

const POSITIVE_KEYS = [
  'areaM2', 'depthM', 'volumeM3', 'diameterM', 'size',
  'netVolumeM3', 'meshSizeMm', 'lengthM', 'widthM', 'flowM3h', 'maxDensity',
] as const

/**
 * Validate geometry and keep `size` (the m³ the density rules read) in step
 * with volumeM3: a new volume also sets size unless size is given.
 */
function normalizeGeometry<T extends Record<string, any>>(g: T): T {
  for (const key of POSITIVE_KEYS) {
    const n = g[key]
    if (n !== undefined && !(Number.isFinite(n) && n > 0)) {
      throw new Error(`${key} must be a positive number`)
    }
  }
  if (g.latitude !== undefined && !(Number.isFinite(g.latitude) && Math.abs(g.latitude) <= 90)) {
    throw new Error('Latitude must be between -90 and 90')
  }
  if (g.longitude !== undefined && !(Number.isFinite(g.longitude) && Math.abs(g.longitude) <= 180)) {
    throw new Error('Longitude must be between -180 and 180')
  }
  const out: Record<string, any> = { ...g }
  if (g.volumeM3 !== undefined && g.size === undefined) out.size = g.volumeM3
  if (typeof g.unitGroup === 'string') out.unitGroup = g.unitGroup.trim() || undefined
  return out as T
}

const cageStatus = v.union(
  v.literal('active'),
  v.literal('harvested'),
  v.literal('harvesting'),
  v.literal('maintenance'),
  v.literal('fallow'),
  v.literal('empty'),
)

function toClient(cage: Doc<'cages'>) {
  return {
    custom: cage.custom ?? {},
    id: cage._id,
    _id: cage._id,
    name: cage.name,
    code: cage.code,
    location: cage.location,
    location_id: cage.locationId,
    size: cage.size,
    capacity: cage.capacity,
    dimensions: cage.dimensions,
    material: cage.material,
    installation_date: cage.installationDate,
    stocking_date: cage.stockingDate,
    initial_count: cage.initialCount,
    current_count: cage.currentCount,
    initial_abw: cage.initialAbw,
    initial_biomass: cage.initialBiomass,
    initial_weight: cage.initialWeight,
    current_weight: cage.currentWeight,
    growth_rate: cage.growthRate,
    mortality_rate: cage.mortalityRate,
    last_maintenance_date: cage.lastMaintenanceDate,
    next_maintenance_date: cage.nextMaintenanceDate,
    status: cage.status,
    notes: cage.notes,
    species: cage.species,
    unit_type: unitTypeOf(cage),
    unitType: unitTypeOf(cage),
    area_m2: cage.areaM2,
    areaM2: cage.areaM2,
    depth_m: cage.depthM,
    depthM: cage.depthM,
    volume_m3: cage.volumeM3 ?? cage.size,
    volumeM3: cage.volumeM3 ?? cage.size,
    diameter_m: cage.diameterM,
    diameterM: cage.diameterM,
    unit_group: cage.unitGroup,
    unitGroup: cage.unitGroup,
    unitGroupId: cage.unitGroupId,
    waterBodyId: cage.waterBodyId,
    latitude: cage.latitude,
    longitude: cage.longitude,
    netVolumeM3: cage.netVolumeM3,
    meshSizeMm: cage.meshSizeMm,
    lengthM: cage.lengthM,
    widthM: cage.widthM,
    flowM3h: cage.flowM3h,
    waterSource: cage.waterSource,
    maxDensity: cage.maxDensity,
    status_changed_at: cage.statusChangedAt,
    archived_at: cage.archivedAt,
    archivedAt: cage.archivedAt,
    company_id: cage.companyId,
    created_by: cage.createdBy,
    updated_at: cage.updatedAt,
    created_at: cage._creationTime,
  }
}

const cageRow = v.object({
  custom: v.record(v.string(), v.any()),
  id: v.id('cages'),
  _id: v.id('cages'),
  name: v.string(),
  code: v.optional(v.string()),
  location: v.optional(v.string()),
  location_id: v.optional(v.id('farmLocations')),
  size: v.optional(v.number()),
  capacity: v.optional(v.number()),
  dimensions: v.optional(v.string()),
  material: v.optional(v.string()),
  installation_date: v.optional(v.string()),
  stocking_date: v.optional(v.string()),
  initial_count: v.optional(v.number()),
  current_count: v.optional(v.number()),
  initial_abw: v.optional(v.number()),
  initial_biomass: v.optional(v.number()),
  initial_weight: v.optional(v.number()),
  current_weight: v.optional(v.number()),
  growth_rate: v.optional(v.number()),
  mortality_rate: v.optional(v.number()),
  last_maintenance_date: v.optional(v.string()),
  next_maintenance_date: v.optional(v.string()),
  status: v.union(
    v.literal('active'),
    v.literal('harvested'),
    v.literal('harvesting'),
    v.literal('maintenance'),
    v.literal('fallow'),
    v.literal('empty'),
  ),
  notes: v.optional(v.string()),
  species: v.optional(v.string()),
  unit_type: v.union(
    v.literal('cage'),
    v.literal('pond'),
    v.literal('tank'),
    v.literal('raceway'),
    v.literal('hatchery_tank'),
    v.literal('incubator'),
    v.literal('hapa'),
  ),
  unitType: v.union(
    v.literal('cage'),
    v.literal('pond'),
    v.literal('tank'),
    v.literal('raceway'),
    v.literal('hatchery_tank'),
    v.literal('incubator'),
    v.literal('hapa'),
  ),
  area_m2: v.optional(v.number()),
  areaM2: v.optional(v.number()),
  depth_m: v.optional(v.number()),
  depthM: v.optional(v.number()),
  volume_m3: v.optional(v.number()),
  volumeM3: v.optional(v.number()),
  diameter_m: v.optional(v.number()),
  diameterM: v.optional(v.number()),
  unit_group: v.optional(v.string()),
  unitGroup: v.optional(v.string()),
  unitGroupId: v.optional(v.id('unitGroups')),
  waterBodyId: v.optional(v.id('waterBodies')),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  netVolumeM3: v.optional(v.number()),
  meshSizeMm: v.optional(v.number()),
  lengthM: v.optional(v.number()),
  widthM: v.optional(v.number()),
  flowM3h: v.optional(v.number()),
  waterSource: v.optional(v.string()),
  maxDensity: v.optional(v.number()),
  status_changed_at: v.optional(v.number()),
  archived_at: v.optional(v.number()),
  archivedAt: v.optional(v.number()),
  company_id: v.optional(v.id('companies')),
  created_by: v.optional(v.id('users')),
  updated_at: v.number(),
  created_at: v.number(),
})

export const list = query({
  args: {
    status: v.optional(cageStatus),
    locationId: v.optional(v.id('farmLocations')),
    /** Archived units are left out unless asked for. */
    includeArchived: v.optional(v.boolean()),
    filter: v.optional(
      v.union(
        v.literal('all'),
        v.literal('active'),
        v.literal('maintenance'),
        v.literal('harvest-ready'),
      ),
    ),
  },
  returns: v.array(cageRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    let cages = await scopedRows(ctx, user, 'cages', { locationId: args.locationId })
    if (!args.includeArchived) cages = cages.filter((c) => !c.archivedAt)

    if (args.status) {
      cages = cages.filter((c) => c.status === args.status)
    } else if (args.filter && args.filter !== 'all') {
      if (args.filter === 'active') {
        cages = cages.filter((c) => c.status === 'active')
      } else if (args.filter === 'maintenance') {
        cages = cages.filter((c) => c.status === 'maintenance')
      } else if (args.filter === 'harvest-ready') {
        const company = user.companyId ? await ctx.db.get(user.companyId) : null
        const target = mergeSettings(company?.settings).farmRules.targetHarvestAbwG
        cages = cages.filter(
          (c) => c.status === 'active' && (c.currentWeight ?? 0) >= target,
        )
      }
    }

    return cages.map(toClient).sort((a, b) => a.name.localeCompare(b.name))
  },
})

export const get = query({
  args: { id: v.id('cages') },
  returns: v.union(cageRow, v.null()),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const cage = await ctx.db.get(id)
    if (!cage) return null
    const allowed = await listForCompany(user, [cage])
    if (!allowed.length) return null
    return toClient(cage)
  },
})

export const getActive = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  returns: v.array(cageRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const cages = await activeCages(ctx, user, args.locationId)
    return cages.map(toClient)
  },
})

/** Growth for the cage's current cycle: ABW, biomass, feed, eFCR, SGR, ADG. */
export const growth = query({
  args: {
    id: v.id('cages'),
    /** Client's today (YYYY-MM-DD); days of culture count to here. */
    asOf: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      batch_id: v.null(),
      source: v.literal('legacy'),
      definitions_version: v.number(),
      stocking_id: v.union(v.id('stockingHistory'), v.null()),
      batch_number: v.union(v.string(), v.null()),
      stocking_date: v.union(v.string(), v.null()),
      cycle_closed: v.boolean(),
      days_of_culture: v.union(v.number(), v.null()),
      stocked_count: v.number(),
      live_count: v.number(),
      mortality: v.number(),
      survival_pct: v.union(v.number(), v.null()),
      initial_abw_g: v.union(v.number(), v.null()),
      current_abw_g: v.union(v.number(), v.null()),
      abw_measured_on: v.union(v.string(), v.null()),
      initial_biomass_kg: v.union(v.number(), v.null()),
      current_biomass_kg: v.union(v.number(), v.null()),
      feed_kg: v.union(v.number(), v.null()),
      feed_cost: v.union(v.number(), v.null()),
      efcr: v.union(v.number(), v.null()),
      sgr_pct_day: v.union(v.number(), v.null()),
      adg_g_day: v.union(v.number(), v.null()),
    }),
    v.object({
      stocking_id: v.union(v.id('stockingHistory'), v.null()),
      batch_id: v.id('batches'),
      batch_number: v.string(),
      stocking_date: v.union(v.string(), v.null()),
      cycle_closed: v.boolean(),
      days_of_culture: v.union(v.number(), v.null()),
      stocked_count: v.number(),
      live_count: v.number(),
      mortality: v.number(),
      survival_pct: v.union(v.number(), v.null()),
      mortality_pct: v.union(v.number(), v.null()),
      harvested_count: v.number(),
      harvested_kg: v.number(),
      unaccounted: v.number(),
      initial_abw_g: v.union(v.number(), v.null()),
      current_abw_g: v.union(v.number(), v.null()),
      abw_measured_on: v.union(v.string(), v.null()),
      initial_biomass_kg: v.number(),
      current_biomass_kg: v.number(),
      gain_kg: v.number(),
      feed_kg: v.number(),
      feed_cost: v.number(),
      efcr: v.union(v.number(), v.null()),
      biological_fcr: v.union(v.number(), v.null()),
      sgr_pct_day: v.union(v.number(), v.null()),
      adg_g_day: v.union(v.number(), v.null()),
      source: v.literal('ledger'),
      definitions_version: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { id, asOf }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const cage = await ctx.db.get(id)
    if (!cage) return null
    const allowed = await listForCompany(user, [cage])
    if (!allowed.length) return null
    return await cageGrowth(ctx, cage, asOf || undefined)
  },
})

/**
 * Farm-wide growth across active cages: each cage's cycle plus a combined
 * eFCR (total feed ÷ total biomass gained), so one bad cage can't hide.
 */
export const growthAll = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    /** Client's today (YYYY-MM-DD); days of culture count to here. */
    asOf: v.optional(v.string()),
  },
  returns: v.object({
    cages: v.array(
      v.union(
        v.object({
          batch_id: v.null(),
          source: v.literal('legacy'),
          definitions_version: v.number(),
          stocking_id: v.union(v.id('stockingHistory'), v.null()),
          batch_number: v.union(v.string(), v.null()),
          stocking_date: v.union(v.string(), v.null()),
          cycle_closed: v.boolean(),
          days_of_culture: v.union(v.number(), v.null()),
          stocked_count: v.number(),
          live_count: v.number(),
          mortality: v.number(),
          survival_pct: v.union(v.number(), v.null()),
          initial_abw_g: v.union(v.number(), v.null()),
          current_abw_g: v.union(v.number(), v.null()),
          abw_measured_on: v.union(v.string(), v.null()),
          initial_biomass_kg: v.union(v.number(), v.null()),
          current_biomass_kg: v.union(v.number(), v.null()),
          feed_kg: v.union(v.number(), v.null()),
          feed_cost: v.union(v.number(), v.null()),
          efcr: v.union(v.number(), v.null()),
          sgr_pct_day: v.union(v.number(), v.null()),
          adg_g_day: v.union(v.number(), v.null()),
          cage_id: v.id('cages'),
          cage_name: v.string(),
        }),
        v.object({
          stocking_id: v.union(v.id('stockingHistory'), v.null()),
          batch_id: v.id('batches'),
          batch_number: v.string(),
          stocking_date: v.union(v.string(), v.null()),
          cycle_closed: v.boolean(),
          days_of_culture: v.union(v.number(), v.null()),
          stocked_count: v.number(),
          live_count: v.number(),
          mortality: v.number(),
          survival_pct: v.union(v.number(), v.null()),
          mortality_pct: v.union(v.number(), v.null()),
          harvested_count: v.number(),
          harvested_kg: v.number(),
          unaccounted: v.number(),
          initial_abw_g: v.union(v.number(), v.null()),
          current_abw_g: v.union(v.number(), v.null()),
          abw_measured_on: v.union(v.string(), v.null()),
          initial_biomass_kg: v.number(),
          current_biomass_kg: v.number(),
          gain_kg: v.number(),
          feed_kg: v.number(),
          feed_cost: v.number(),
          efcr: v.union(v.number(), v.null()),
          biological_fcr: v.union(v.number(), v.null()),
          sgr_pct_day: v.union(v.number(), v.null()),
          adg_g_day: v.union(v.number(), v.null()),
          source: v.literal('ledger'),
          definitions_version: v.number(),
          cage_id: v.id('cages'),
          cage_name: v.string(),
        }),
      ),
    ),
    farm_efcr: v.union(v.number(), v.null()),
    farm_biomass_kg: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    // Every active cage of the company (was the first 300 active cages of
    // all tenants, so cages went missing as the platform grew).
    const cages = await activeCages(ctx, user, args.locationId)
    const rows = []
    let feed = 0
    let gain = 0
    for (const cage of cages) {
      const g = await cageGrowth(ctx, cage, args.asOf || undefined)
      rows.push({ cage_id: cage._id, cage_name: cage.name, ...g })
      if (!g.stocking_date) continue
      // Pooled: every cage's feed and gain count, poor performers included (C7).
      feed += g.feed_kg ?? 0
      gain += 'gain_kg' in g ? g.gain_kg : (g.current_biomass_kg ?? 0) - (g.initial_biomass_kg ?? 0)
    }
    return {
      cages: rows,
      farm_efcr: feed > 0 && gain > 0 ? Math.round((feed / gain) * 100) / 100 : null,
      farm_biomass_kg: Math.round(rows.reduce((s, r) => s + (r.current_biomass_kg ?? 0), 0)),
    }
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    code: v.optional(v.string()),
    location: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    size: v.optional(v.number()),
    capacity: v.optional(v.number()),
    dimensions: v.optional(v.string()),
    material: v.optional(v.string()),
    installationDate: v.optional(v.string()),
    stockingDate: v.optional(v.string()),
    initialCount: v.optional(v.number()),
    initialAbw: v.optional(v.number()),
    initialBiomass: v.optional(v.number()),
    status: v.optional(cageStatus),
    notes: v.optional(v.string()),
    custom: v.optional(customValues),
    ...geometryArgs,
  },
  returns: v.id('cages'),
  handler: async (ctx, rawArgs) => {
    const args = normalizeGeometry(rawArgs)
    const { user } = await requireMember(ctx, { permission: 'production.units.manage' })
    const now = Date.now()
    await ensureDefaultLocation(ctx, user)
    const locationId =
      (await writeLocationId(ctx, user, args.locationId)) ||
      (await ensureDefaultLocation(ctx, user))
    const loc = await ctx.db.get(locationId)
    await assertUnitLinks(ctx, user, args)
    const initialStatus = args.status ?? 'empty'
    if (STOCKED.has(initialStatus) && !(args.initialCount && args.initialCount > 0)) {
      throw new Error('A new unit can only start stocked with an initial fish count; stock it instead.')
    }
    const custom = await validateCustom(ctx, {
      companyId: user.companyId,
      entity: 'cages',
      custom: args.custom,
      mode: 'create',
      context: { locationId, core: { ...args, status: initialStatus } },
    })
    const id = await ctx.db.insert('cages', {
      custom,
      name: args.name,
      code: args.code,
      location: args.location || loc?.name,
      locationId,
      size: args.size,
      capacity: args.capacity,
      dimensions: args.dimensions,
      material: args.material,
      installationDate: args.installationDate,
      stockingDate: args.stockingDate,
      initialCount: args.initialCount,
      currentCount: args.initialCount,
      initialAbw: args.initialAbw,
      initialBiomass: args.initialBiomass,
      status: initialStatus,
      statusChangedAt: now,
      notes: args.notes,
      unitType: args.unitType,
      areaM2: args.areaM2,
      depthM: args.depthM,
      volumeM3: args.volumeM3,
      diameterM: args.diameterM,
      unitGroup: args.unitGroup,
      unitGroupId: args.unitGroupId,
      waterBodyId: args.waterBodyId,
      latitude: args.latitude,
      longitude: args.longitude,
      netVolumeM3: args.netVolumeM3,
      meshSizeMm: args.meshSizeMm,
      lengthM: args.lengthM,
      widthM: args.widthM,
      flowM3h: args.flowM3h,
      waterSource: args.waterSource,
      maxDensity: args.maxDensity,
      companyId: await writeCompanyId(user),
      createdBy: user._id,
      updatedAt: now,
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'cages',
      recordId: id,
      newValues: args,
      locationId,
    })
    return id
  },
})

export const update = mutation({
  args: {
    id: v.id('cages'),
    patch: v.object({
      name: v.optional(v.string()),
      location: v.optional(v.string()),
      locationId: v.optional(v.id('farmLocations')),
      size: v.optional(v.number()),
      capacity: v.optional(v.number()),
      dimensions: v.optional(v.string()),
      material: v.optional(v.string()),
      installationDate: v.optional(v.string()),
      stockingDate: v.optional(v.string()),
      initialCount: v.optional(v.number()),
      currentCount: v.optional(v.number()),
      initialAbw: v.optional(v.number()),
      initialBiomass: v.optional(v.number()),
      initialWeight: v.optional(v.number()),
      currentWeight: v.optional(v.number()),
      growthRate: v.optional(v.number()),
      mortalityRate: v.optional(v.number()),
      lastMaintenanceDate: v.optional(v.string()),
      nextMaintenanceDate: v.optional(v.string()),
      status: v.optional(cageStatus),
      notes: v.optional(v.string()),
      custom: v.optional(customValues),
      ...geometryArgs,
    }),
  },
  returns: v.id('cages'),
  handler: async (ctx, { id, patch: rawPatch }) => {
    const patch = normalizeGeometry(rawPatch)
    const { user } = await requireMember(ctx, { permission: 'production.units.manage' })
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Cage not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')
    // Fish counts drive mortality %, biomass and P&L — only admins correct them by hand.
    if (patch.currentCount !== undefined || patch.initialCount !== undefined) {
      await assertUserCan(ctx, user, 'production.stock.adjust')
    }
    // Status is normally set by stocking and harvest; changing it by hand
    // skips their checks (doc 07 V9): admin only.
    const statusChanges = patch.status !== undefined && patch.status !== existing.status
    if (statusChanges) {
      await assertUserCan(ctx, user, 'production.stock.adjust')
      // PROD-013: only allowed transitions, and fish counts must agree.
      assertTransition(
        existing.status as UnitStatus,
        patch.status as UnitStatus,
        patch.currentCount ?? existing.currentCount ?? 0,
      )
    }
    if (existing.archivedAt) throw new Error('This unit is archived; restore it first')
    await assertUnitLinks(ctx, user, patch)

    const next: Record<string, unknown> = { ...patch, updatedAt: Date.now() }
    if (patch.custom !== undefined) {
      next.custom = await validateCustom(ctx, {
        companyId: existing.companyId,
        entity: 'cages',
        custom: patch.custom,
        previous: existing.custom,
        mode: 'update',
        context: { locationId: patch.locationId ?? existing.locationId, core: { ...existing, ...patch } },
      })
    }
    if (statusChanges) next.statusChangedAt = Date.now()
    if (patch.locationId) {
      const locationId = await writeLocationId(ctx, user, patch.locationId)
      next.locationId = locationId
      const loc = locationId ? await ctx.db.get(locationId) : null
      if (loc && patch.location === undefined) next.location = loc.name
    }

    const countEdited = patch.currentCount !== undefined && patch.currentCount !== (existing.currentCount ?? 0)
    const write = countEdited ? await beginStockWrite(ctx, [existing], user._id) : null
    await ctx.db.patch(id, next)
    // A hand-corrected count becomes a labelled ledger adjustment, which sets
    // the count once the engine owns the cage (PROD-004).
    if (write) {
      await write.post((o) =>
        shadowCountEdit(
          ctx,
          existing,
          existing.currentCount ?? 0,
          patch.currentCount!,
          user._id,
          new Date().toISOString().slice(0, 10),
          o,
        ),
      )
    }
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'cages',
      recordId: id,
      previousValues: existing,
      newValues: patch,
      locationId: (next.locationId as any) || existing.locationId,
    })
    return id
  },
})

/**
 * Archive a unit (PROD-013: no hard delete). Its records, batches and ledger
 * keep pointing at it; it leaves pickers and lists. Refused while it holds fish.
 */
export const remove = mutation({
  args: { id: v.id('cages') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.units.delete' })
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Cage not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')
    if ((existing.currentCount ?? 0) > 0 || existing.status === 'active' || existing.status === 'harvesting') {
      throw new Error('Harvest or transfer the fish before archiving this unit')
    }
    if (existing.archivedAt) return
    const now = Date.now()
    await ctx.db.patch(id, { archivedAt: now, updatedAt: now })
    await logAudit(ctx, {
      actionType: 'archive',
      tableName: 'cages',
      recordId: id,
      previousValues: existing,
      newValues: { archivedAt: now },
      locationId: existing.locationId,
    })
  },
})

/** Bring an archived unit back. */
export const restore = mutation({
  args: { id: v.id('cages') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.units.delete' })
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Cage not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')
    if (!existing.archivedAt) return
    await ctx.db.patch(id, { archivedAt: undefined, updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'restore',
      tableName: 'cages',
      recordId: id,
      previousValues: { archivedAt: existing.archivedAt },
      locationId: existing.locationId,
    })
  },
})

export const analytics = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  returns: v.object({ total: v.number(), active: v.number(), maintenance: v.number(), empty: v.number(), harvested: v.number(), utilizationRate: v.string() }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const cages = (await scopedRows(ctx, user, 'cages', { locationId: args.locationId })).filter(
      (c) => !c.archivedAt,
    )
    const total = cages.length

    const active = cages.filter((c) => c.status === 'active').length
    const maintenance = cages.filter((c) => c.status === 'maintenance').length
    const empty = cages.filter((c) => c.status === 'empty').length
    const harvested = cages.filter((c) => c.status === 'harvested').length
    return {
      total,
      active,
      maintenance,
      empty,
      harvested,
      utilizationRate: total ? ((active / total) * 100).toFixed(1) : '0',
    }
  },
})
