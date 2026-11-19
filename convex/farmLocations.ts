import { insertAuditLog } from './lib/auditChain'
import { v } from 'convex/values'
import { query, mutation, internalMutation } from './_generated/server'
import { scopedRows } from './lib/scope'
import {
  listForCompany,
  writeCompanyId,
  logAudit,
  ensureDefaultLocation,
  assertLocationAccess,
} from './lib/tenancy'
import type { Doc, Id } from './_generated/dataModel'
import { siteTypeValidator } from './schema'
import { isValidTimezone } from './lib/orgProfile'
import { requireMember } from './lib/permissions'
import { validateCustom } from './lib/customFields'
import { customValues } from './schema'

/** Site metadata args (FARM-001). */
const siteArgs = {
  siteType: v.optional(siteTypeValidator),
  /** IANA zone; empty string clears it (falls back to the company's). */
  timezone: v.optional(v.string()),
  latitude: v.optional(v.union(v.number(), v.null())),
  longitude: v.optional(v.union(v.number(), v.null())),
  waterBody: v.optional(v.string()),
}

/** Validated site metadata patch; undefined keys are left alone. */
function siteFields(args: {
  siteType?: any
  timezone?: string
  latitude?: number | null
  longitude?: number | null
  waterBody?: string
}) {
  const out: Record<string, unknown> = {}
  if (args.siteType !== undefined) out.siteType = args.siteType
  if (args.timezone !== undefined) {
    const tz = args.timezone.trim()
    if (tz && !isValidTimezone(tz)) throw new Error(`Unknown time zone: ${tz}`)
    out.timezone = tz || undefined
  }
  if (args.latitude !== undefined) {
    if (args.latitude !== null && !(args.latitude >= -90 && args.latitude <= 90)) {
      throw new Error('Latitude must be between -90 and 90')
    }
    out.latitude = args.latitude ?? undefined
  }
  if (args.longitude !== undefined) {
    if (args.longitude !== null && !(args.longitude >= -180 && args.longitude <= 180)) {
      throw new Error('Longitude must be between -180 and 180')
    }
    out.longitude = args.longitude ?? undefined
  }
  if (args.waterBody !== undefined) out.waterBody = args.waterBody.trim() || undefined
  return out
}

function toClient(loc: Doc<'farmLocations'>) {
  return {
    custom: loc.custom ?? {},
    id: loc._id,
    _id: loc._id,
    name: loc.name,
    code: loc.code,
    address: loc.address,
    active: loc.active !== false,
    notes: loc.notes,
    site_type: loc.siteType ?? null,
    siteType: loc.siteType ?? null,
    timezone: loc.timezone ?? null,
    latitude: loc.latitude ?? null,
    longitude: loc.longitude ?? null,
    water_body: loc.waterBody ?? null,
    waterBody: loc.waterBody ?? null,
    businessUnitId: loc.businessUnitId ?? null,
    company_id: loc.companyId,
    updated_at: loc.updatedAt,
    created_at: loc._creationTime,
  }
}

const farmLocationRow = v.object({
  custom: v.record(v.string(), v.any()),
  id: v.id('farmLocations'),
  _id: v.id('farmLocations'),
  name: v.string(),
  code: v.optional(v.string()),
  address: v.optional(v.string()),
  active: v.boolean(),
  notes: v.optional(v.string()),
  site_type: v.union(
    v.literal('cage_farm'),
    v.literal('pond_farm'),
    v.literal('hatchery'),
    v.literal('nursery'),
    v.literal('ras_facility'),
    v.literal('mixed'),
    v.literal('store'),
    v.null(),
  ),
  siteType: v.union(
    v.literal('cage_farm'),
    v.literal('pond_farm'),
    v.literal('hatchery'),
    v.literal('nursery'),
    v.literal('ras_facility'),
    v.literal('mixed'),
    v.literal('store'),
    v.null(),
  ),
  timezone: v.union(v.string(), v.null()),
  latitude: v.union(v.number(), v.null()),
  longitude: v.union(v.number(), v.null()),
  water_body: v.union(v.string(), v.null()),
  waterBody: v.union(v.string(), v.null()),
  businessUnitId: v.union(v.id('businessUnits'), v.null()),
  company_id: v.optional(v.id('companies')),
  updated_at: v.number(),
  created_at: v.number(),
})

export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  returns: v.array(farmLocationRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.view' })
    let rows = await scopedRows(ctx, user, 'farmLocations')
    rows = await listForCompany(user, rows)

    // Members limited to some sites see only those (PERM-004).
    if ((user.role ?? 'user') !== 'super_admin') {
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
  returns: v.union(farmLocationRow, v.null()),
  handler: async (ctx) => {
    const { user } = await requireMember(ctx, { permission: 'org.view' })
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
  returns: v.union(v.id('farmLocations'), v.null()),
  handler: async (ctx) => {
    const { user } = await requireMember(ctx, { permission: 'org.view' })
    // No-op for company-less users: there is no company to give a site to.
    if (!user.companyId) return null
    const before = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', user.companyId))
      .take(1)
    const id = await ensureDefaultLocation(ctx, user)
    if (before.length === 0) {
      await logAudit(ctx, {
        actionType: 'create_default_location',
        tableName: 'farmLocations',
        recordId: id,
        locationId: id,
      })
    }
    return id
  },
})

export const setActiveLocation = mutation({
  args: { locationId: v.id('farmLocations') },
  returns: v.id('farmLocations'),
  handler: async (ctx, { locationId }) => {
    const { user } = await requireMember(ctx, { permission: 'org.view' })
    const loc = await ctx.db.get(locationId)
    if (!loc || loc.active === false) {
      throw new Error('Farm location not found or inactive')
    }
    const allowed = await listForCompany(user, [loc])
    if (!allowed.length) throw new Error('Access denied')
    assertLocationAccess(user, locationId)
    await ctx.db.patch(user._id, { activeLocationId: locationId })
    if (user.activeLocationId !== locationId) {
      await logAudit(ctx, {
        actionType: 'set_active_location',
        tableName: 'users',
        recordId: user._id,
        previousValues: { activeLocationId: user.activeLocationId },
        newValues: { activeLocationId: locationId },
        locationId,
      })
    }
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
    custom: v.optional(customValues),
    ...siteArgs,
  },
  returns: v.id('farmLocations'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.sites.manage' })
    const meta = siteFields(args)
    const name = args.name.trim()
    if (!name) throw new Error('Name is required')

    const companyId = await writeCompanyId(user)
    const custom = await validateCustom(ctx, {
      companyId,
      entity: 'farmLocations',
      custom: args.custom,
      mode: 'create',
      context: { core: args },
    })
    const id = await ctx.db.insert('farmLocations', {
      companyId,
      custom,
      name,
      code: args.code?.trim() || undefined,
      address: args.address?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      active: args.active !== false,
      ...meta,
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
      custom: v.optional(customValues),
      ...siteArgs,
    }),
  },
  returns: v.id('farmLocations'),
  handler: async (ctx, { id, patch }) => {
    const { user } = await requireMember(ctx, { permission: 'org.sites.manage' })
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
    Object.assign(next, siteFields(patch))
    if (patch.custom !== undefined) {
      next.custom = await validateCustom(ctx, {
        companyId: existing.companyId,
        entity: 'farmLocations',
        custom: patch.custom,
        previous: existing.custom,
        mode: 'update',
        context: { locationId: id, core: { ...existing, ...patch } },
      })
    }

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
 * Reads and patches every company's rows, so it is internal (SEC-002, V4):
 *   npx convex run farmLocations:backfillLocations '{"promoteCageLocationStrings":true}'
 */
export const backfillLocations = internalMutation({
  args: {
    promoteCageLocationStrings: v.optional(v.boolean()),
  },
  returns: v.object({ createdLocations: v.number(), patched: v.number(), usersUpdated: v.number() }),
  handler: async (ctx, args) => {
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

    // Run from the CLI, so there is no signed-in actor to record.
    await insertAuditLog(ctx, {
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
  returns: v.id('farmLocations'),
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
