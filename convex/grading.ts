/**
 * Grading workspace (Paper 52): the source unit's stock, saved drafts and the
 * recent gradings. The grading itself posts through batches.grade.
 *
 * Drafts are one per source unit and company, checked against the caller's
 * company and sites. Reading or writing a draft needs the grading permission
 * (production.transfer.approve); recent gradings need production.view.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember, type MemberContext } from './lib/permissions'
import { userError } from './lib/errors'
import { isBusinessDate } from './lib/dates'
import { daysBetween } from './lib/kpi'
import { mergeSettings } from './lib/farmRules'
import { effectiveTemp } from './lib/growthForecast'
import { GRADING_LIMITS, cleanRounds } from './lib/gradingMath'
import { unitForecast } from './forecasts'

const RECENT_LIMIT = 5
const RECENT_SCAN = 50
const DRAFT_LIST_LIMIT = 100

const draftClass = v.object({
  cageId: v.optional(v.id('cages')),
  quantity: v.optional(v.number()),
  abw: v.optional(v.number()),
  batchNumber: v.optional(v.string()),
  samples: v.array(v.array(v.number())),
})

const numOrNull = v.union(v.number(), v.null())
const strOrNull = v.union(v.string(), v.null())

function inScope(m: MemberContext, row: { locationId?: Id<'farmLocations'> }) {
  return m.siteScope === 'all' || (!!row.locationId && m.siteScope.has(row.locationId))
}

/** A unit of the caller's company in their sites, or null. */
async function visibleUnit(ctx: QueryCtx, m: MemberContext, id: Id<'cages'>) {
  const cage = await ctx.db.get(id)
  if (!cage || !m.companyId || cage.companyId !== m.companyId || cage.archivedAt || !inScope(m, cage)) return null
  return cage
}

async function draftOf(ctx: QueryCtx, companyId: Id<'companies'>, unitId: Id<'cages'>) {
  return await ctx.db
    .query('gradingDrafts')
    .withIndex('by_companyId_and_unitId', (q) => q.eq('companyId', companyId).eq('unitId', unitId))
    .unique()
}

/**
 * The source unit as the grading page shows it: its batch and day of
 * culture, the fish and weight on record, what the unit's forecast needs to
 * say when the heaviest class reaches market weight, any saved draft, and
 * the farm's density limits.
 */
export const view = query({
  args: { cageId: v.optional(v.id('cages')), asOf: v.string() },
  returns: v.object({
    source: v.union(
      v.null(),
      v.object({
        cage_id: v.id('cages'),
        cage_name: v.string(),
        batch_number: strOrNull,
        day: numOrNull,
        count: v.number(),
        abw_g: numOrNull,
        biomass_kg: numOrNull,
        market: v.union(v.null(), v.object({ target_g: v.number(), tgc: v.number(), eff_temp_c: v.number() })),
      }),
    ),
    draft: v.union(
      v.null(),
      v.object({
        date: v.string(),
        grader_bars: strOrNull,
        classes: v.array(draftClass),
        culls: numOrNull,
        reason: strOrNull,
        sampled_by: strOrNull,
        sampled_at: numOrNull,
        updated_at: v.number(),
      }),
    ),
    farm_rules: v.object({
      maxDensityFishPerM3: v.number(),
      maxDensityFishPerM2: v.number(),
      maxDensityTankFishPerM3: v.number(),
      densityWarnPct: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    if (!isBusinessDate(args.asOf)) throw userError('VALIDATION', 'Choose a valid date')
    const m = await requireMember(ctx, { permission: 'production.transfer.approve' })
    const company = m.companyId ? await ctx.db.get(m.companyId) : null
    const fr = mergeSettings(company?.settings).farmRules
    const farm_rules = {
      maxDensityFishPerM3: fr.maxDensityFishPerM3,
      maxDensityFishPerM2: fr.maxDensityFishPerM2,
      maxDensityTankFishPerM3: fr.maxDensityTankFishPerM3,
      densityWarnPct: fr.densityWarnPct,
    }
    const cage = args.cageId ? await visibleUnit(ctx, m, args.cageId) : null
    if (!cage || !m.companyId) return { source: null, draft: null, farm_rules }

    const batch = cage.currentBatchId ? await ctx.db.get(cage.currentBatchId) : null
    const count = cage.currentCount ?? 0
    const abw = cage.currentWeight ?? cage.initialAbw ?? null
    let market = null
    if (count > 0) {
      const f = await unitForecast(ctx, m.companyId, cage, args.asOf)
      if (f && f.tgc.expected > 0) {
        const eff = effectiveTemp(f.species_key, f.temperature.c)
        if (eff > 0) market = { target_g: f.plan.target_g, tgc: f.tgc.expected, eff_temp_c: eff }
      }
    }
    const source = {
      cage_id: cage._id,
      cage_name: cage.name,
      batch_number: batch?.batchNumber ?? null,
      day: cage.stockingDate && count > 0 ? daysBetween(cage.stockingDate, args.asOf) : null,
      count,
      abw_g: abw,
      biomass_kg: abw != null && count > 0 ? (count * abw) / 1000 : null,
      market,
    }

    const d = await draftOf(ctx, m.companyId, cage._id)
    const sampler = d?.sampledBy ? await ctx.db.get(d.sampledBy) : null
    const draft = d
      ? {
          date: d.date,
          grader_bars: d.graderBars ?? null,
          classes: d.classes,
          culls: d.culls ?? null,
          reason: d.reason ?? null,
          sampled_by: sampler ? sampler.name || sampler.email || null : null,
          sampled_at: d.sampledAt ?? null,
          updated_at: d.updatedAt,
        }
      : null
    return { source, draft, farm_rules }
  },
})

/** Units with a saved grading draft (newest first), in the caller's sites. */
export const drafts = query({
  args: {},
  returns: v.array(v.object({ cage_id: v.id('cages'), updated_at: v.number() })),
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'production.transfer.approve' })
    if (!m.companyId) return []
    const companyId = m.companyId
    const rows = await ctx.db
      .query('gradingDrafts')
      .withIndex('by_companyId_and_updatedAt', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(DRAFT_LIST_LIMIT)
    return rows.filter((r) => inScope(m, r)).map((r) => ({ cage_id: r.unitId, updated_at: r.updatedAt }))
  },
})

function sameSamples(a: Doc<'gradingDrafts'>['classes'] | undefined, b: Doc<'gradingDrafts'>['classes']) {
  const key = (cs: Doc<'gradingDrafts'>['classes'] | undefined) => JSON.stringify((cs ?? []).map((c) => cleanRounds(c.samples)))
  return key(a) === key(b)
}

/**
 * Save (or replace) the draft for a source unit. Sample weights record who
 * weighed them and when, whenever they change.
 */
export const saveDraft = mutation({
  args: {
    cageId: v.id('cages'),
    date: v.string(),
    graderBars: v.optional(v.string()),
    classes: v.array(draftClass),
    culls: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  returns: v.object({ updatedAt: v.number() }),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'production.transfer.approve' })
    const cage = await ctx.db.get(args.cageId)
    if (!cage || !m.companyId || cage.companyId !== m.companyId || cage.archivedAt) {
      throw userError('NOT_FOUND', 'Cage not found')
    }
    if (!inScope(m, cage)) throw userError('FORBIDDEN', 'You do not have access to this site', { reason: 'SITE_FORBIDDEN' })
    if (!isBusinessDate(args.date)) throw userError('VALIDATION', 'Choose a grading date')
    if (args.classes.length > GRADING_LIMITS.classes) {
      throw userError('VALIDATION', `At most ${GRADING_LIMITS.classes} classes`)
    }
    if ((args.graderBars ?? '').length > GRADING_LIMITS.graderBars) throw userError('VALIDATION', 'Grader bars are too long')
    if ((args.reason ?? '').length > GRADING_LIMITS.reason) throw userError('VALIDATION', 'Notes are too long')
    if (args.culls != null && !(Number.isInteger(args.culls) && args.culls >= 0)) {
      throw userError('VALIDATION', 'Culls must be a whole number')
    }
    const classes: Doc<'gradingDrafts'>['classes'] = []
    for (const c of args.classes) {
      if (c.samples.length > GRADING_LIMITS.rounds) {
        throw userError('VALIDATION', `At most ${GRADING_LIMITS.rounds} weighing rounds per class`)
      }
      if (c.samples.some((r) => r.length > GRADING_LIMITS.perRound)) {
        throw userError('VALIDATION', `At most ${GRADING_LIMITS.perRound} fish per weighing round`)
      }
      if (c.quantity != null && !(Number.isInteger(c.quantity) && c.quantity >= 0)) {
        throw userError('VALIDATION', 'Each class needs a whole number of fish')
      }
      if (c.abw != null && !(c.abw >= 0)) throw userError('VALIDATION', 'Average weight cannot be negative')
      if (c.cageId) {
        const dest = await ctx.db.get(c.cageId)
        if (!dest || dest.companyId !== m.companyId || !inScope(m, dest)) throw userError('NOT_FOUND', 'Cage not found')
      }
      classes.push({
        cageId: c.cageId,
        quantity: c.quantity,
        abw: c.abw,
        batchNumber: c.batchNumber?.trim() || undefined,
        samples: cleanRounds(c.samples),
      })
    }

    const now = Date.now()
    const existing = await draftOf(ctx, m.companyId, cage._id)
    const sampled = classes.some((c) => c.samples.length > 0)
    const changed = !sameSamples(existing?.classes, classes)
    const fields = {
      date: args.date,
      graderBars: args.graderBars?.trim() || undefined,
      classes,
      culls: args.culls,
      reason: args.reason?.trim() || undefined,
      sampledBy: !sampled ? undefined : changed ? m.user._id : existing?.sampledBy,
      sampledAt: !sampled ? undefined : changed ? now : existing?.sampledAt,
      updatedBy: m.user._id,
      updatedAt: now,
    }
    if (existing) {
      await ctx.db.replace(existing._id, { ...fields, companyId: existing.companyId, unitId: existing.unitId, locationId: cage.locationId })
    } else {
      await ctx.db.insert('gradingDrafts', { ...fields, companyId: m.companyId, unitId: cage._id, locationId: cage.locationId })
    }
    return { updatedAt: now }
  },
})

/** Delete the draft for a source unit (no-op when there is none). */
export const discardDraft = mutation({
  args: { cageId: v.id('cages') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'production.transfer.approve' })
    if (!m.companyId) return null
    const d = await draftOf(ctx, m.companyId, args.cageId)
    if (d) {
      if (!inScope(m, d)) throw userError('FORBIDDEN', 'You do not have access to this site', { reason: 'SITE_FORBIDDEN' })
      await ctx.db.delete(d._id)
    }
    return null
  },
})

/**
 * The latest gradings in the caller's sites: source and destination units,
 * fish graded, classes and the size spread recorded from the sample check.
 */
export const recent = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id('stockOperations'),
      date: v.string(),
      source_name: strOrNull,
      destinations: v.array(v.string()),
      fish: v.number(),
      classes: v.number(),
      cv_before_pct: numOrNull,
      cv_after_pct: numOrNull,
      batch_id: v.union(v.id('batches'), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'production.view' })
    if (!m.companyId) return []
    const companyId = m.companyId
    const ops: Doc<'stockOperations'>[] = []
    let scanned = 0
    for await (const op of ctx.db
      .query('stockOperations')
      .withIndex('by_companyId_and_kind_and_operationDate', (q) =>
        q.eq('companyId', companyId).eq('kind', 'grading_split'),
      )
      .order('desc')) {
      if (++scanned > RECENT_SCAN) break
      if (op.status !== 'approved' || !inScope(m, op)) continue
      ops.push(op)
      if (ops.length >= RECENT_LIMIT) break
    }
    const names = new Map<string, string>()
    const nameOf = async (id: Id<'cages'>) => {
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? '?')
      return names.get(id)!
    }
    const out = []
    for (const op of ops) {
      const events = await ctx.db
        .query('stockEvents')
        .withIndex('by_sourceTable_and_sourceId', (q) => q.eq('sourceTable', 'stockOperations').eq('sourceId', op._id))
        .take(60)
      const outputs = events.filter((e) => e.type === 'grading_split' && e.qtyDelta > 0)
      const destinations: string[] = []
      for (const e of outputs) {
        const name = await nameOf(e.unitId)
        if (!destinations.includes(name)) destinations.push(name)
      }
      out.push({
        id: op._id,
        date: op.operationDate,
        source_name: op.unitId ? await nameOf(op.unitId) : null,
        destinations,
        fish: outputs.reduce((s, e) => s + e.qtyDelta, 0),
        classes: op.grading?.classes ?? outputs.length,
        cv_before_pct: op.grading?.cvBeforePct ?? null,
        cv_after_pct: op.grading?.cvAfterPct ?? null,
        batch_id: outputs[0]?.batchId ?? null,
      })
    }
    return out
  },
})
