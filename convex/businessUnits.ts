/**
 * Business units and regions (FARM-004, ENT-001; doc 04 §3.6): an optional
 * grouping between the organization and its sites. Nothing depends on it:
 * an organization with no units keeps every site directly under itself.
 *
 * - list: every member (org.view), for site pickers and filters.
 * - create/update/remove/assignSites: org.structure.manage.
 * - siteReport: per-site KPIs for reports, filtered by unit (reports.view),
 *   limited to the caller's sites.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember } from './lib/permissions'
import { logAudit } from './lib/tenancy'
import { userError } from './lib/errors'
import { isBusinessDate } from './lib/dates'
import { emptyKpis, siteKpis, totalKpis, companyCurrency } from './lib/siteKpis'

export const MAX_UNITS = 200
export const MAX_DEPTH = 3
const MAX_ASSIGN = 100

const kindV = v.union(v.literal('region'), v.literal('business_unit'))

function clean(s: string | undefined, max: number, label: string) {
  const out = s?.trim()
  if (!out) return undefined
  if (out.length > max) throw userError('VALIDATION', `${label} is too long (at most ${max} characters)`)
  return out
}

async function companyUnits(ctx: QueryCtx, companyId: Id<'companies'>) {
  return await ctx.db
    .query('businessUnits')
    .withIndex('by_companyId_and_parentId', (q) => q.eq('companyId', companyId))
    .take(MAX_UNITS)
}

async function ownUnit(ctx: QueryCtx, companyId: Id<'companies'>, id: Id<'businessUnits'>) {
  const unit = await ctx.db.get(id)
  if (!unit || unit.companyId !== companyId) throw userError('NOT_FOUND', 'Business unit not found')
  return unit
}

/** Throws when `parentId` would make a cycle or nest deeper than MAX_DEPTH. */
async function checkParent(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
  parentId: Id<'businessUnits'>,
  selfId?: Id<'businessUnits'>,
) {
  let depth = 1
  let cursor: Doc<'businessUnits'> | null = await ownUnit(ctx, companyId, parentId)
  while (cursor) {
    if (selfId && cursor._id === selfId) throw userError('VALIDATION', 'A unit cannot sit inside itself')
    depth += 1
    if (depth > MAX_DEPTH) throw userError('VALIDATION', `Units nest at most ${MAX_DEPTH} levels deep`)
    cursor = cursor.parentId ? await ctx.db.get(cursor.parentId) : null
  }
  if (selfId) {
    // Moving a unit that has children: the deepest child must still fit.
    const all = await companyUnits(ctx, companyId)
    const below = (id: Id<'businessUnits'>): number => {
      const kids = all.filter((u) => u.parentId === id)
      return kids.length ? 1 + Math.max(...kids.map((k) => below(k._id))) : 0
    }
    if (depth + below(selfId) > MAX_DEPTH) throw userError('VALIDATION', `Units nest at most ${MAX_DEPTH} levels deep`)
  }
}

/** The unit and every unit below it. */
export function descendantIds(units: Doc<'businessUnits'>[], rootId: Id<'businessUnits'>) {
  const out = new Set<Id<'businessUnits'>>([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const u of units) {
      if (u.parentId && out.has(u.parentId) && !out.has(u._id)) {
        out.add(u._id)
        grew = true
      }
    }
  }
  return out
}

/** Units of the organization with their site counts (any member). */
export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  returns: v.array(
    v.object({
      _id: v.id('businessUnits'),
      name: v.string(),
      code: v.union(v.string(), v.null()),
      kind: v.union(v.literal('region'), v.literal('business_unit')),
      parentId: v.union(v.id('businessUnits'), v.null()),
      description: v.union(v.string(), v.null()),
      active: v.boolean(),
      siteCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { companyId } = await requireMember(ctx, { permission: 'org.view' })
    if (!companyId) return []
    const units = await companyUnits(ctx, companyId)
    const sites = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(500)
    const counts = new Map<string, number>()
    for (const s of sites) if (s.businessUnitId) counts.set(s.businessUnitId, (counts.get(s.businessUnitId) ?? 0) + 1)
    return units
      .filter((u) => args.includeInactive || u.active)
      .map((u) => ({
        _id: u._id,
        name: u.name,
        code: u.code ?? null,
        kind: u.kind,
        parentId: u.parentId ?? null,
        description: u.description ?? null,
        active: u.active,
        siteCount: counts.get(u._id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    code: v.optional(v.string()),
    kind: kindV,
    parentId: v.optional(v.id('businessUnits')),
    description: v.optional(v.string()),
  },
  returns: v.id('businessUnits'),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'org.structure.manage' })
    if (!companyId) throw userError('FORBIDDEN', 'No organization')
    const name = clean(args.name, 120, 'Name')
    if (!name) throw userError('VALIDATION', 'Name is required')
    const existing = await companyUnits(ctx, companyId)
    if (existing.length >= MAX_UNITS) throw userError('VALIDATION', `At most ${MAX_UNITS} business units`)
    if (existing.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
      throw userError('DUPLICATE', 'A business unit with this name already exists')
    }
    if (args.parentId) await checkParent(ctx, companyId, args.parentId)
    const id = await ctx.db.insert('businessUnits', {
      companyId,
      name,
      code: clean(args.code, 30, 'Code'),
      kind: args.kind,
      parentId: args.parentId,
      description: clean(args.description, 500, 'Description'),
      active: true,
      updatedAt: Date.now(),
      updatedBy: user._id,
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'businessUnits', recordId: id, newValues: { ...args, name } })
    return id
  },
})

export const update = mutation({
  args: {
    id: v.id('businessUnits'),
    patch: v.object({
      name: v.optional(v.string()),
      code: v.optional(v.string()),
      kind: v.optional(kindV),
      /** null moves the unit to the top level. */
      parentId: v.optional(v.union(v.id('businessUnits'), v.null())),
      description: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { id, patch }) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'org.structure.manage' })
    if (!companyId) throw userError('FORBIDDEN', 'No organization')
    const unit = await ownUnit(ctx, companyId, id)
    const next: Partial<Doc<'businessUnits'>> = { updatedAt: Date.now(), updatedBy: user._id }
    if (patch.name !== undefined) {
      const name = clean(patch.name, 120, 'Name')
      if (!name) throw userError('VALIDATION', 'Name is required')
      const units = await companyUnits(ctx, companyId)
      if (units.some((u) => u._id !== id && u.name.toLowerCase() === name.toLowerCase())) {
        throw userError('DUPLICATE', 'A business unit with this name already exists')
      }
      next.name = name
    }
    if (patch.code !== undefined) next.code = clean(patch.code, 30, 'Code')
    if (patch.kind !== undefined) next.kind = patch.kind
    if (patch.description !== undefined) next.description = clean(patch.description, 500, 'Description')
    if (patch.active !== undefined) next.active = patch.active
    if (patch.parentId !== undefined) {
      if (patch.parentId) await checkParent(ctx, companyId, patch.parentId, id)
      next.parentId = patch.parentId ?? undefined
    }
    await ctx.db.patch(id, next)
    await logAudit(ctx, { actionType: 'update', tableName: 'businessUnits', recordId: id, previousValues: unit, newValues: patch })
    return null
  },
})

/** Delete a unit with no sites and no units below it. */
export const remove = mutation({
  args: { id: v.id('businessUnits') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { companyId } = await requireMember(ctx, { permission: 'org.structure.manage' })
    if (!companyId) throw userError('FORBIDDEN', 'No organization')
    const unit = await ownUnit(ctx, companyId, id)
    const child = await ctx.db
      .query('businessUnits')
      .withIndex('by_companyId_and_parentId', (q) => q.eq('companyId', companyId).eq('parentId', id))
      .first()
    if (child) throw userError('CONFLICT', 'Move or delete the units inside it first')
    const sites = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(500)
    if (sites.some((s) => s.businessUnitId === id)) throw userError('CONFLICT', 'Move its sites to another unit first')
    await ctx.db.delete(id)
    await logAudit(ctx, { actionType: 'delete', tableName: 'businessUnits', recordId: id, previousValues: unit })
    return null
  },
})

async function assign(ctx: MutationCtx, companyId: Id<'companies'>, siteIds: Id<'farmLocations'>[], unitId: Id<'businessUnits'> | undefined) {
  for (const siteId of siteIds) {
    const site = await ctx.db.get(siteId)
    if (!site || site.companyId !== companyId) throw userError('NOT_FOUND', 'Site not found')
    if (site.businessUnitId !== unitId) await ctx.db.patch(siteId, { businessUnitId: unitId, updatedAt: Date.now() })
  }
}

/** Put sites in a unit (null = directly under the organization). */
export const assignSites = mutation({
  args: {
    businessUnitId: v.union(v.id('businessUnits'), v.null()),
    siteIds: v.array(v.id('farmLocations')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { companyId } = await requireMember(ctx, { permission: 'org.structure.manage' })
    if (!companyId) throw userError('FORBIDDEN', 'No organization')
    if (args.siteIds.length > MAX_ASSIGN) throw userError('VALIDATION', `At most ${MAX_ASSIGN} sites at a time`)
    if (args.businessUnitId) await ownUnit(ctx, companyId, args.businessUnitId)
    await assign(ctx, companyId, [...new Set(args.siteIds)], args.businessUnitId ?? undefined)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'farmLocations',
      newValues: { businessUnitId: args.businessUnitId, siteIds: args.siteIds },
    })
    return null
  },
})

const unassignedRow = v.object({
  activeUnits: v.number(),
  fish: v.number(),
  salesAmount: v.number(),
  salesCount: v.number(),
  harvestKg: v.number(),
  expensesAmount: v.number(),
  overdueMaintenance: v.number(),
})

/**
 * KPIs per site for `from`..`to`, optionally only the sites of one unit (and
 * the units below it). Members limited to some sites see only those.
 */
export const siteReport = query({
  args: {
    from: v.string(),
    to: v.string(),
    businessUnitId: v.optional(v.id('businessUnits')),
  },
  returns: v.union(
    v.object({
      currency: v.string(),
      truncated: v.boolean(),
      units: v.array(
        v.object({
          _id: v.id('businessUnits'),
          name: v.string(),
          kind: v.union(v.literal('region'), v.literal('business_unit')),
          parentId: v.union(v.id('businessUnits'), v.null()),
        }),
      ),
      sites: v.array(
        v.object({
          activeUnits: v.number(),
          fish: v.number(),
          salesAmount: v.number(),
          salesCount: v.number(),
          harvestKg: v.number(),
          expensesAmount: v.number(),
          overdueMaintenance: v.number(),
          siteId: v.id('farmLocations'),
          name: v.string(),
          businessUnitId: v.union(v.id('businessUnits'), v.null()),
        }),
      ),
      unassigned: unassignedRow,
      totals: unassignedRow,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'reports.view' })
    if (!m.companyId) return null
    if (!isBusinessDate(args.from) || !isBusinessDate(args.to) || args.from > args.to) {
      throw userError('VALIDATION', 'Choose a valid date range')
    }
    const companyId = m.companyId
    const units = await companyUnits(ctx, companyId)
    const allowedUnits = args.businessUnitId
      ? descendantIds(units, (await ownUnit(ctx, companyId, args.businessUnitId))._id)
      : null
    const siteRows = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(500)
    const siteUnit = new Map(siteRows.map((s) => [s._id as string, s.businessUnitId]))
    const inScope = (siteId: Id<'farmLocations'> | undefined) => {
      if (allowedUnits) {
        const u = siteId ? siteUnit.get(siteId) : undefined
        if (!u || !allowedUnits.has(u)) return false
      }
      if (m.siteScope === 'all') return true
      return !!siteId && m.siteScope.has(siteId)
    }
    const { sites, bySite, truncated } = await siteKpis(ctx, companyId, { from: args.from, to: args.to }, inScope)
    const company = await ctx.db.get(companyId)
    return {
      currency: companyCurrency(company),
      truncated,
      units: units.map((u) => ({ _id: u._id, name: u.name, kind: u.kind, parentId: u.parentId ?? null })),
      sites: sites
        .map((s) => ({
          siteId: s._id,
          name: s.name,
          businessUnitId: s.businessUnitId ?? null,
          ...(bySite.get(s._id) ?? emptyKpis()),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      unassigned: bySite.get('') ?? emptyKpis(),
      totals: totalKpis(bySite),
    }
  },
})
