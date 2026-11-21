import { v } from 'convex/values'
import { query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember, type MemberContext } from './lib/permissions'
import { OPEN_LAST_DATE } from './lib/rollups'
import { addDays } from './lib/dates'
import { isRealHarvest } from './lib/cycles'
import { densityStatus, mergeSettings, unitTypeOf } from './lib/farmRules'
import {
  attentionKind,
  biomassOn,
  biomassSeries,
  cycleDay,
  kpiDeltas,
  mergeActivity,
  pctChange,
  pickAttention,
  rangeStart,
  type ActivityRow,
  type AttentionReason,
  type Occupancy,
} from './lib/homeOverview'

/**
 * Home (Paper 01): the standing-biomass card, the KPI strip, "Needs
 * attention" and the farm-activity feed. Every read is bounded and goes
 * through a company index; the member's site scope (memberships) filters
 * rows tied to a site. Dates come from the client (`asOf`), never the clock.
 */

/** Occupancies read per company (open, plus closed in the window). */
const OCCUPANCY_CAP = 2000
const CAGE_CAP = 5000
const UNIT_DAY_CAP = 5000
const ALERT_CAP = 500
const ACTIVITY_SCAN = 200

type Scope = MemberContext['siteScope']

/** A row tied to a site is visible when the site is in scope; rows with no site stay visible. */
function visible(scope: Scope, locationId: Id<'farmLocations'> | undefined | null) {
  return scope === 'all' || !locationId || scope.has(locationId)
}

function siteFilter<T extends { locationId?: Id<'farmLocations'> }>(
  rows: T[],
  scope: Scope,
  locationId: Id<'farmLocations'> | undefined,
): T[] {
  return rows.filter((r) => visible(scope, r.locationId) && (!locationId || r.locationId === locationId))
}

const toOccupancy = (r: Doc<'batchStats'>): Occupancy => ({
  openedOn: r.kpis.opened_on,
  closedOn: r.kpis.closed_on,
  open: r.open,
  weekly: r.weekly.map((s) => ({
    date: s.date,
    count: s.count,
    biomassKg: s.biomassKg,
    feedKg: s.feedKg,
    gainKg: s.gainKg,
    mortality: s.mortality,
  })),
})

async function companyCages(ctx: QueryCtx, companyId: Id<'companies'>, locationId?: Id<'farmLocations'>) {
  return locationId
    ? await ctx.db
        .query('cages')
        .withIndex('by_company_location', (q) => q.eq('companyId', companyId).eq('locationId', locationId))
        .take(CAGE_CAP)
    : await ctx.db
        .query('cages')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(CAGE_CAP)
}

const rangeValidator = v.union(v.literal('30d'), v.literal('90d'), v.literal('cycle'))

/** Standing biomass trend, cycle day and the KPI strip. */
export const overview = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    /** Client's today (YYYY-MM-DD). */
    asOf: v.string(),
    range: rangeValidator,
  },
  returns: v.union(
    v.null(),
    v.object({
      biomassKg: v.number(),
      series: v.array(v.object({ date: v.string(), kg: v.number() })),
      /** vs the biomass 30 days before `asOf`. */
      changePct: v.union(v.number(), v.null()),
      /** Biomass × latest sale price per kg; null when nothing was sold. */
      estValue: v.union(v.number(), v.null()),
      cycleDay: v.union(v.number(), v.null()),
      activeCages: v.number(),
      totalCages: v.number(),
      fcr: v.union(v.number(), v.null()),
      fcrDelta: v.union(v.number(), v.null()),
      mortalityPct: v.union(v.number(), v.null()),
      mortalityDelta: v.union(v.number(), v.null()),
      feedTodayKg: v.number(),
      loggedToday: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'reports.view', locationId: args.locationId })
    if (!m.companyId) return null
    const companyId = m.companyId
    const scope = m.siteScope

    const openRows = await ctx.db
      .query('batchStats')
      .withIndex('by_companyId_and_open', (q) => q.eq('companyId', companyId).eq('open', true))
      .take(OCCUPANCY_CAP)
    const openOcc = siteFilter(openRows, scope, args.locationId).map(toOccupancy)
    const start = rangeStart(args.range, args.asOf, openOcc)
    // Closed occupancies still count for the days they stood in the window.
    const from = [start, addDays(args.asOf, -60)].sort()[0]
    const closedRows = await ctx.db
      .query('batchStats')
      .withIndex('by_companyId_and_lastDate', (q) =>
        q.eq('companyId', companyId).gte('lastDate', from).lt('lastDate', OPEN_LAST_DATE),
      )
      .take(OCCUPANCY_CAP)
    const occupancies = [...openOcc, ...siteFilter(closedRows, scope, args.locationId).map(toOccupancy)]

    const biomassKg = biomassOn(occupancies, args.asOf)
    const deltas = kpiDeltas(occupancies, args.asOf)

    const sales = await ctx.db
      .query('sales')
      .withIndex('by_company_and_saleDate', (q) => q.eq('companyId', companyId).lte('saleDate', args.asOf))
      .order('desc')
      .take(50)
    const lastSale = siteFilter(sales, scope, args.locationId).find(
      (s) => s.pricePerKg > 0 && s.weightKg > 0 && !s.unitCount,
    )

    const cages = siteFilter(await companyCages(ctx, companyId, args.locationId), scope, undefined).filter(
      (c) => !c.archivedAt,
    )
    const active = new Set(cages.filter((c) => c.status === 'active').map((c) => String(c._id)))

    const days = siteFilter(
      await ctx.db
        .query('unitDailyStats')
        .withIndex('by_companyId_and_date', (q) => q.eq('companyId', companyId).eq('date', args.asOf))
        .take(UNIT_DAY_CAP),
      scope,
      args.locationId,
    )
    const logged = new Set<string>()
    let feedTodayKg = 0
    for (const d of days) {
      feedTodayKg += d.feedKg
      if (d.feed.length > 0 && active.has(String(d.unitId))) logged.add(String(d.unitId))
    }

    return {
      biomassKg,
      series: biomassSeries(occupancies, start, args.asOf),
      changePct: pctChange(biomassKg, biomassOn(occupancies, addDays(args.asOf, -30))),
      estValue: lastSale ? biomassKg * lastSale.pricePerKg : null,
      cycleDay: cycleDay(openOcc, args.asOf),
      activeCages: active.size,
      totalCages: cages.length,
      fcr: deltas.fcr,
      fcrDelta: deltas.fcrDelta,
      mortalityPct: deltas.mortalityPct,
      mortalityDelta: deltas.mortalityDelta,
      feedTodayKg: Math.round(feedTodayKg * 10) / 10,
      loggedToday: logged.size,
    }
  },
})

const attentionReason = v.union(
  v.literal('low_oxygen'),
  v.literal('temperature_out_of_range'),
  v.literal('missing_entries'),
  v.literal('mortality_spike'),
  v.literal('feed_drop'),
  v.literal('fcr_deterioration'),
  v.literal('growth_stall'),
  v.literal('density'),
)

const SEVERITY_RANK = { critical: 30, warning: 10, info: 0 } as const

/**
 * Cages that need someone today: live early-warning alerts (lib/earlyWarning)
 * and stocking density at or over the warning band (lib/farmRules), one row
 * per cage with its most urgent problem and the action that fixes it.
 */
export const attention = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    total: v.number(),
    rows: v.array(
      v.object({
        unitId: v.id('cages'),
        unitName: v.string(),
        unitType: v.string(),
        species: v.union(v.string(), v.null()),
        reason: attentionReason,
        kind: v.union(v.literal('water'), v.literal('density'), v.literal('entry')),
        tone: v.union(v.literal('alert'), v.literal('warn')),
        evidence: v.record(v.string(), v.union(v.string(), v.number(), v.null())),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'production.view', locationId: args.locationId })
    if (!m.companyId) return { total: 0, rows: [] }
    const companyId = m.companyId
    const scope = m.siteScope
    const limit = Math.max(1, Math.min(20, Math.floor(args.limit ?? 3)))

    const alerts: Doc<'farmAlerts'>[] = []
    for (const status of ['open', 'acknowledged'] as const) {
      alerts.push(
        ...(await ctx.db
          .query('farmAlerts')
          .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', status))
          .take(ALERT_CAP)),
      )
    }
    const cages = siteFilter(await companyCages(ctx, companyId, args.locationId), scope, undefined).filter(
      (c) => !c.archivedAt && c.status === 'active',
    )
    const byId = new Map(cages.map((c) => [String(c._id), c]))
    const company = await ctx.db.get(companyId)
    const { farmRules } = mergeSettings(company?.settings)

    type Item = {
      unitId: string
      reason: AttentionReason
      tone: 'alert' | 'warn'
      rank: number
      evidence: Record<string, string | number | null>
    }
    const items: Item[] = []
    for (const a of alerts) {
      // Alerts of a unit with no site are for all-sites members only (as farmAlerts.list).
      if (scope !== 'all' && !(a.locationId && scope.has(a.locationId))) continue
      if (!byId.has(String(a.unitId))) continue
      items.push({
        unitId: String(a.unitId),
        reason: a.rule,
        tone: a.severity === 'critical' ? 'alert' : 'warn',
        rank: SEVERITY_RANK[a.severity],
        evidence: a.evidence,
      })
    }
    for (const c of cages) {
      const d = densityStatus(c, c.currentCount ?? 0, farmRules)
      if (d.level !== 'warn' && d.level !== 'over') continue
      items.push({
        unitId: String(c._id),
        reason: 'density',
        tone: d.level === 'over' ? 'alert' : 'warn',
        rank: d.level === 'over' ? 20 : 5,
        evidence: { density: d.density, unit: d.unit, max: d.max, pct: d.pctOfMax, level: d.level },
      })
    }
    const picked = pickAttention(items)
    return {
      total: picked.length,
      rows: picked.slice(0, limit).map((i) => {
        const c = byId.get(i.unitId)!
        return {
          unitId: c._id,
          unitName: c.name,
          unitType: unitTypeOf(c),
          species: c.species ?? null,
          reason: i.reason,
          kind: attentionKind(i.reason),
          tone: i.tone,
          evidence: i.evidence,
        }
      }),
    }
  },
})

const activityType = v.union(v.literal('stocking'), v.literal('transfer'), v.literal('harvest'), v.literal('feed'))

/**
 * Farm activity (Paper 01): stockings, fish transfers, harvests and feed
 * issued, newest first, optionally one type and a search on unit or batch.
 */
export const activity = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    type: v.optional(activityType),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      type: activityType,
      date: v.string(),
      unit: v.string(),
      batch: v.union(v.string(), v.null()),
      fish: v.union(v.number(), v.null()),
      biomassKg: v.union(v.number(), v.null()),
      status: v.union(
        v.literal('pending_approval'),
        v.literal('approved'),
        v.literal('rejected'),
        v.literal('completed'),
        v.literal('in_progress'),
        v.literal('reversed'),
      ),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'production.view', locationId: args.locationId })
    if (!m.companyId) return []
    const companyId = m.companyId
    const scope = m.siteScope
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 8)))
    // A search looks further back than the first page.
    const scan = args.search?.trim() ? ACTIVITY_SCAN : limit
    const want = (t: string) => !args.type || args.type === t

    const names = new Map<string, string>()
    const unitName = async (id: Id<'cages'> | undefined) => {
      if (!id) return '—'
      const key = String(id)
      if (!names.has(key)) names.set(key, (await ctx.db.get(id))?.name ?? '—')
      return names.get(key)!
    }
    const batchNames = new Map<string, string | null>()
    const batchName = async (id: Id<'batches'> | undefined) => {
      if (!id) return null
      const key = String(id)
      if (!batchNames.has(key)) batchNames.set(key, (await ctx.db.get(id))?.batchNumber ?? null)
      return batchNames.get(key)!
    }

    const rows: ActivityRow[] = []
    if (want('stocking')) {
      const stockings = await ctx.db
        .query('stockingHistory')
        .withIndex('by_companyId_and_stockingDate', (q) => q.eq('companyId', companyId))
        .order('desc')
        .take(scan)
      for (const s of siteFilter(stockings, scope, args.locationId)) {
        if (s.deletedAt) continue
        rows.push({
          id: String(s._id),
          type: 'stocking',
          date: s.stockingDate,
          unit: await unitName(s.cageId),
          batch: s.batchNumber || null,
          fish: s.fishCount,
          biomassKg: (s.fishCount * s.initialAbw) / 1000,
          status: s.status,
          createdAt: s._creationTime,
        })
      }
    }
    if (want('transfer')) {
      const transfers = await ctx.db
        .query('fishTransfers')
        .withIndex('by_companyId_and_transferDate', (q) => q.eq('companyId', companyId))
        .order('desc')
        .take(scan)
      for (const t of transfers) {
        const inScope =
          scope === 'all' ||
          [t.sourceLocationId, t.destinationLocationId].some((id) => !id || scope.has(id))
        const atSite =
          !args.locationId || t.sourceLocationId === args.locationId || t.destinationLocationId === args.locationId
        if (!inScope || !atSite) continue
        rows.push({
          id: String(t._id),
          type: 'transfer',
          date: t.transferDate,
          unit: `${await unitName(t.sourceCageId)} → ${await unitName(t.destinationCageId)}`,
          batch: await batchName(t.batchId),
          fish: t.quantity,
          biomassKg: t.biomass,
          status: t.reversedAt ? 'reversed' : t.status,
          createdAt: t._creationTime,
        })
      }
    }
    if (want('harvest')) {
      const harvests = await ctx.db
        .query('harvestRecords')
        .withIndex('by_company_and_harvestDate', (q) => q.eq('companyId', companyId))
        .order('desc')
        .take(scan)
      for (const h of siteFilter(harvests, scope, args.locationId)) {
        if (!isRealHarvest(h)) continue
        rows.push({
          id: String(h._id),
          type: 'harvest',
          date: h.harvestDate,
          unit: await unitName(h.cageId),
          batch: await batchName(h.batchId),
          fish: h.estimatedCount,
          biomassKg: h.totalWeight,
          status: h.status ?? 'completed',
          createdAt: h._creationTime,
        })
      }
    }
    if (want('feed')) {
      const issues = await ctx.db
        .query('feedUsage')
        .withIndex('by_companyId_and_source_and_usageDate', (q) =>
          q.eq('companyId', companyId).eq('source', 'issue'),
        )
        .order('desc')
        .take(scan)
      const feedNames = new Map<string, string | null>()
      for (const f of siteFilter(issues, scope, args.locationId)) {
        if (f.deletedAt) continue
        const key = String(f.feedTypeId)
        if (!feedNames.has(key)) feedNames.set(key, (await ctx.db.get(f.feedTypeId))?.name ?? null)
        rows.push({
          id: String(f._id),
          type: 'feed',
          date: f.usageDate,
          unit: await unitName(f.cageId),
          batch: feedNames.get(key) ?? null,
          fish: null,
          biomassKg: f.quantity,
          status: 'completed',
          createdAt: f._creationTime,
        })
      }
    }
    return mergeActivity(rows, args.search, limit)
  },
})
