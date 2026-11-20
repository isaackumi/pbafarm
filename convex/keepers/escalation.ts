/**
 * Daily entry deadline and escalation (cage keepers).
 *
 * Every 15 minutes `tick` looks at organizations that have keepers. For each
 * site, in the site's own time zone, after the deadline (default 10:00):
 *   stage 1  the effective keeper of each unit not logged yet (the cover
 *            while the keeper is away),
 *   stage 2  backupAfterMin later (default 60), the unit's backup,
 *   stage 3  managerAfterMin later (default 120), the managers with access to
 *            the site, with units that have no keeper too.
 * Each person gets each stage at most once a day (keeperAlerts), on in-app
 * and WhatsApp through notifyUsers, so their channel preferences and quiet
 * hours apply. A run outside every site's window reads nothing heavy.
 */
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { todayIn, zoneFor } from '../lib/dates'
import { notifyUsers } from '../lib/notify'
import { nameList } from '../automation/checks'
import { escalationStage } from './balance'
import {
  MAX_UNITS,
  byUnitName,
  coverActiveOn,
  coverPersonFor,
  keeperSettingsOf,
  memberOf,
  needsDailyLog,
  openAssignments,
  openCovers,
  personName,
  reachesSite,
} from './model'

const COMPANY_PAGE = 50
const ALERT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function minutesIn(timeZone: string, now: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now))
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

/** Send once per key and person (any channel). Returns true when sent now. */
export async function alertOnce(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  user: Doc<'users'>,
  key: string,
  n: { title: string; message: string; link: string; source: string },
) {
  const full = `${key}:${user._id}`
  const seen = await ctx.db
    .query('keeperAlerts')
    .withIndex('by_key', (q) => q.eq('key', full))
    .first()
  if (seen) return false
  await ctx.db.insert('keeperAlerts', { companyId, key: full, userId: user._id, createdAt: Date.now() })
  await notifyUsers(ctx, {
    companyId,
    users: [user],
    channels: ['in_app', 'whatsapp'],
    level: 'warning',
    title: n.title,
    message: n.message,
    link: n.link,
    source: n.source,
  })
  return true
}

/** Every 15 minutes: queue the organizations that have keepers. Pages itself. */
export const tick = internalMutation({
  args: { cursor: v.optional(v.string()), now: v.optional(v.number()) },
  returns: v.object({ queued: v.number(), done: v.boolean() }),
  handler: async (ctx, { cursor, now }) => {
    const at = now ?? Date.now()
    const page = await ctx.db
      .query('companies')
      .withIndex('by_status', (q) => q.eq('status', 'approved'))
      .paginate({ numItems: COMPANY_PAGE, cursor: cursor ?? null })
    let queued = 0
    for (const c of page.page) {
      const any = await ctx.db
        .query('cageKeepers')
        .withIndex('by_companyId_and_active', (q) => q.eq('companyId', c._id).eq('active', true))
        .first()
      if (!any) continue
      await ctx.scheduler.runAfter(0, internal.keepers.escalation.company, { companyId: c._id, now: at })
      queued += 1
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.keepers.escalation.tick, { cursor: page.continueCursor, now: at })
    }
    return { queued, done: page.isDone }
  },
})

/** One organization's reminders and escalation at `now` (tests pass `now`). */
export const company = internalMutation({
  args: { companyId: v.id('companies'), now: v.optional(v.number()) },
  returns: v.object({ sent: v.number(), stage: v.number() }),
  handler: async (ctx, { companyId, now: nowArg }) => {
    const now = nowArg ?? Date.now()
    const company = await ctx.db.get(companyId)
    if (!company || company.status !== 'approved' || company.suspendedAt) return { sent: 0, stage: 0 }
    const { settings } = await keeperSettingsOf(ctx, companyId)
    if (!settings.escalate) return { sent: 0, stage: 0 }

    const sites = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(500)
    // Units without a site use the organization's zone.
    const zones = [{ id: null as Id<'farmLocations'> | null, name: '', zone: zoneFor(null, company) }, ...sites.map((s) => ({ id: s._id, name: s.name, zone: zoneFor(s, company) }))]
    const live = zones
      .map((z) => ({ ...z, stage: escalationStage(minutesIn(z.zone, now), settings), date: todayIn(z.zone, now) }))
      .filter((z) => z.stage > 0)
    if (!live.length) return { sent: 0, stage: 0 }

    const units = (
      await ctx.db
        .query('cages')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(MAX_UNITS)
    ).filter((u) => !u.archivedAt && needsDailyLog(u))
    const siteOf = new Map(live.map((z) => [z.id ?? '', z]))
    const logged = new Map<string, Set<string>>()
    for (const date of new Set(live.map((z) => z.date))) {
      const rows = await ctx.db
        .query('dailyRecords')
        .withIndex('by_company_and_date', (q) => q.eq('companyId', companyId).eq('date', date))
        .take(MAX_UNITS * 2)
      logged.set(date, new Set(rows.map((r) => r.cageId as string)))
    }
    const assignments = await openAssignments(ctx, companyId)
    const dates = [...new Set(live.map((z) => z.date))].sort()
    const covers = await openCovers(ctx, companyId, dates[0])

    type Missing = { unit: Doc<'cages'>; site: (typeof live)[number]; keeperId?: Id<'users'>; effectiveId?: Id<'users'>; backupId?: Id<'users'> }
    const missing: Missing[] = []
    for (const u of units) {
      const site = siteOf.get(u.locationId ?? '')
      if (!site) continue
      if (logged.get(site.date)?.has(u._id)) continue
      const a = assignments.get(u._id)
      if (!a) {
        missing.push({ unit: u, site })
        continue
      }
      const c = covers.find((x) => x.keeperId === a.keeperId && coverActiveOn(x, site.date))
      missing.push({ unit: u, site, keeperId: a.keeperId, effectiveId: c ? coverPersonFor(c, u._id) : a.keeperId, backupId: a.backupId })
    }
    if (!missing.length) return { sent: 0, stage: Math.max(...live.map((z) => z.stage)) }

    // Only current members are told, and only about units at sites they can see:
    // an assignment left behind by someone removed from the organization alerts nobody.
    const members = new Map<string, Awaited<ReturnType<typeof memberOf>>>()
    const memberFor = async (id: Id<'users'>) => {
      if (!members.has(id)) members.set(id, await memberOf(ctx, companyId, id))
      return members.get(id) ?? null
    }
    const reachable = async (id: Id<'users'>, rows: Missing[]) => {
      const m = await memberFor(id)
      return m ? { user: m.user, rows: rows.filter((r) => reachesSite(m.membership, r.unit.locationId)) } : null
    }
    const group = <K extends string>(rows: Missing[], key: (m: Missing) => K | undefined) => {
      const out = new Map<K, Missing[]>()
      for (const m of rows) {
        const k = key(m)
        if (k) out.set(k, [...(out.get(k) ?? []), m])
      }
      return out
    }
    const names = (rows: Missing[]) => nameList(rows.map((m) => m.unit).sort(byUnitName).map((u) => u.name))
    let sent = 0

    // Stage 1: the person who should log the unit today.
    for (const [id, all] of group(missing.filter((m) => m.site.stage >= 1), (m) => m.effectiveId)) {
      const r = await reachable(id, all)
      if (!r || !r.rows.length) continue
      const { user: u, rows } = r
      const date = rows[0].site.date
      if (
        await alertOnce(ctx, companyId, u, `keeper-esc:1:${date}`, {
          title: `${rows.length} unit${rows.length === 1 ? '' : 's'} to log, due by ${settings.deadline}`,
          message: `${names(rows)} not logged yet today.`,
          link: '/my-cages',
          source: 'keepers.deadline',
        })
      )
        sent += 1
    }
    // Stage 2: the backup.
    for (const [id, all] of group(missing.filter((m) => m.site.stage >= 2), (m) => m.backupId)) {
      const r = await reachable(id, all)
      if (!r || !r.rows.length) continue
      const { user: u, rows } = r
      const keeper = rows[0].keeperId ? personName((await memberFor(rows[0].keeperId))?.user) : ''
      if (
        await alertOnce(ctx, companyId, u, `keeper-esc:2:${rows[0].site.date}`, {
          title: `You are the backup: ${rows.length} unit${rows.length === 1 ? '' : 's'} not logged`,
          message: `${names(rows)}${keeper ? ` (${keeper}'s)` : ''} still had no entry ${settings.backupAfterMin} minutes after ${settings.deadline}.`,
          link: `/daily-entry?cages=${rows.slice(0, 50).map((m) => m.unit._id).join(',')}`,
          source: 'keepers.backup',
        })
      )
        sent += 1
    }
    // Stage 3: managers with access to the site.
    const late = missing.filter((m) => m.site.stage >= 3)
    if (late.length) {
      const memberships = await ctx.db
        .query('memberships')
        .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
        .take(1500)
      const managers: Array<{ user: Doc<'users'>; m: Doc<'memberships'> }> = []
      for (const m of memberships) {
        if (m.status !== 'active' || !(await managesKeepers(ctx, m))) continue
        const u = (await memberFor(m.userId))?.user
        if (u) managers.push({ user: u, m })
      }
      for (const { user, m } of managers.slice(0, 50)) {
        const mine = late.filter((x) => m.allLocations || !x.unit.locationId || (m.locationIds ?? []).includes(x.unit.locationId))
        if (!mine.length) continue
        const noKeeper = mine.filter((x) => !x.keeperId).length
        if (
          await alertOnce(ctx, companyId, user, `keeper-esc:3:${mine[0].site.date}`, {
            title: `${mine.length} unit${mine.length === 1 ? '' : 's'} still not logged`,
            message: `${names(mine)}${noKeeper ? `; ${noKeeper} have no keeper` : ''}. Keeper and backup were told.`,
            link: '/cage-keepers',
            source: 'keepers.manager',
          })
        )
          sent += 1
      }
    }
    return { sent, stage: Math.max(...live.map((z) => z.stage)) }
  },
})

async function managesKeepers(ctx: MutationCtx, m: Doc<'memberships'>) {
  if (m.roleId) {
    const role = await ctx.db.get(m.roleId)
    return !!role && role.companyId === m.companyId && !role.archived && role.permissions.includes('production.keepers.manage')
  }
  return ['owner', 'admin', 'manager'].includes(m.roleKey)
}

/** Drop markers older than 30 days, a page at a time. */
export const pruneAlerts = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query('keeperAlerts')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', Date.now() - ALERT_RETENTION_MS))
      .take(500)
    for (const r of old) await ctx.db.delete(r._id)
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.keepers.escalation.pruneAlerts, {})
    return old.length
  },
})

/** Units a person should log today (effective keeper): for reminders that list "your" units. null = keeps none. */
export async function ownUnitIds(ctx: QueryCtx, companyId: Id<'companies'>, userId: Id<'users'>, date: string) {
  const mine = (
    await ctx.db
      .query('cageKeepers')
      .withIndex('by_keeperId_and_active', (q) => q.eq('keeperId', userId).eq('active', true))
      .take(500)
  ).filter((a) => a.companyId === companyId)
  const covers = (await openCovers(ctx, companyId, date)).filter((c) => coverActiveOn(c, date))
  const covering = covers.filter((c) => c.coverId === userId || (c.split ?? []).some((s) => s.coverId === userId))
  if (!mine.length && !covering.length) return null
  const out = new Set<string>()
  const away = covers.some((c) => c.keeperId === userId)
  if (!away) for (const a of mine) out.add(a.unitId)
  for (const c of covering.slice(0, 20)) {
    const theirs = await ctx.db
      .query('cageKeepers')
      .withIndex('by_keeperId_and_active', (q) => q.eq('keeperId', c.keeperId).eq('active', true))
      .take(500)
    for (const a of theirs) if (a.companyId === companyId && coverPersonFor(c, a.unitId) === userId) out.add(a.unitId)
  }
  return out
}
