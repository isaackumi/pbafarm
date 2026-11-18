import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import { cageCycleGrowth } from './lib/growth'
import { mergeSettings } from './lib/farmRules'
import { listForCompany, listForCompanyAndLocation, writeCompanyId, writeLocationId, ensureDefaultLocation, logAudit } from './lib/tenancy'

const cageStatus = v.union(
  v.literal('active'),
  v.literal('harvested'),
  v.literal('harvesting'),
  v.literal('maintenance'),
  v.literal('fallow'),
  v.literal('empty'),
)

function toClient(cage: any) {
  return {
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
    company_id: cage.companyId,
    created_by: cage.createdBy,
    updated_at: cage.updatedAt,
    created_at: cage._creationTime,
  }
}

export const list = query({
  args: {
    status: v.optional(cageStatus),
    locationId: v.optional(v.id('farmLocations')),
    filter: v.optional(
      v.union(
        v.literal('all'),
        v.literal('active'),
        v.literal('maintenance'),
        v.literal('harvest-ready'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let cages = await ctx.db.query('cages').collect()
    cages = await listForCompanyAndLocation(user, cages, args.locationId)

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
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(id)
    if (!cage) return null
    const allowed = await listForCompany(user, [cage])
    if (!allowed.length) return null
    return toClient(cage)
  },
})

export const getActive = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let cages = await ctx.db
      .query('cages')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .collect()
    cages = await listForCompanyAndLocation(user, cages, args.locationId)
    return cages.map(toClient)
  },
})

/** Growth for the cage's current cycle: ABW, biomass, feed, eFCR, SGR, ADG. */
export const growth = query({
  args: { id: v.id('cages') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(id)
    if (!cage) return null
    const allowed = await listForCompany(user, [cage])
    if (!allowed.length) return null
    return await cageCycleGrowth(ctx, cage)
  },
})

/**
 * Farm-wide growth across active cages: each cage's cycle plus a combined
 * eFCR (total feed ÷ total biomass gained), so one bad cage can't hide.
 */
export const growthAll = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let cages = await ctx.db
      .query('cages')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .take(300)
    cages = await listForCompanyAndLocation(user, cages, args.locationId)
    const rows = []
    let feed = 0
    let gain = 0
    for (const cage of cages) {
      const g = await cageCycleGrowth(ctx, cage)
      rows.push({ cage_id: cage._id, cage_name: cage.name, ...g })
      const cageGain = (g.current_biomass_kg ?? 0) - (g.initial_biomass_kg ?? 0)
      if (g.stocking_date && cageGain > 0) {
        feed += g.feed_kg ?? 0
        gain += cageGain
      }
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
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const now = Date.now()
    await ensureDefaultLocation(ctx, user)
    const locationId =
      (await writeLocationId(ctx, user, args.locationId)) ||
      (await ensureDefaultLocation(ctx, user))
    const loc = await ctx.db.get(locationId)
    const id = await ctx.db.insert('cages', {
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
      status: args.status ?? 'empty',
      notes: args.notes,
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
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Cage not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')
    // Fish counts drive mortality %, biomass and P&L — only admins correct them by hand.
    if (patch.currentCount !== undefined || patch.initialCount !== undefined) {
      requireRole(user, 'admin')
    }
    // Status is normally set by stocking and harvest; changing it by hand
    // skips their checks (doc 07 V9): admin only.
    if (patch.status !== undefined && patch.status !== existing.status) {
      requireRole(user, 'admin')
    }

    const next: Record<string, unknown> = { ...patch, updatedAt: Date.now() }
    if (patch.locationId) {
      const locationId = await writeLocationId(ctx, user, patch.locationId)
      next.locationId = locationId
      const loc = locationId ? await ctx.db.get(locationId) : null
      if (loc && patch.location === undefined) next.location = loc.name
    }

    await ctx.db.patch(id, next)
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

export const remove = mutation({
  args: { id: v.id('cages') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Cage not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')
    await ctx.db.delete(id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'cages',
      recordId: id,
      previousValues: existing,
    })
  },
})

export const analytics = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let cages = await ctx.db.query('cages').collect()
    cages = await listForCompanyAndLocation(user, cages, args.locationId)
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
