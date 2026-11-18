/**
 * Species configuration per organization (D-012, I18N-004 partial). Replaces
 * the hard-coded tilapia harvest grades: the harvest form offers the grades
 * of the cage's species, and falls back to the old list when none are set.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember } from './lib/permissions'
import { logAudit, writeCompanyId } from './lib/tenancy'
import { userError } from './lib/errors'
import { DEFAULT_SPECIES, gradeProblems, gradeRange } from './lib/species'

const MAX_SPECIES = 50

const gradeValidator = v.object({
  key: v.string(),
  label: v.string(),
  minG: v.optional(v.number()),
  maxG: v.optional(v.number()),
})

function toClient(s: Doc<'species'>) {
  return {
    id: s._id,
    key: s.key,
    name: s.name,
    scientificName: s.scientificName ?? null,
    targetHarvestAbwG: s.targetHarvestAbwG ?? null,
    targetFcr: s.targetFcr ?? null,
    expectedDailyGrowthG: s.expectedDailyGrowthG ?? null,
    harvestGrades: s.harvestGrades.map((g) => ({ ...g, range: gradeRange(g) })),
    active: s.active,
    updatedAt: s.updatedAt,
  }
}

async function companySpecies(ctx: MutationCtx, companyId: Id<'companies'>) {
  return await ctx.db
    .query('species')
    .withIndex('by_companyId_and_key', (q) => q.eq('companyId', companyId))
    .take(MAX_SPECIES + 1)
}

/** The organization's species, active first, then by name. */
export const list = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { includeArchived }) => {
    const { companyId } = await requireMember(ctx, { permission: 'production.view' })
    if (!companyId) return []
    const rows = await ctx.db
      .query('species')
      .withIndex('by_companyId_and_key', (q) => q.eq('companyId', companyId))
      .take(MAX_SPECIES)
    return rows
      .filter((s) => includeArchived || s.active)
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
      .map(toClient)
  },
})

const optionalPositive = (n: number | undefined, label: string) => {
  if (n != null && (!Number.isFinite(n) || n <= 0)) {
    throw userError('VALIDATION', `${label} must be greater than zero`)
  }
}

/** Create or edit a species (key is fixed once created). */
export const upsert = mutation({
  args: {
    id: v.optional(v.id('species')),
    key: v.string(),
    name: v.string(),
    scientificName: v.optional(v.string()),
    targetHarvestAbwG: v.optional(v.number()),
    targetFcr: v.optional(v.number()),
    expectedDailyGrowthG: v.optional(v.number()),
    harvestGrades: v.array(gradeValidator),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.settings.manage' })
    const companyId = await writeCompanyId(user)
    const key = args.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_')
    const name = args.name.trim()
    if (!key) throw userError('VALIDATION', 'Give the species a code', { field: 'key' })
    if (!name) throw userError('VALIDATION', 'Give the species a name', { field: 'name' })
    optionalPositive(args.targetHarvestAbwG, 'Target harvest weight')
    optionalPositive(args.targetFcr, 'Target FCR')
    optionalPositive(args.expectedDailyGrowthG, 'Expected daily growth')
    const harvestGrades = args.harvestGrades.map((g) => ({ ...g, key: g.key.trim(), label: g.label.trim() }))
    const problems = gradeProblems(harvestGrades)
    if (problems.length) throw userError('VALIDATION', problems.join('. '), { field: 'harvestGrades' })

    const fields = {
      name,
      scientificName: args.scientificName?.trim() || undefined,
      targetHarvestAbwG: args.targetHarvestAbwG,
      targetFcr: args.targetFcr,
      expectedDailyGrowthG: args.expectedDailyGrowthG,
      harvestGrades,
      active: true,
      updatedAt: Date.now(),
      updatedBy: user._id,
    }
    const sameKey = await ctx.db
      .query('species')
      .withIndex('by_companyId_and_key', (q) => q.eq('companyId', companyId).eq('key', key))
      .first()

    if (args.id) {
      const existing = await ctx.db.get(args.id)
      if (!existing || existing.companyId !== companyId) throw userError('NOT_FOUND', 'Species not found')
      if (existing.key !== key) throw userError('VALIDATION', 'A species code cannot change', { field: 'key' })
      await ctx.db.patch(existing._id, fields)
      await logAudit(ctx, {
        actionType: 'update',
        tableName: 'species',
        recordId: existing._id,
        previousValues: { name: existing.name, harvestGrades: existing.harvestGrades },
        newValues: fields,
      })
      return existing._id
    }
    if (sameKey) throw userError('CONFLICT', `A species with code ${key} already exists`, { field: 'key' })
    if ((await companySpecies(ctx, companyId)).length >= MAX_SPECIES) {
      throw userError('VALIDATION', `At most ${MAX_SPECIES} species`)
    }
    const id = await ctx.db.insert('species', { companyId, key, ...fields })
    await logAudit(ctx, { actionType: 'create', tableName: 'species', recordId: id, newValues: { key, ...fields } })
    return id
  },
})

/** Hide a species from pickers; cages and records keep their species code. */
export const archive = mutation({
  args: { id: v.id('species'), archived: v.optional(v.boolean()) },
  handler: async (ctx, { id, archived }) => {
    const { user } = await requireMember(ctx, { permission: 'org.settings.manage' })
    const companyId = await writeCompanyId(user)
    const row = await ctx.db.get(id)
    if (!row || row.companyId !== companyId) throw userError('NOT_FOUND', 'Species not found')
    const active = archived === false
    await ctx.db.patch(id, { active, updatedAt: Date.now(), updatedBy: user._id })
    await logAudit(ctx, {
      actionType: active ? 'restore' : 'archive',
      tableName: 'species',
      recordId: id,
      previousValues: { active: row.active },
      newValues: { active },
    })
    return id
  },
})

/** Add the standard species (tilapia grades as used until now) that are missing. Idempotent. */
export const ensureDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireMember(ctx, { permission: 'org.settings.manage' })
    const companyId = await writeCompanyId(user)
    const existing = new Set((await companySpecies(ctx, companyId)).map((s) => s.key))
    const added: string[] = []
    for (const d of DEFAULT_SPECIES) {
      if (existing.has(d.key)) continue
      await ctx.db.insert('species', {
        companyId,
        key: d.key,
        name: d.name,
        scientificName: d.scientificName,
        targetHarvestAbwG: d.targetHarvestAbwG,
        targetFcr: d.targetFcr,
        expectedDailyGrowthG: d.expectedDailyGrowthG,
        harvestGrades: d.harvestGrades.map((g) => ({ ...g })),
        active: true,
        updatedAt: Date.now(),
        updatedBy: user._id,
      })
      added.push(d.key)
    }
    if (added.length) {
      await logAudit(ctx, { actionType: 'create', tableName: 'species', newValues: { seeded: added } })
    }
    return { added }
  },
})
