/**
 * Read-only data for the farm bot's agent tools (BOT-002, doc 23 §4). Every
 * read takes the binding id only: company, site scope and permissions come
 * from `checkBinding`, never from the model. Results are compact JSON the
 * model rephrases.
 */
import { v, type Infer } from 'convex/values'
import { internalQuery } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { can } from '../lib/permissions'
import { addDays } from '../lib/dates'
import { round } from '../lib/kpi'
import { cageGrowth } from '../lib/growth'
import { siteStock } from '../lib/feedLedger'
import { keeperRead } from '../keepers/ask'
import { checkBinding, farmDate, matchUnit, unitsInScope, type MemberScope } from './scope'

export const readTool = v.union(
  v.literal('units'),
  v.literal('unit_detail'),
  v.literal('feed_stock'),
  v.literal('missing_today'),
  // Cage keepers.
  v.literal('keepers_behind'),
  v.literal('keeper_of'),
)

const readResult = v.union(
  v.object({ ok: v.literal(true), data: v.string() }),
  v.object({ ok: v.literal(false), error: v.string() }),
)

/** Units in scope with no daily entry for today's farm date. */
export async function missingToday(ctx: QueryCtx, bound: MemberScope, now: number) {
  const units = (await unitsInScope(ctx, bound)).filter((u) => u.status === 'active')
  const missing: Array<Doc<'cages'>> = []
  let date = ''
  for (const u of units) {
    const d = await farmDate(ctx, bound, u.locationId, now)
    date = date || d
    const rec = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) => q.eq('cageId', u._id).eq('date', d))
      .first()
    if (!rec) missing.push(u)
  }
  return { date, active: units.length, units, missing }
}

async function units(ctx: QueryCtx, bound: MemberScope, now: number) {
  const rows = (await unitsInScope(ctx, bound, 100)).filter((u) => u.status !== 'empty' || (u.currentCount ?? 0) > 0)
  const out = []
  for (const u of rows.slice(0, 40)) {
    const today = await farmDate(ctx, bound, u.locationId, now)
    const last = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) => q.eq('cageId', u._id))
      .order('desc')
      .first()
    out.push({
      unit: u.name,
      status: u.status,
      fish: u.currentCount ?? null,
      abwG: round(u.currentWeight, 1),
      lastEntry: last?.date ?? null,
      enteredToday: last?.date === today,
    })
  }
  return { site: bound.site?.name ?? 'all sites in scope', units: out, more: rows.length > out.length }
}

async function unitDetail(ctx: QueryCtx, bound: MemberScope, typed: string, now: number) {
  const all = await unitsInScope(ctx, bound)
  const { unit, candidates } = matchUnit(all, typed)
  if (!unit) return { error: candidates.length ? `Ambiguous unit; matches: ${candidates.join(', ')}` : 'No such unit in scope.' }
  const today = await farmDate(ctx, bound, unit.locationId, now)
  const g = await cageGrowth(ctx, unit, today)
  const week = await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage_date', (q) => q.eq('cageId', unit._id).gte('date', addDays(today, -6)).lte('date', today))
    .take(31)
  return {
    unit: unit.name,
    status: unit.status,
    stockingDate: g.stocking_date,
    daysOfCulture: g.days_of_culture,
    liveCount: g.live_count,
    survivalPct: g.survival_pct,
    abwG: g.current_abw_g,
    abwMeasuredOn: g.abw_measured_on,
    biomassKg: g.current_biomass_kg,
    cycleFeedKg: g.feed_kg,
    cycleMortality: g.mortality,
    efcr: g.efcr,
    last7Days: {
      from: addDays(today, -6),
      to: today,
      feedKg: round(week.reduce((s, r) => s + (r.feedAmount || 0), 0), 1),
      mortality: week.reduce((s, r) => s + (r.mortality || 0), 0),
      daysWithEntry: week.length,
    },
  }
}

async function feedStock(ctx: QueryCtx, bound: MemberScope) {
  const types = (
    await ctx.db
      .query('feedTypes')
      .withIndex('by_company', (q) => q.eq('companyId', bound.binding.companyId))
      .take(100)
  ).filter((f) => !f.deletedAt)
  const out = []
  for (const f of types.slice(0, 30)) {
    const stock = bound.site ? (await siteStock(ctx, f, bound.site._id)).available : f.currentStock || 0
    out.push({
      feedType: f.name,
      stockKg: round(stock, 1),
      minimumKg: f.minimumStock ?? null,
      low: f.minimumStock != null && stock < f.minimumStock,
    })
  }
  return { site: bound.site?.name ?? 'all sites', feeds: out }
}

/** One read for an agent tool call. Refuses when the binding or permission no longer holds. */
export const read = internalQuery({
  args: {
    bindingId: v.id('channelBindings'),
    tool: readTool,
    unit: v.optional(v.string()),
    now: v.number(),
  },
  returns: readResult,
  handler: async (ctx, { bindingId, tool, unit, now }) => {
    const binding = await ctx.db.get(bindingId)
    if (!binding) return { ok: false as const, error: 'not connected' }
    const checked = await checkBinding(ctx, binding)
    if (!checked.ok) return { ok: false as const, error: 'not connected' }
    return await readFor(ctx, checked.bound, tool, unit, now)
  },
})

/** One read tool for a member scope (chat binding or Ask Anowa web member). */
export async function readFor(
  ctx: QueryCtx,
  bound: MemberScope,
  tool: Infer<typeof readTool>,
  unit: string | undefined,
  now: number,
): Promise<Infer<typeof readResult>> {
  if (tool === 'keepers_behind' || tool === 'keeper_of') {
    return await keeperRead(ctx, bound, tool === 'keeper_of' ? 'keeper_of' : 'behind', unit, now)
  }
  const permission = tool === 'feed_stock' ? 'inventory.view' : 'production.view'
  if (!can(bound.member, permission)) return { ok: false as const, error: `You do not have ${permission} permission.` }
  let data: unknown
  if (tool === 'units') data = await units(ctx, bound, now)
  else if (tool === 'unit_detail') {
    const d = await unitDetail(ctx, bound, unit ?? '', now)
    if ('error' in d && typeof d.error === 'string') return { ok: false as const, error: d.error }
    data = d
  } else if (tool === 'feed_stock') data = await feedStock(ctx, bound)
  else {
    const m = await missingToday(ctx, bound, now)
    data = { date: m.date, activeUnits: m.active, missing: m.missing.map((u) => u.name) }
  }
  return { ok: true as const, data: JSON.stringify(data) }
}
