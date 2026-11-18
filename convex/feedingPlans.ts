/**
 * Feeding plans (PROD-015, d14 §3): a feed table per species — ABW band →
 * % body weight per day, feedings per day, pellet size — and the ration each
 * stocked unit should get today (live count × ABW × table). Species without a
 * saved table use the built-in defaults in lib/ration (tilapia, catfish).
 *
 * Read-only for production: suggestions never write feed records or stock.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember, type MemberContext } from './lib/permissions'
import { userError } from './lib/errors'
import { logAudit } from './lib/tenancy'
import {
  DEFAULT_FEED_TABLES,
  RATION_LIMITS,
  SPECIES_KEY_PATTERN,
  bandProblems,
  rationFor,
  type FeedBand,
} from './lib/ration'
import { feedBand } from './schema'

const MAX_PLANS = 60

async function savedPlans(ctx: QueryCtx, companyId: Id<'companies'>) {
  return await ctx.db
    .query('feedingPlans')
    .withIndex('by_companyId_and_speciesKey', (q) => q.eq('companyId', companyId))
    .take(MAX_PLANS)
}

async function savedPlan(ctx: QueryCtx, companyId: Id<'companies'>, speciesKey: string) {
  return await ctx.db
    .query('feedingPlans')
    .withIndex('by_companyId_and_speciesKey', (q) => q.eq('companyId', companyId).eq('speciesKey', speciesKey))
    .unique()
}

/** speciesKey → bands: saved tables first, then the built-in defaults. */
async function tablesFor(ctx: QueryCtx, companyId: Id<'companies'>) {
  const out = new Map<string, FeedBand[]>()
  for (const [k, t] of Object.entries(DEFAULT_FEED_TABLES)) out.set(k, t.bands)
  for (const p of await savedPlans(ctx, companyId)) out.set(p.speciesKey, p.bands)
  return out
}

/** Every species the organization can plan for, with its table (saved or default) or none. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'production.view' })
    if (!m.companyId) return []
    const companyId = m.companyId
    const [saved, species] = await Promise.all([
      savedPlans(ctx, companyId),
      ctx.db
        .query('species')
        .withIndex('by_companyId_and_key', (q) => q.eq('companyId', companyId))
        .take(50),
    ])
    const names = new Map<string, string>(species.filter((s) => s.active).map((s) => [s.key, s.name]))
    const keys = new Set<string>([...names.keys(), ...Object.keys(DEFAULT_FEED_TABLES), ...saved.map((p) => p.speciesKey)])
    return [...keys].sort().map((speciesKey) => {
      const row = saved.find((p) => p.speciesKey === speciesKey)
      const builtIn = DEFAULT_FEED_TABLES[speciesKey]
      return {
        speciesKey,
        speciesName: names.get(speciesKey) ?? null,
        name: row?.name ?? builtIn?.name ?? null,
        bands: row?.bands ?? builtIn?.bands ?? null,
        source: row ? ('saved' as const) : builtIn ? ('default' as const) : ('none' as const),
        hasDefault: !!builtIn,
        updatedAt: row?.updatedAt ?? null,
      }
    })
  },
})

/** Save a species' feed table (replaces the default for that species). */
export const save = mutation({
  args: { speciesKey: v.string(), name: v.string(), bands: v.array(feedBand) },
  returns: v.id('feedingPlans'),
  handler: async (ctx, { speciesKey, name, bands }) => {
    const m = await requireMember(ctx, { permission: 'org.settings.manage' })
    const companyId = m.companyId
    if (!companyId) throw userError('FORBIDDEN', 'Choose an organization first')
    if (!SPECIES_KEY_PATTERN.test(speciesKey)) throw userError('VALIDATION', 'Unknown species', { field: 'speciesKey' })
    const label = name.trim()
    if (!label) throw userError('VALIDATION', 'Give the plan a name', { field: 'name' })
    if (label.length > RATION_LIMITS.nameLength) {
      throw userError('VALIDATION', `Names are at most ${RATION_LIMITS.nameLength} characters`, { field: 'name' })
    }
    const sorted = [...bands].sort((a, b) => a.minAbwG - b.minAbwG)
    const problems = bandProblems(sorted)
    if (problems.length) throw userError('VALIDATION', problems.join('. '), { field: 'bands' })
    const existing = await savedPlan(ctx, companyId, speciesKey)
    if (!existing && (await savedPlans(ctx, companyId)).length >= MAX_PLANS) {
      throw userError('VALIDATION', `At most ${MAX_PLANS} feeding plans`)
    }
    const row = { companyId, speciesKey, name: label, bands: sorted, updatedBy: m.user._id, updatedAt: Date.now() }
    let id: Id<'feedingPlans'>
    if (existing) {
      await ctx.db.replace(existing._id, row)
      id = existing._id
    } else {
      id = await ctx.db.insert('feedingPlans', row)
    }
    await logAudit(ctx, {
      actionType: existing ? 'update' : 'create',
      tableName: 'feedingPlans',
      recordId: id,
      previousValues: existing ? { name: existing.name, bands: existing.bands } : undefined,
      newValues: { speciesKey, name: label, bands: sorted },
    })
    return id
  },
})

/** Delete a saved table: the species goes back to the built-in default (or no plan). */
export const reset = mutation({
  args: { speciesKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { speciesKey }) => {
    const m = await requireMember(ctx, { permission: 'org.settings.manage' })
    if (!m.companyId) throw userError('FORBIDDEN', 'Choose an organization first')
    const existing = await savedPlan(ctx, m.companyId, speciesKey)
    if (!existing) return null
    await ctx.db.delete(existing._id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'feedingPlans',
      recordId: existing._id,
      previousValues: { speciesKey, name: existing.name, bands: existing.bands },
    })
    return null
  },
})

type CageRation = ReturnType<typeof rationFor> | { ok: false; reason: 'no_species' }

async function cageRation(ctx: QueryCtx, cage: Doc<'cages'>, tables: Map<string, FeedBand[]>) {
  let speciesKey = cage.species ?? null
  if (!speciesKey && cage.currentBatchId) {
    const batch = await ctx.db.get(cage.currentBatchId)
    speciesKey = batch?.speciesCode ?? null
  }
  const abwG = cage.currentWeight ?? cage.initialAbw ?? null
  const count = cage.currentCount ?? 0
  const ration: CageRation =
    count > 0 && abwG && !speciesKey
      ? { ok: false, reason: 'no_species' }
      : rationFor({ count, abwG, bands: speciesKey ? tables.get(speciesKey) : null })
  return {
    cageId: cage._id,
    cageName: cage.name,
    locationId: cage.locationId ?? null,
    speciesKey,
    count,
    abwG,
    ration,
  }
}

function inScope(m: MemberContext, cage: Doc<'cages'>) {
  return m.siteScope === 'all' || (!!cage.locationId && m.siteScope.has(cage.locationId))
}

/**
 * Today's suggested ration for every stocked unit (optionally one site) and
 * the farm total. Units the plan cannot cover say why (no fish, no ABW, no
 * species, no plan for the species).
 */
export const rations = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  handler: async (ctx, { locationId }) => {
    const m = await requireMember(ctx, { permission: 'production.view', locationId })
    if (!m.companyId) return { rows: [], totalKgPerDay: 0, planned: 0, unplanned: 0 }
    const companyId = m.companyId
    const tables = await tablesFor(ctx, companyId)
    const cages: Doc<'cages'>[] = []
    for (const status of ['active', 'harvesting'] as const) {
      cages.push(
        ...(await ctx.db
          .query('cages')
          .withIndex('by_company_status', (q) => q.eq('companyId', companyId).eq('status', status))
          .take(1000)),
      )
    }
    const visible = cages
      .filter((c) => !c.archivedAt && inScope(m, c) && (!locationId || c.locationId === locationId))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const rows = []
    for (const cage of visible) rows.push(await cageRation(ctx, cage, tables))
    const planned = rows.filter((r) => r.ration.ok)
    const totalKgPerDay = planned.reduce((s, r) => s + (r.ration.ok ? r.ration.kgPerDay : 0), 0)
    return {
      rows,
      totalKgPerDay: Math.round(totalKgPerDay * 10) / 10,
      planned: planned.length,
      unplanned: rows.length - planned.length,
    }
  },
})

/** One unit's suggested ration (the suggestion card on entry forms and unit pages). */
export const rationForCage = query({
  args: { cageId: v.id('cages') },
  handler: async (ctx, { cageId }) => {
    const m = await requireMember(ctx, { permission: 'production.view' })
    const cage = await ctx.db.get(cageId)
    if (!cage || !m.companyId || cage.companyId !== m.companyId || cage.archivedAt) return null
    if (!inScope(m, cage)) return null
    return await cageRation(ctx, cage, await tablesFor(ctx, m.companyId))
  },
})
