/**
 * Cycle planner (what if, doc plans/2026-11-20 §3): the assumptions a plan
 * starts from (the chosen units' last closed cycles, else species defaults)
 * and saved plans to compare. The maths is lib/cyclePlan, shared with the
 * page; nothing here stores results.
 *
 * Owner and manager roles (`production.plan.manage`); tenant and site scope
 * like the other production modules: every unit of a plan must belong to the
 * caller's organization and be in their sites.
 */
import { v } from 'convex/values'
import { mutation, query, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember, type MemberContext } from './lib/permissions'
import { userError } from './lib/errors'
import { logAudit } from './lib/tenancy'
import { addDays, isBusinessDate } from './lib/dates'
import { pooledFcr } from './lib/kpi'
import { speciesInfo } from './lib/forecastData'
import {
  PLAN_LIMITS,
  cycleTgc,
  defaultAssumptions,
  planProblems,
  type PlanAssumptions,
} from './lib/cyclePlan'
import { cyclePlanAssumptions, cyclePlanInputs } from './schema'

/** Saved plans per organization. */
const MAX_PLANS = 200
/** Closed cycles the assumptions average. */
const HISTORY_CYCLES = 3
/** Units whose daily temperatures are read for the monthly means. */
const TEMP_UNITS = 6
const TEMP_DAYS = 365
/** Days of records a month needs before its mean temperature is used. */
const MIN_DAYS_PER_MONTH = 3

const numOrNull = v.union(v.number(), v.null())
const strOrNull = v.union(v.string(), v.null())
const source = v.union(v.literal('history'), v.literal('default'), v.literal('edited'))

function unitInScope(m: MemberContext, cage: Doc<'cages'>) {
  return m.siteScope === 'all' || (!!cage.locationId && m.siteScope.has(cage.locationId))
}

/** The caller's live units among `ids` (others are dropped). */
async function scopedUnits(ctx: QueryCtx, m: MemberContext, ids: Id<'cages'>[]) {
  const out: Doc<'cages'>[] = []
  for (const id of [...new Set(ids)].slice(0, PLAN_LIMITS.maxUnits)) {
    const cage = await ctx.db.get(id)
    if (cage && cage.companyId === m.companyId && !cage.archivedAt && unitInScope(m, cage)) out.push(cage)
  }
  return out
}

/** The site every unit shares, else undefined. */
function commonSite(units: Doc<'cages'>[]) {
  const sites = new Set(units.map((u) => u.locationId ?? null))
  const [only] = [...sites]
  return sites.size === 1 && only ? only : undefined
}

function mostCommon(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>()
  for (const x of values) if (x) counts.set(x, (counts.get(x) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
}

/** Mean water temperature per calendar month over the last year (null where too few days). */
async function monthlyTemps(ctx: QueryCtx, units: Doc<'cages'>[], asOf: string) {
  const from = addDays(asOf, -TEMP_DAYS)
  const sums = Array.from({ length: 12 }, () => ({ sum: 0, n: 0 }))
  for (const u of units.slice(0, TEMP_UNITS)) {
    const rows = await ctx.db
      .query('unitDailyStats')
      .withIndex('by_unitId_and_date', (q) => q.eq('unitId', u._id).gte('date', from).lte('date', asOf))
      .take(TEMP_DAYS * 2)
    for (const r of rows) {
      if (r.temperatureC == null || !Number.isFinite(r.temperatureC)) continue
      const m = Number(r.date.slice(5, 7)) - 1
      sums[m].sum += r.temperatureC
      sums[m].n += 1
    }
  }
  const out = sums.map((s) => (s.n >= MIN_DAYS_PER_MONTH ? Math.round((s.sum / s.n) * 10) / 10 : null))
  return out.some((t) => t != null) ? out : null
}

/** Last closed cycles in the units, else at their site. */
async function closedCycles(ctx: QueryCtx, companyId: Id<'companies'>, units: Doc<'cages'>[], site: Id<'farmLocations'> | undefined) {
  const rows: Doc<'batchStats'>[] = []
  for (const u of units) {
    const stats = await ctx.db
      .query('batchStats')
      .withIndex('by_unitId_and_batchId', (q) => q.eq('unitId', u._id))
      .take(100)
    rows.push(...stats.filter((s) => !s.open && s.companyId === companyId))
  }
  if (!rows.length && site) {
    const recent = await ctx.db
      .query('batchStats')
      .withIndex('by_companyId_and_lastDate', (q) => q.eq('companyId', companyId).lt('lastDate', '9999-12-31'))
      .order('desc')
      .take(300)
    rows.push(...recent.filter((s) => !s.open && s.locationId === site))
  }
  return rows
    .filter((s) => s.kpis.closed_on && s.kpis.opened_on && s.kpis.stocked_count + s.kpis.in_count > 0)
    .sort((a, b) => (b.kpis.closed_on ?? '').localeCompare(a.kpis.closed_on ?? ''))
    .slice(0, HISTORY_CYCLES)
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/**
 * Where a new plan starts: the chosen units' last three closed cycles
 * (survival, FCR, growth as a TGC at the site's temperatures), each falling
 * back to the species default and labelled as such.
 */
export const assumptions = query({
  args: { unitIds: v.array(v.id('cages')), asOf: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      speciesKey: strOrNull,
      speciesName: strOrNull,
      locationId: v.union(v.id('farmLocations'), v.null()),
      siteName: strOrNull,
      units: v.number(),
      assumptions: cyclePlanAssumptions,
      tempRange: v.union(v.object({ min: v.number(), max: v.number() }), v.null()),
      cycles: v.array(
        v.object({
          batchNumber: v.string(),
          unitName: v.string(),
          closedOn: v.string(),
          survivalPct: numOrNull,
          fcr: numOrNull,
          tgc: numOrNull,
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    if (!isBusinessDate(args.asOf)) throw userError('VALIDATION', 'As of must be a date (YYYY-MM-DD)')
    const m = await requireMember(ctx, { permission: 'production.plan.manage' })
    if (!m.companyId) return null
    const units = await scopedUnits(ctx, m, args.unitIds)
    if (!units.length) return null
    const site = commonSite(units)
    const speciesKey = mostCommon(units.map((u) => u.species)) ?? 'nile_tilapia'
    const species = await speciesInfo(ctx, m.companyId, speciesKey)
    const base = defaultAssumptions(species.prior)
    const temps = await monthlyTemps(ctx, units, args.asOf)
    const known = (temps ?? []).filter((t): t is number => t != null)
    const climate: PlanAssumptions = {
      ...base,
      monthlyTempC: temps,
      tempC: known.length ? Math.round(mean(known)! * 10) / 10 : base.tempC,
    }

    const unitNames = new Map<string, string>(units.map((u) => [u._id, u.name]))
    const cycles = []
    for (const s of await closedCycles(ctx, m.companyId, units, site)) {
      const k = s.kpis
      const endAbw = k.harvested_count > 0 ? (k.harvested_kg * 1000) / k.harvested_count : k.current_abw_g
      const tgc =
        k.initial_abw_g && endAbw && k.days_of_culture
          ? cycleTgc({ openedOn: k.opened_on!, days: k.days_of_culture, startAbwG: k.initial_abw_g, endAbwG: endAbw }, climate)
          : null
      if (!unitNames.has(s.unitId)) unitNames.set(s.unitId, (await ctx.db.get(s.unitId))?.name ?? '')
      cycles.push({
        batchNumber: s.batchNumber,
        unitName: unitNames.get(s.unitId) ?? '',
        closedOn: k.closed_on!,
        survivalPct: k.survival_pct == null ? null : Math.round(k.survival_pct * 10) / 10,
        fcr: k.efcr == null ? null : Math.round(k.efcr * 100) / 100,
        tgc: tgc == null ? null : Math.round(tgc * 1000) / 1000,
        feedKg: k.feed_kg,
        gainKg: k.gain_kg,
      })
    }

    const survival = mean(cycles.map((c) => c.survivalPct).filter((x): x is number => x != null && x > 0 && x <= 100))
    const fcrRows = cycles.filter((c) => c.feedKg > 0 && c.gainKg > 0)
    const fcr = fcrRows.length ? pooledFcr(fcrRows) : null
    const tgc = mean(cycles.map((c) => c.tgc).filter((x): x is number => x != null && x > 0 && x <= 5))
    const fcrOk = fcr != null && fcr >= 0.5 && fcr <= 5

    const site_ = site ? await ctx.db.get(site) : null
    return {
      speciesKey,
      speciesName: species.name,
      locationId: site ?? null,
      siteName: site_?.name ?? null,
      units: units.length,
      assumptions: {
        speciesKey,
        survivalPct: survival != null ? Math.round(survival * 10) / 10 : base.survivalPct,
        fcr: fcrOk ? Math.round(fcr * 100) / 100 : base.fcr,
        tgc: tgc != null ? Math.round(tgc * 1000) / 1000 : base.tgc,
        tempC: climate.tempC,
        monthlyTempC: temps,
        sources: {
          survival: survival != null ? ('history' as const) : ('default' as const),
          fcr: fcrOk ? ('history' as const) : ('default' as const),
          growth: tgc != null ? ('history' as const) : ('default' as const),
        },
        cycles: cycles.length,
      },
      tempRange: known.length ? { min: Math.min(...known), max: Math.max(...known) } : null,
      cycles: cycles.map(({ feedKg: _f, gainKg: _g, ...c }) => c),
    }
  },
})

const planRow = v.object({
  _id: v.id('cyclePlans'),
  name: v.string(),
  locationId: v.union(v.id('farmLocations'), v.null()),
  units: v.array(v.object({ id: v.id('cages'), name: v.string() })),
  inputs: cyclePlanInputs,
  assumptions: cyclePlanAssumptions,
  updatedAt: v.number(),
})

/** The plan as the page sees it, or null when any of its units is out of the caller's reach. */
async function toRow(ctx: QueryCtx, m: MemberContext, p: Doc<'cyclePlans'>) {
  if (p.companyId !== m.companyId) return null
  const units = []
  for (const id of p.unitIds) {
    const cage = await ctx.db.get(id)
    if (!cage) continue
    if (cage.companyId !== m.companyId || !unitInScope(m, cage)) return null
    units.push({ id: cage._id, name: cage.name })
  }
  if (m.siteScope !== 'all' && !units.length) return null
  return {
    _id: p._id,
    name: p.name,
    locationId: p.locationId ?? null,
    units,
    inputs: p.inputs,
    assumptions: p.assumptions,
    updatedAt: p.updatedAt,
  }
}

/** Saved plans, newest first. */
export const list = query({
  args: {},
  returns: v.array(planRow),
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'production.plan.manage' })
    if (!m.companyId) return []
    const companyId = m.companyId
    const plans = await ctx.db
      .query('cyclePlans')
      .withIndex('by_companyId_and_updatedAt', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(MAX_PLANS)
    const out = []
    for (const p of plans) {
      const row = await toRow(ctx, m, p)
      if (row) out.push(row)
    }
    return out
  },
})

export const get = query({
  args: { planId: v.id('cyclePlans') },
  returns: v.union(planRow, v.null()),
  handler: async (ctx, { planId }) => {
    const m = await requireMember(ctx, { permission: 'production.plan.manage' })
    const p = await ctx.db.get(planId)
    return p ? await toRow(ctx, m, p) : null
  },
})

/** Create a plan, or replace one (`planId`). Returns its id. */
export const save = mutation({
  args: {
    planId: v.optional(v.id('cyclePlans')),
    name: v.string(),
    unitIds: v.array(v.id('cages')),
    inputs: cyclePlanInputs,
    assumptions: cyclePlanAssumptions,
  },
  returns: v.id('cyclePlans'),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'production.plan.manage' })
    const companyId = m.companyId
    if (!companyId) throw userError('FORBIDDEN', 'Choose an organization first')
    const name = args.name.trim()
    if (!name) throw userError('VALIDATION', 'Give the plan a name', { field: 'name' })
    if (name.length > PLAN_LIMITS.nameLength) {
      throw userError('VALIDATION', `Names are at most ${PLAN_LIMITS.nameLength} characters`, { field: 'name' })
    }
    const ids = [...new Set(args.unitIds)]
    if (!ids.length) throw userError('VALIDATION', 'Choose at least one unit', { field: 'unitIds' })
    if (ids.length > PLAN_LIMITS.maxUnits) {
      throw userError('VALIDATION', `At most ${PLAN_LIMITS.maxUnits} units in a plan`, { field: 'unitIds' })
    }
    const units = await scopedUnits(ctx, m, ids)
    if (units.length !== ids.length) throw userError('NOT_FOUND', 'Unit not found', { field: 'unitIds' })
    if (!isBusinessDate(args.inputs.stockOn)) throw userError('VALIDATION', 'Stocking date must be a date', { field: 'stockOn' })
    const problems = planProblems({ ...args.inputs, units: ids.length }, args.assumptions)
    if (problems.length) throw userError('VALIDATION', `Check: ${problems.join(', ')}`, { field: problems[0] })
    const a = args.assumptions
    if (a.cycles < 0 || a.cycles > HISTORY_CYCLES || !Number.isInteger(a.cycles)) {
      throw userError('VALIDATION', 'Check: cycles', { field: 'cycles' })
    }
    if (a.speciesKey != null && !/^[a-z][a-z0-9_]{0,39}$/.test(a.speciesKey)) {
      throw userError('VALIDATION', 'Unknown species', { field: 'speciesKey' })
    }

    const now = Date.now()
    const row = {
      companyId,
      locationId: commonSite(units),
      name,
      unitIds: ids,
      inputs: args.inputs,
      assumptions: args.assumptions,
      updatedBy: m.user._id,
      updatedAt: now,
    }
    if (args.planId) {
      const existing = await ctx.db.get(args.planId)
      if (!existing || existing.companyId !== companyId || !(await toRow(ctx, m, existing))) {
        throw userError('NOT_FOUND', 'Plan not found')
      }
      await ctx.db.replace(existing._id, { ...row, createdBy: existing.createdBy, createdAt: existing.createdAt })
      await logAudit(ctx, {
        actionType: 'update',
        tableName: 'cyclePlans',
        recordId: existing._id,
        locationId: row.locationId,
        previousValues: { name: existing.name, unitIds: existing.unitIds, inputs: existing.inputs, assumptions: existing.assumptions },
        newValues: { name, unitIds: ids, inputs: args.inputs, assumptions: args.assumptions },
      })
      return existing._id
    }
    const count = await ctx.db
      .query('cyclePlans')
      .withIndex('by_companyId_and_updatedAt', (q) => q.eq('companyId', companyId))
      .take(MAX_PLANS)
    if (count.length >= MAX_PLANS) throw userError('VALIDATION', `At most ${MAX_PLANS} saved plans; delete some first`)
    const id = await ctx.db.insert('cyclePlans', { ...row, createdBy: m.user._id, createdAt: now })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'cyclePlans',
      recordId: id,
      locationId: row.locationId,
      newValues: { name, unitIds: ids, inputs: args.inputs, assumptions: args.assumptions },
    })
    return id
  },
})

export const remove = mutation({
  args: { planId: v.id('cyclePlans') },
  returns: v.null(),
  handler: async (ctx, { planId }) => {
    const m = await requireMember(ctx, { permission: 'production.plan.manage' })
    const p = await ctx.db.get(planId)
    if (!p || !(await toRow(ctx, m, p))) throw userError('NOT_FOUND', 'Plan not found')
    await ctx.db.delete(p._id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'cyclePlans',
      recordId: p._id,
      locationId: p.locationId,
      previousValues: { name: p.name, unitIds: p.unitIds, inputs: p.inputs, assumptions: p.assumptions },
    })
    return null
  },
})
