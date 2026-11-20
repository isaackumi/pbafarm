/**
 * Keeper views for everyone: "My cages" on the phone (Paper 55), the keeper
 * chip and history on a unit (cage detail), and the organization's keeper
 * settings. Reads are by person or by unit through an index, capped.
 */
import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { assertSiteInScope, can, requireMember } from '../lib/permissions'
import { userError } from '../lib/errors'
import { addDays } from '../lib/dates'
import { asOfDate } from '../lib/scope'
import { round } from '../lib/kpi'
import { logAudit } from '../lib/tenancy'
import { cageRation, tablesFor } from '../feedingPlans'
import {
  byUnitName,
  coverActiveOn,
  coverPersonFor,
  coversOfKeeper,
  isHhmm,
  keeperSettingsOf,
  needsDailyLog,
  openCovers,
  personName,
} from './model'

/** Days without a sample after which a stocked unit is "sampling due". */
const SAMPLE_EVERY_DAYS = 14

async function unitCard(
  ctx: QueryCtx,
  u: Doc<'cages'>,
  date: string,
  tables: Awaited<ReturnType<typeof tablesFor>> | null,
  coverFor: string | null,
) {
  const today = await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage_date', (q) => q.eq('cageId', u._id).eq('date', date))
    .first()
  const prev = await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage_date', (q) => q.eq('cageId', u._id).eq('date', addDays(date, -1)))
    .first()
  const lastSample = await ctx.db
    .query('biweeklyRecords')
    .withIndex('by_cage_and_date', (q) => q.eq('cageId', u._id))
    .order('desc')
    .first()
  const lastFed = await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage_date', (q) => q.eq('cageId', u._id).lt('date', date))
    .order('desc')
    .take(5)
  const since = lastSample?.date ?? u.stockingDate ?? null
  const sampleDue = !!since && needsDailyLog(u) && addDays(since, SAMPLE_EVERY_DAYS) <= date
  const ration = tables && needsDailyLog(u) ? (await cageRation(ctx, u, tables)).ration : null
  return {
    id: u._id,
    name: u.name,
    locationId: u.locationId ?? null,
    fish: u.currentCount ?? null,
    rationKg: ration && ration.ok ? round(ration.kgPerDay, 1) : null,
    deadYesterday: prev ? prev.mortality : null,
    sampleDue,
    feedTypeId: lastFed.find((r) => r.feedTypeId)?.feedTypeId ?? null,
    coverFor,
    logged: today
      ? { at: today._creationTime, feedKg: today.feedAmount, mortality: today.mortality }
      : null,
  }
}

/**
 * The units I log today: the ones I keep (unless I am away and covered) and
 * the ones I cover for someone. To do first, then done.
 */
export const myCages = query({
  args: { asOf: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'production.view' })
    const companyId = m.companyId
    if (!companyId) throw userError('FORBIDDEN', 'Your account is not linked to an organization')
    const me = m.user._id
    const date = asOfDate(args.asOf)
    const { settings } = await keeperSettingsOf(ctx, companyId)

    const mine = (
      await ctx.db
        .query('cageKeepers')
        .withIndex('by_keeperId_and_active', (q) => q.eq('keeperId', me).eq('active', true))
        .take(500)
    ).filter((a) => a.companyId === companyId)
    const myCovers = (await coversOfKeeper(ctx, me, date)).filter((c) => c.companyId === companyId)
    const awayNow = myCovers.find((c) => coverActiveOn(c, date)) ?? null

    const units: Array<{ unit: Doc<'cages'>; coverFor: string | null }> = []
    const backups = new Map<string, number>()
    for (const a of mine) {
      if (awayNow) break
      const u = await ctx.db.get(a.unitId)
      if (!u || u.archivedAt || u.companyId !== companyId) continue
      units.push({ unit: u, coverFor: null })
      if (a.backupId) backups.set(a.backupId, (backups.get(a.backupId) ?? 0) + 1)
    }
    // Units I cover today.
    const covering = (await openCovers(ctx, companyId, date)).filter(
      (c) => coverActiveOn(c, date) && (c.coverId === me || (c.split ?? []).some((s) => s.coverId === me)),
    )
    for (const c of covering.slice(0, 20)) {
      const theirs = await ctx.db
        .query('cageKeepers')
        .withIndex('by_keeperId_and_active', (q) => q.eq('keeperId', c.keeperId).eq('active', true))
        .take(500)
      const name = personName(await ctx.db.get(c.keeperId))
      for (const a of theirs) {
        if (a.companyId !== companyId || coverPersonFor(c, a.unitId) !== me) continue
        const u = await ctx.db.get(a.unitId)
        if (u && !u.archivedAt) units.push({ unit: u, coverFor: name })
      }
    }

    const stocked = units.filter((x) => needsDailyLog(x.unit) && (m.siteScope === 'all' || !x.unit.locationId || m.siteScope.has(x.unit.locationId)))
    stocked.sort((a, b) => byUnitName(a.unit, b.unit))
    const tables = stocked.length ? await tablesFor(ctx, companyId) : null
    const cards = []
    for (const x of stocked.slice(0, 100)) cards.push(await unitCard(ctx, x.unit, date, tables, x.coverFor))
    let backupId: string | null = null
    let best = 0
    for (const [k, n] of backups) if (n > best) [backupId, best] = [k, n]
    const site = stocked[0]?.unit.locationId ? await ctx.db.get(stocked[0].unit.locationId) : null
    return {
      date,
      deadline: settings.deadline,
      siteName: site?.name ?? null,
      backupName: backupId ? personName(await ctx.db.get(backupId as Id<'users'>)) : null,
      away: awayNow ? { toDate: awayNow.toDate, coverName: personName(await ctx.db.get(awayNow.coverId)) } : null,
      canLog: can(m, 'production.daily.record'),
      todo: cards.filter((c) => !c.logged).sort((a, b) => Number(b.sampleDue) - Number(a.sampleDue)),
      done: cards.filter((c) => c.logged).sort((a, b) => (a.logged!.at - b.logged!.at)),
      total: cards.length,
    }
  },
})

/** Keeper chip and history of one unit (cage detail). */
export const forUnit = query({
  args: { unitId: v.id('cages'), asOf: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'production.view' })
    const unit = await ctx.db.get(args.unitId)
    if (!unit || unit.companyId !== m.companyId) throw userError('NOT_FOUND', 'Unit not found')
    assertSiteInScope(m, unit.locationId)
    const date = asOfDate(args.asOf)
    const rows = await ctx.db
      .query('cageKeepers')
      .withIndex('by_unitId_and_active', (q) => q.eq('unitId', unit._id))
      .order('desc')
      .take(30)
    const open = rows.find((r) => r.active) ?? null
    const contacts = can(m, 'production.keepers.manage') || can(m, 'workforce.manage')
    const person = async (id: Id<'users'> | undefined) => {
      if (!id) return null
      const u = await ctx.db.get(id)
      return { id, name: personName(u), phone: contacts ? u?.phone ?? null : null }
    }
    let cover = null
    if (open) {
      const c = (await coversOfKeeper(ctx, open.keeperId, date)).find((x) => x.companyId === unit.companyId && coverActiveOn(x, date))
      if (c) cover = { person: await person(coverPersonFor(c, unit._id)), toDate: c.toDate }
    }
    const history = []
    for (const r of [...rows].sort((a, b) => b.assignedAt - a.assignedAt).slice(0, 20)) {
      history.push({
        id: r._id,
        keeper: personName(await ctx.db.get(r.keeperId)),
        backup: r.backupId ? personName(await ctx.db.get(r.backupId)) : null,
        sinceDate: r.sinceDate,
        untilDate: r.untilDate ?? null,
        assignedBy: personName(await ctx.db.get(r.assignedBy)),
      })
    }
    return {
      keeper: open ? await person(open.keeperId) : null,
      backup: open ? await person(open.backupId) : null,
      sinceDate: open?.sinceDate ?? null,
      cover,
      history,
      canManage: can(m, 'production.keepers.manage'),
    }
  },
})

const settingsView = v.object({
  capacity: v.number(),
  deadline: v.string(),
  backupAfterMin: v.number(),
  managerAfterMin: v.number(),
  escalate: v.boolean(),
  ownCagesOnly: v.boolean(),
})

export const settings = query({
  args: {},
  returns: settingsView,
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'production.view' })
    if (!m.companyId) throw userError('FORBIDDEN', 'Your account is not linked to an organization')
    return (await keeperSettingsOf(ctx, m.companyId)).settings
  },
})

export const updateSettings = mutation({
  args: {
    capacity: v.optional(v.number()),
    deadline: v.optional(v.string()),
    backupAfterMin: v.optional(v.number()),
    managerAfterMin: v.optional(v.number()),
    escalate: v.optional(v.boolean()),
    ownCagesOnly: v.optional(v.boolean()),
  },
  returns: settingsView,
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'production.keepers.manage' })
    const companyId = m.companyId
    if (!companyId) throw userError('FORBIDDEN', 'Your account is not linked to an organization')
    // These rules apply to every site: a manager limited to some sites cannot change them.
    if (m.siteScope !== 'all') throw userError('FORBIDDEN', 'Only a manager with access to every site can change keeper rules', { reason: 'SITE_FORBIDDEN' })
    const whole = (n: number | undefined, lo: number, hi: number, label: string) => {
      if (n === undefined) return
      if (!Number.isInteger(n) || n < lo || n > hi) throw userError('VALIDATION', `${label} must be a whole number from ${lo} to ${hi}`)
    }
    whole(args.capacity, 1, 1000, 'Capacity')
    whole(args.backupAfterMin, 0, 720, 'Minutes before the backup is told')
    whole(args.managerAfterMin, 0, 1440, 'Minutes before managers are told')
    if (args.deadline !== undefined && !isHhmm(args.deadline)) throw userError('VALIDATION', 'Deadline must be HH:MM')
    const { row } = await keeperSettingsOf(ctx, companyId)
    const patch = { ...args, updatedAt: Date.now(), updatedBy: m.user._id }
    if (row) await ctx.db.patch(row._id, patch)
    else await ctx.db.insert('keeperSettings', { companyId, ...patch })
    await logAudit(ctx, { actionType: 'update', tableName: 'keeperSettings', recordId: companyId, previousValues: row, newValues: args })
    return (await keeperSettingsOf(ctx, companyId)).settings
  },
})
