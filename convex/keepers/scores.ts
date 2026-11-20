/**
 * Keeper scorecard (Paper 54 "How each keeper's cages are doing"), worded to
 * coach, not to blame. Precomputed once a night per organization so the
 * drill-in reads one row per keeper plus one farm row:
 *
 *   on time   entries made on their day / unit-days, last 14 days
 *   survival  mean survival % of the units' open cycles (rollups)
 *   FCR       mean eFCR of the units' open cycles (rollups), worst unit named
 *   samplings units sampled in the last 14 days / units stocked
 *
 * `refresh` (an action) reads the organization 100 units per query, so no
 * transaction reads two weeks of records for a thousand units, then writes
 * the rows in one mutation.
 */
import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { addDays, todayIn, zoneFor } from '../lib/dates'
import { needsDailyLog } from './model'

const WINDOW_DAYS = 14
const PAGE = 100
const MAX_PAGES = 50

const acc = v.object({
  units: v.number(),
  unitDays: v.number(),
  onTime: v.number(),
  survSum: v.number(),
  survN: v.number(),
  fcrSum: v.number(),
  fcrN: v.number(),
  sampled: v.number(),
  stocked: v.number(),
  worstName: v.union(v.string(), v.null()),
  worstFcr: v.union(v.number(), v.null()),
})
type Acc = typeof acc.type

const empty = (): Acc => ({ units: 0, unitDays: 0, onTime: 0, survSum: 0, survN: 0, fcrSum: 0, fcrN: 0, sampled: 0, stocked: 0, worstName: null, worstFcr: null })

export function mergeAcc(a: Acc, b: Acc): Acc {
  const worst = (b.worstFcr ?? -1) > (a.worstFcr ?? -1) ? b : a
  return {
    units: a.units + b.units,
    unitDays: a.unitDays + b.unitDays,
    onTime: a.onTime + b.onTime,
    survSum: a.survSum + b.survSum,
    survN: a.survN + b.survN,
    fcrSum: a.fcrSum + b.fcrSum,
    fcrN: a.fcrN + b.fcrN,
    sampled: a.sampled + b.sampled,
    stocked: a.stocked + b.stocked,
    worstName: worst.worstName,
    worstFcr: worst.worstFcr,
  }
}

/** One page of units: partial sums per keeper ('' = no keeper) and for the farm. */
export const page = internalQuery({
  args: { companyId: v.id('companies'), cursor: v.union(v.string(), v.null()), from: v.string(), to: v.string() },
  returns: v.object({
    rows: v.array(v.object({ keeperId: v.string(), acc })),
    cursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { companyId, cursor, from, to }) => {
    const company = await ctx.db.get(companyId)
    const res = await ctx.db
      .query('cages')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .paginate({ numItems: PAGE, cursor })
    const zones = new Map<string, string>()
    const by = new Map<string, Acc>()
    for (const u of res.page) {
      if (u.archivedAt || !needsDailyLog(u)) continue
      const a = await ctx.db
        .query('cageKeepers')
        .withIndex('by_unitId_and_active', (q) => q.eq('unitId', u._id).eq('active', true))
        .first()
      const key = a?.keeperId ?? ''
      let zone = zones.get(u.locationId ?? '')
      if (!zone) {
        zone = zoneFor(u.locationId ? await ctx.db.get(u.locationId) : null, company)
        zones.set(u.locationId ?? '', zone)
      }
      const start = u.stockingDate && u.stockingDate > from ? u.stockingDate : from
      const days = Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1)
      const recs = await ctx.db
        .query('dailyRecords')
        .withIndex('by_cage_date', (q) => q.eq('cageId', u._id).gte('date', start).lte('date', to))
        .take(WINDOW_DAYS + 1)
      const onTime = recs.filter((r) => todayIn(zone, r._creationTime) <= r.date).length
      const stats = u.currentBatchId
        ? await ctx.db
            .query('batchStats')
            .withIndex('by_unitId_and_batchId', (q) => q.eq('unitId', u._id).eq('batchId', u.currentBatchId!))
            .unique()
        : null
      const k = stats?.open ? stats.kpis : null
      const sample = await ctx.db
        .query('biweeklyRecords')
        .withIndex('by_cage_and_date', (q) => q.eq('cageId', u._id).gte('date', from))
        .first()
      const one: Acc = {
        units: 1,
        unitDays: Math.min(days, WINDOW_DAYS),
        onTime: Math.min(onTime, WINDOW_DAYS),
        survSum: k?.survival_pct ?? 0,
        survN: k?.survival_pct != null ? 1 : 0,
        fcrSum: k?.efcr ?? 0,
        fcrN: k?.efcr != null ? 1 : 0,
        sampled: sample ? 1 : 0,
        stocked: 1,
        worstName: k?.efcr != null ? u.name : null,
        worstFcr: k?.efcr ?? null,
      }
      for (const key2 of [key, '*']) by.set(key2, mergeAcc(by.get(key2) ?? empty(), one))
    }
    return {
      rows: [...by.entries()].map(([keeperId, a]) => ({ keeperId, acc: a })),
      cursor: res.continueCursor,
      isDone: res.isDone,
    }
  },
})

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null)
const mean = (s: number, n: number, dp: number) => (n > 0 ? Math.round((s / n) * 10 ** dp) / 10 ** dp : null)

export const save = internalMutation({
  args: { companyId: v.id('companies'), asOf: v.string(), rows: v.array(v.object({ keeperId: v.string(), acc })) },
  returns: v.number(),
  handler: async (ctx, { companyId, asOf, rows }) => {
    const old = await ctx.db
      .query('keeperScores')
      .withIndex('by_companyId_and_keeperId', (q) => q.eq('companyId', companyId))
      .take(4000)
    for (const r of old) await ctx.db.delete(r._id)
    const now = Date.now()
    let n = 0
    for (const { keeperId, acc: a } of rows) {
      if (keeperId === '') continue
      await ctx.db.insert('keeperScores', {
        companyId,
        keeperId: keeperId === '*' ? undefined : (keeperId as Id<'users'>),
        asOf,
        units: a.units,
        onTimePct: pct(a.onTime, a.unitDays),
        survivalPct: mean(a.survSum, a.survN, 1),
        fcr: mean(a.fcrSum, a.fcrN, 2),
        sampled: a.sampled,
        stocked: a.stocked,
        worstFcrUnit: a.worstName ?? undefined,
        updatedAt: now,
      })
      n += 1
    }
    return n
  },
})

export const companyInfo = internalQuery({
  args: { companyId: v.id('companies'), now: v.number() },
  returns: v.union(v.null(), v.object({ asOf: v.string() })),
  handler: async (ctx, { companyId, now }) => {
    const company = await ctx.db.get(companyId)
    if (!company || company.status !== 'approved') return null
    return { asOf: addDays(todayIn(zoneFor(null, company), now), -1) }
  },
})

/** Recompute one organization's scorecard (yesterday and the 13 days before). */
export const refresh = internalAction({
  args: { companyId: v.id('companies') },
  returns: v.number(),
  handler: async (ctx, { companyId }): Promise<number> => {
    const info: { asOf: string } | null = await ctx.runQuery(internal.keepers.scores.companyInfo, { companyId, now: Date.now() })
    if (!info) return 0
    const to = info.asOf
    const from = addDays(to, -(WINDOW_DAYS - 1))
    const by = new Map<string, Acc>()
    let cursor: string | null = null
    for (let i = 0; i < MAX_PAGES; i++) {
      const res: { rows: Array<{ keeperId: string; acc: Acc }>; cursor: string; isDone: boolean } = await ctx.runQuery(
        internal.keepers.scores.page,
        { companyId, cursor, from, to },
      )
      for (const r of res.rows) by.set(r.keeperId, mergeAcc(by.get(r.keeperId) ?? empty(), r.acc))
      if (res.isDone) break
      cursor = res.cursor
    }
    return await ctx.runMutation(internal.keepers.scores.save, {
      companyId,
      asOf: to,
      rows: [...by.entries()].map(([keeperId, acc]) => ({ keeperId, acc })),
    })
  },
})

/** Nightly: queue a refresh for every organization with keepers (pages itself). */
export const refreshAll = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.number(),
  handler: async (ctx, { cursor }) => {
    const res = await ctx.db
      .query('companies')
      .withIndex('by_status', (q) => q.eq('status', 'approved'))
      .paginate({ numItems: 50, cursor: cursor ?? null })
    let n = 0
    for (const c of res.page) {
      const any = await ctx.db
        .query('cageKeepers')
        .withIndex('by_companyId_and_active', (q) => q.eq('companyId', c._id).eq('active', true))
        .first()
      if (!any) continue
      await ctx.scheduler.runAfter(n * 2000, internal.keepers.scores.refresh, { companyId: c._id })
      n += 1
    }
    if (!res.isDone) await ctx.scheduler.runAfter(0, internal.keepers.scores.refreshAll, { cursor: res.continueCursor })
    return n
  },
})
