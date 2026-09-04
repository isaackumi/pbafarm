import { v } from 'convex/values'
import { query, mutation, internalMutation } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import {
  listForCompany,
  writeCompanyId,
  logAudit,
  ensureDefaultLocation,
  assertLocationAccess,
} from './lib/tenancy'
import { Id } from './_generated/dataModel'

function toClient(loc: any) {
  return {
    id: loc._id,
    _id: loc._id,
    name: loc.name,
    code: loc.code,
    address: loc.address,
    active: loc.active !== false,
    notes: loc.notes,
    company_id: loc.companyId,
    updated_at: loc.updatedAt,
    created_at: loc._creationTime,
  }
}

export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let rows = await ctx.db.query('farmLocations').collect()
    rows = await listForCompany(user, rows)

    if ((user.role ?? 'user') !== 'super_admin' && (user.role ?? 'user') !== 'admin') {
      const assigned = user.locationIds
      if (assigned && assigned.length > 0) {
        rows = rows.filter((r) => assigned.includes(r._id))
      }
    }

    if (!args.includeInactive) {
      rows = rows.filter((r) => r.active !== false)
    }

    return rows.map(toClient).sort((a, b) => a.name.localeCompare(b.name))
  },
})

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    if (!user.activeLocationId) return null
    const loc = await ctx.db.get(user.activeLocationId)
    if (!loc) return null
    const allowed = await listForCompany(user, [loc])
    if (!allowed.length) return null
    try {
      assertLocationAccess(user, loc._id)
    } catch {
      return null
    }
    return toClient(loc)
  },
})

export const ensureDefault = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    const id = await ensureDefaultLocation(ctx, user)
    return id
  },
})

export const setActiveLocation = mutation({
  args: { locationId: v.id('farmLocations') },
  handler: async (ctx, { locationId }) => {
    const user = await requireUser(ctx)
    const loc = await ctx.db.get(locationId)
    if (!loc || loc.active === false) {
      throw new Error('Farm location not found or inactive')
    }
    const allowed = await listForCompany(user, [loc])
    if (!allowed.length) throw new Error('Access denied')
    assertLocationAccess(user, locationId)
    await ctx.db.patch(user._id, { activeLocationId: locationId })
    return locationId
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    code: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    const name = args.name.trim()
    if (!name) throw new Error('Name is required')

    const companyId = await writeCompanyId(user)
    const id = await ctx.db.insert('farmLocations', {
      companyId,
      name,
      code: args.code?.trim() || undefined,
      address: args.address?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      active: args.active !== false,
      updatedAt: Date.now(),
    })

    if (!user.activeLocationId) {
      await ctx.db.patch(user._id, { activeLocationId: id })
    }

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'farmLocations',
      recordId: id,
      newValues: args,
      locationId: id,
    })
    return id
  },
})

export const update = mutation({
  args: {
    id: v.id('farmLocations'),
    patch: v.object({
      name: v.optional(v.string()),
      code: v.optional(v.string()),
      address: v.optional(v.string()),
      notes: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Location not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    const next: Record<string, unknown> = { updatedAt: Date.now() }
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (!name) throw new Error('Name is required')
      next.name = name
    }
    if (patch.code !== undefined) next.code = patch.code.trim() || undefined
    if (patch.address !== undefined)
      next.address = patch.address.trim() || undefined
    if (patch.notes !== undefined) next.notes = patch.notes.trim() || undefined
    if (patch.active !== undefined) next.active = patch.active

    await ctx.db.patch(id, next)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'farmLocations',
      recordId: id,
      previousValues: existing,
      newValues: patch,
      locationId: id,
    })
    return id
  },
})

const LOCATION_TABLES = [
  'cages',
  'stockingHistory',
  'topupHistory',
  'dailyRecords',
  'biweeklyRecords',
  'harvestRecords',
  'harvestSampling',
  'feedPurchases',
  'feedUsage',
  'feedInventory',
  'feedInventoryTransactions',
] as const

/**
 * One-shot: create Main farm per company (and greenfield), backfill ops rows,
 * and optionally promote distinct cage.location strings into extra sites.
 */
export const backfillLocations = mutation({
  args: {
    promoteCageLocationStrings: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')

    const companies = await ctx.db.query('companies').collect()
    const companyIds = new Set(
      companies.filter((c) => c.status === 'approved').map((c) => c._id),
    )

    const defaultByCompany = new Map<string, Id<'farmLocations'>>()
    let createdLocations = 0

    async function ensureForCompany(companyId: Id<'companies'> | undefined) {
      const key = companyId ? String(companyId) : '__none__'
      if (defaultByCompany.has(key)) return defaultByCompany.get(key)!

      let locs = companyId
        ? await ctx.db
            .query('farmLocations')
            .withIndex('by_company', (q) => q.eq('companyId', companyId))
            .collect()
        : (await ctx.db.query('farmLocations').collect()).filter(
            (l) => !l.companyId,
          )

      let main = locs.find((l) => l.active !== false)
      if (!main) {
        const id = await ctx.db.insert('farmLocations', {
          companyId,
          name: 'Main farm',
          code: 'MAIN',
          active: true,
          notes: 'Default location (backfill)',
          updatedAt: Date.now(),
        })
        createdLocations++
        main = (await ctx.db.get(id))!
      }
      defaultByCompany.set(key, main._id)
      return main._id
    }

    for (const companyId of companyIds) {
      await ensureForCompany(companyId)
    }
    await ensureForCompany(undefined)

    // Promote distinct cage free-text locations into sites (optional)
    const stringToLocation = new Map<string, Id<'farmLocations'>>()
    if (args.promoteCageLocationStrings) {
      const cages = await ctx.db.query('cages').collect()
      for (const cage of cages) {
        const label = (cage.location || '').trim()
        if (!label) continue
        const key = `${cage.companyId || ''}::${label.toLowerCase()}`
        if (stringToLocation.has(key)) continue
        const existing = cage.companyId
          ? await ctx.db
              .query('farmLocations')
              .withIndex('by_company', (q) =>
                q.eq('companyId', cage.companyId!),
              )
              .collect()
          : (await ctx.db.query('farmLocations').collect()).filter(
              (l) => !l.companyId,
            )
        const match = existing.find(
          (l) => l.name.toLowerCase() === label.toLowerCase(),
        )
        if (match) {
          stringToLocation.set(key, match._id)
          continue
        }
        const id = await ctx.db.insert('farmLocations', {
          companyId: cage.companyId,
          name: label,
          active: true,
          notes: 'Created from cage location text',
          updatedAt: Date.now(),
        })
        createdLocations++
        stringToLocation.set(key, id)
      }
    }

    let patched = 0
    for (const table of LOCATION_TABLES) {
      const rows = await ctx.db.query(table).collect()
      for (const row of rows) {
        if (row.locationId) continue
        let locationId = await ensureForCompany(row.companyId)

        if (
          args.promoteCageLocationStrings &&
          table === 'cages' &&
          'location' in row &&
          row.location
        ) {
          const key = `${row.companyId || ''}::${String(row.location).trim().toLowerCase()}`
          locationId = stringToLocation.get(key) || locationId
        }

        await ctx.db.patch(row._id, { locationId })
        patched++
      }
    }

    // Point users without activeLocationId at their company default
    const users = await ctx.db.query('users').collect()
    let usersUpdated = 0
    for (const u of users) {
      if (u.activeLocationId) continue
      if (!u.companyId && (u.role ?? 'user') === 'super_admin') continue
      const locId = await ensureForCompany(u.companyId)
      await ctx.db.patch(u._id, { activeLocationId: locId })
      usersUpdated++
    }

    await logAudit(ctx, {
      actionType: 'backfill',
      tableName: 'farmLocations',
      newValues: { createdLocations, patched, usersUpdated },
    })

    return { createdLocations, patched, usersUpdated }
  },
})

/** Internal helper for company approve flow. */
export const ensureForCompanyInternal = internalMutation({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const existing = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .collect()
    if (existing.some((l) => l.active !== false)) {
      return existing.find((l) => l.active !== false)!._id
    }
    return await ctx.db.insert('farmLocations', {
      companyId,
      name: 'Main farm',
      code: 'MAIN',
      active: true,
      notes: 'Default location',
      updatedAt: Date.now(),
    })
  },
})
