/**
 * Cage keepers board (Paper 57 "At scale" and 54 "One row up close").
 *
 * `board` is one indexed, capped read of the organization: units
 * (`cages.by_company`, ≤ MAX_UNITS), today's daily records
 * (`dailyRecords.by_company_and_date`), open assignments
 * (`cageKeepers.by_companyId_and_active`) and open covers. It returns a
 * compact square per unit for the heatmap, the Anowa brief counts, and ONE
 * page of the keeper list, exceptions first (needs attention, then the rest),
 * with the healthy keepers counted instead of listed. The browser never gets
 * every row: the list is `limit`ed (≤ 200) and searched / filtered here.
 *
 * `row` is the drill-in for one site row (≤ 300 units of one site).
 *
 * "Today" is the date the browser passes (`asOf`), never the server clock
 * (queries are cached). Readers need production.keepers.manage.
 */
import { v } from 'convex/values'
import { query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireMember, type MemberContext } from '../lib/permissions'
import { userError } from '../lib/errors'
import { addDays } from '../lib/dates'
import { asOfDate } from '../lib/scope'
import { round } from '../lib/kpi'
import { cageRation, tablesFor } from '../feedingPlans'
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
  rowOf,
  type CoverLite,
} from './model'

export type UnitStatus = 'logged' | 'due' | 'none' | 'cover' | 'idle'

function inSites(m: MemberContext, locationId: Id<'farmLocations'> | undefined) {
  if (m.siteScope === 'all') return true
  return !locationId || m.siteScope.has(locationId)
}

export async function requireKeeperManager(ctx: QueryCtx, siteId?: Id<'farmLocations'> | null) {
  const m = await requireMember(ctx, { permission: 'production.keepers.manage', locationId: siteId ?? undefined })
  if (!m.companyId) throw userError('FORBIDDEN', 'Your account is not linked to an organization')
  return m as MemberContext & { companyId: Id<'companies'> }
}

/** Everything the board and the brief need, read once (bounded). */
export async function loadOrg(
  ctx: QueryCtx,
  m: MemberContext & { companyId: Id<'companies'> },
  date: string,
  siteId?: Id<'farmLocations'> | null,
) {
  const companyId = m.companyId
  const { settings } = await keeperSettingsOf(ctx, companyId)
  const sites = (
    await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(500)
  ).filter((s) => inSites(m, s._id))
  const siteName = new Map(sites.map((s) => [s._id as string, s.name]))
  const raw = siteId
    ? await ctx.db
        .query('cages')
        .withIndex('by_company_location', (q) => q.eq('companyId', companyId).eq('locationId', siteId))
        .take(MAX_UNITS + 1)
    : await ctx.db
        .query('cages')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(MAX_UNITS + 1)
  const truncated = raw.length > MAX_UNITS
  const units = raw
    .slice(0, MAX_UNITS)
    .filter((u) => !u.archivedAt && inSites(m, u.locationId))
    .sort((a, b) =>
      (siteName.get(a.locationId ?? '') ?? '').localeCompare(siteName.get(b.locationId ?? '') ?? '') ||
      rowOf(a).localeCompare(rowOf(b)) ||
      byUnitName(a, b),
    )
  const records = await ctx.db
    .query('dailyRecords')
    .withIndex('by_company_and_date', (q) => q.eq('companyId', companyId).eq('date', date))
    .take(MAX_UNITS * 2)
  const logged = new Map<Id<'cages'>, number>()
  for (const r of records) if (!logged.has(r.cageId)) logged.set(r.cageId, r._creationTime)
  const assignments = await openAssignments(ctx, companyId)
  const covers = await openCovers(ctx, companyId, date)
  const activeCovers = covers.filter((c) => coverActiveOn(c, date))
  return { settings, sites, siteName, units, truncated, logged, assignments, covers, activeCovers }
}

type Org = Awaited<ReturnType<typeof loadOrg>>

export function unitStatus(org: Pick<Org, 'logged' | 'assignments' | 'activeCovers'>, u: Doc<'cages'>): UnitStatus {
  if (!needsDailyLog(u)) return 'idle'
  const a = org.assignments.get(u._id)
  if (!a) return 'none'
  if (org.logged.has(u._id)) return 'logged'
  if (org.activeCovers.some((c) => c.keeperId === a.keeperId)) return 'cover'
  return 'due'
}

type KeeperRow = {
  kind: 'keeper'
  id: Id<'users'>
  name: string
  siteId: string | null
  site: string
  row: string
  units: number
  stocked: number
  logged: number
  due: number
  over: boolean
  away: { until: string; coverName: string } | null
  covering: { names: string[]; units: number; logged: number } | null
  backupName: string | null
  attention: boolean
  score: number
}

type GapRow = {
  kind: 'unassigned'
  id: string
  siteId: Id<'farmLocations'> | null
  site: string
  row: string
  units: number
  unitIds: Id<'cages'>[]
  since: string | null
  attention: true
  score: number
}

/** Names of the users behind a set of ids (one get each; ids are keepers of this organization). */
async function namesOf(ctx: QueryCtx, ids: Iterable<Id<'users'>>) {
  const out = new Map<string, string>()
  for (const id of new Set(ids)) out.set(id, personName(await ctx.db.get(id)))
  return out
}

function topOf(counts: Map<string, number>): string {
  let best = ''
  let n = -1
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c]
  return best
}

export function buildKeeperRows(org: Org, names: Map<string, string>, date: string) {
  const { settings, units, assignments, activeCovers, logged, siteName } = org
  type Acc = { units: number; stocked: number; logged: number; due: number; sites: Map<string, number>; rows: Map<string, number>; backup: Map<string, number> }
  const acc = new Map<Id<'users'>, Acc>()
  const gaps = new Map<string, GapRow>()
  const coverOf = new Map<string, CoverLite>()
  for (const c of activeCovers) coverOf.set(c.keeperId, c)
  const covering = new Map<string, { names: Set<string>; units: number; logged: number }>()

  for (const u of units) {
    const a = assignments.get(u._id)
    const site = siteName.get(u.locationId ?? '') ?? ''
    if (!a) {
      if (!needsDailyLog(u)) continue
      const key = `${u.locationId ?? ''}|${rowOf(u)}`
      const g =
        gaps.get(key) ??
        ({ kind: 'unassigned', id: `none:${key}`, siteId: u.locationId ?? null, site, row: rowOf(u), units: 0, unitIds: [], since: null, attention: true, score: 0 } as GapRow)
      g.units += 1
      if (g.unitIds.length < 200) g.unitIds.push(u._id)
      if (u.stockingDate && (!g.since || u.stockingDate > g.since)) g.since = u.stockingDate
      gaps.set(key, g)
      continue
    }
    const k = acc.get(a.keeperId) ?? { units: 0, stocked: 0, logged: 0, due: 0, sites: new Map(), rows: new Map(), backup: new Map() }
    k.units += 1
    k.sites.set(u.locationId ?? '', (k.sites.get(u.locationId ?? '') ?? 0) + 1)
    k.rows.set(rowOf(u), (k.rows.get(rowOf(u)) ?? 0) + 1)
    if (a.backupId) k.backup.set(a.backupId, (k.backup.get(a.backupId) ?? 0) + 1)
    if (needsDailyLog(u)) {
      k.stocked += 1
      if (logged.has(u._id)) k.logged += 1
      else k.due += 1
      const c = coverOf.get(a.keeperId)
      if (c) {
        const who = coverPersonFor(c, u._id)
        const cv = covering.get(who) ?? { names: new Set<string>(), units: 0, logged: 0 }
        cv.names.add(names.get(a.keeperId) ?? '')
        cv.units += 1
        if (logged.has(u._id)) cv.logged += 1
        covering.set(who, cv)
      }
    }
    acc.set(a.keeperId, k)
  }

  const rows: Array<KeeperRow | GapRow> = []
  for (const g of gaps.values()) {
    g.score = 1000 + g.units
    rows.push(g)
  }
  const keeperIds = new Set<Id<'users'>>([...acc.keys(), ...([...covering.keys()] as Id<'users'>[])])
  for (const id of keeperIds) {
    const k = acc.get(id) ?? { units: 0, stocked: 0, logged: 0, due: 0, sites: new Map(), rows: new Map(), backup: new Map() }
    const c = coverOf.get(id)
    const cv = covering.get(id)
    const over = k.units > settings.capacity
    const away = c ? { until: c.toDate, coverName: names.get(c.coverId) ?? '' } : null
    // Keepers away are covered: their due units are the cover's job, so only "away" shows.
    const due = away ? 0 : k.due
    const attention = over || due > 0 || !!away || !!cv
    const backupId = topOf(k.backup)
    const topSite = topOf(k.sites)
    rows.push({
      kind: 'keeper',
      id,
      name: names.get(id) ?? 'Member',
      siteId: topSite || null,
      site: siteName.get(topSite) ?? '',
      row: topOf(k.rows),
      units: k.units,
      stocked: k.stocked,
      logged: k.logged,
      due,
      over,
      away,
      covering: cv ? { names: [...cv.names].filter(Boolean).slice(0, 3), units: cv.units, logged: cv.logged } : null,
      backupName: backupId ? names.get(backupId) ?? null : null,
      attention,
      score: (over ? 500 + (k.units - settings.capacity) : 0) + (due > 0 ? 100 + due : 0) + (away ? 50 : 0) + (cv ? 10 : 0),
    })
  }
  rows.sort((a, b) => b.score - a.score || a.site.localeCompare(b.site) || (a.kind === 'keeper' && b.kind === 'keeper' ? a.name.localeCompare(b.name) : a.row.localeCompare(b.row)))
  void date
  return rows
}

const filterArg = v.union(v.literal('attention'), v.literal('over'), v.literal('away'), v.literal('all'))

/** The at-scale board: heatmap, brief, and one page of the keeper list. */
export const board = query({
  args: {
    asOf: v.optional(v.string()),
    siteId: v.optional(v.id('farmLocations')),
    filter: v.optional(filterArg),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const m = await requireKeeperManager(ctx, args.siteId)
    const date = asOfDate(args.asOf)
    const org = await loadOrg(ctx, m, date, args.siteId)
    const ids: Id<'users'>[] = []
    for (const a of org.assignments.values()) {
      ids.push(a.keeperId)
      if (a.backupId) ids.push(a.backupId)
    }
    for (const c of org.covers) ids.push(c.coverId, c.keeperId, ...(c.split ?? []).map((s) => s.coverId))
    const names = await namesOf(ctx, ids)

    // Heatmap: one square per unit, per site.
    type Square = { id: Id<'cages'>; n: string; r: string; s: UnitStatus; k: string | null }
    const sites = new Map<string, { id: string; name: string; counts: Record<UnitStatus, number>; units: Square[] }>()
    const totals: Record<UnitStatus, number> = { logged: 0, due: 0, none: 0, cover: 0, idle: 0 }
    const dueBySite = new Map<string, number>()
    for (const u of org.units) {
      const key = u.locationId ?? ''
      const site =
        sites.get(key) ??
        { id: key, name: org.siteName.get(key) ?? '', counts: { logged: 0, due: 0, none: 0, cover: 0, idle: 0 }, units: [] }
      const s = unitStatus(org, u)
      const a = org.assignments.get(u._id)
      site.units.push({ id: u._id, n: u.name, r: rowOf(u), s, k: a?.keeperId ?? null })
      site.counts[s] += 1
      totals[s] += 1
      if (s === 'due' || s === 'cover') dueBySite.set(site.name, (dueBySite.get(site.name) ?? 0) + 1)
      sites.set(key, site)
    }

    const all = buildKeeperRows(org, names, date)
    const keepers = all.filter((r) => r.kind === 'keeper') as KeeperRow[]
    const gaps = all.filter((r) => r.kind === 'unassigned') as GapRow[]
    const chips = {
      attention: all.filter((r) => r.attention).length,
      over: keepers.filter((k) => k.over).length,
      away: keepers.filter((k) => k.away).length,
      all: keepers.length + gaps.length,
    }

    // Brief (Anowa): what needs the manager, with the numbers behind each fix.
    const biggestGap = [...gaps].sort((a, b) => b.units - a.units)[0] ?? null
    const lightest = (siteName: string) =>
      keepers
        .filter((k) => k.site === siteName && !k.away && k.units < org.settings.capacity)
        .sort((a, b) => a.units - b.units)
        .slice(0, 2)
    const overKeepers = keepers.filter((k) => k.over)
    const week = addDays(date, 7)
    const awaySoon = new Set(org.covers.filter((c) => c.fromDate < week).map((c) => c.keeperId)).size
    const brief = {
      none: {
        units: totals.none,
        site: biggestGap?.site ?? null,
        row: biggestGap?.row ?? null,
        groupUnits: biggestGap?.units ?? 0,
        siteId: biggestGap?.siteId ?? null,
        // The brief's fix gives exactly this group to these people (alternating).
        suggest: biggestGap ? lightest(biggestGap.site).map((k) => ({ id: k.id, name: k.name })) : [],
        unitIds: biggestGap?.unitIds ?? [],
      },
      over: {
        keepers: overKeepers.length,
        units: overKeepers.reduce((n, k) => n + (k.units - org.settings.capacity), 0),
      },
      due: {
        units: totals.due + totals.cover,
        keepers: keepers.filter((k) => k.due > 0).length,
        site: topOf(dueBySite) || null,
      },
      away: { keepers: awaySoon },
    }

    // The list: filter, search, then one page.
    const filter = args.filter ?? 'attention'
    const q = (args.search ?? '').trim().toLowerCase().slice(0, 60)
    let rows: Array<KeeperRow | GapRow> = all
    if (filter === 'attention') rows = rows.filter((r) => r.attention)
    else if (filter === 'over') rows = rows.filter((r) => r.kind === 'keeper' && r.over)
    else if (filter === 'away') rows = rows.filter((r) => r.kind === 'keeper' && !!r.away)
    if (q) {
      const unitHit = new Set<string>()
      for (const u of org.units) {
        if (u.name.toLowerCase().includes(q) || (u.code ?? '').toLowerCase().includes(q)) {
          const a = org.assignments.get(u._id)
          unitHit.add(a ? a.keeperId : `none:${u.locationId ?? ''}|${rowOf(u)}`)
        }
      }
      rows = rows.filter(
        (r) =>
          unitHit.has(r.id) ||
          (r.kind === 'keeper' ? r.name.toLowerCase().includes(q) : `${r.site} ${r.row}`.toLowerCase().includes(q)),
      )
    }
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 25), 1), 200)
    return {
      date,
      capacity: org.settings.capacity,
      deadline: org.settings.deadline,
      truncated: org.truncated,
      totals,
      keepersTotal: keepers.length,
      sites: [...sites.values()],
      names: Object.fromEntries(names),
      brief,
      chips,
      filter,
      rows: rows.slice(0, limit).map(({ score: _s, ...r }) => r),
      total: rows.length,
      hiddenHealthy: filter === 'attention' && !q ? all.length - chips.attention : 0,
    }
  },
})

/** Rows (unit groups) of a site with their unit counts: the drill-in tabs. */
export const siteRows = query({
  args: { siteId: v.id('farmLocations') },
  handler: async (ctx, { siteId }) => {
    const m = await requireKeeperManager(ctx, siteId)
    const units = await ctx.db
      .query('cages')
      .withIndex('by_company_location', (q) => q.eq('companyId', m.companyId).eq('locationId', siteId))
      .take(MAX_UNITS)
    const counts = new Map<string, number>()
    for (const u of units) if (!u.archivedAt) counts.set(rowOf(u), (counts.get(rowOf(u)) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([row, units]) => ({ row, units }))
  },
})

/** Drill-in (Paper 54): one site row, a column per keeper, the units without a keeper and the scorecard. */
export const row = query({
  args: { siteId: v.id('farmLocations'), row: v.string(), asOf: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const m = await requireKeeperManager(ctx, args.siteId)
    const companyId = m.companyId
    const date = asOfDate(args.asOf)
    const yesterday = addDays(date, -1)
    const { settings } = await keeperSettingsOf(ctx, companyId)
    const site = await ctx.db.get(args.siteId)
    const units = (
      await ctx.db
        .query('cages')
        .withIndex('by_company_location', (q) => q.eq('companyId', companyId).eq('locationId', args.siteId))
        .take(MAX_UNITS)
    )
      .filter((u) => !u.archivedAt && rowOf(u) === args.row)
      .sort(byUnitName)
      .slice(0, 300)
    const covers = await openCovers(ctx, companyId, date)
    const active = covers.filter((c) => coverActiveOn(c, date))
    const tables = units.length <= 60 ? await tablesFor(ctx, companyId) : null

    type Card = {
      id: Id<'cages'>
      name: string
      stocked: boolean
      day: number | null
      abwG: number | null
      fish: number | null
      deadYesterday: number
      loggedAt: number | null
      kgPerDay: number | null
      stockingDate: string | null
    }
    const columns = new Map<string, { keeperId: Id<'users'>; backupId: Id<'users'> | null; cards: Card[] }>()
    const unassigned: Card[] = []
    let stocked = 0
    let loggedN = 0
    for (const u of units) {
      const today = await ctx.db
        .query('dailyRecords')
        .withIndex('by_cage_date', (q) => q.eq('cageId', u._id).eq('date', date))
        .first()
      const prev = await ctx.db
        .query('dailyRecords')
        .withIndex('by_cage_date', (q) => q.eq('cageId', u._id).eq('date', yesterday))
        .first()
      const ration = tables && needsDailyLog(u) ? (await cageRation(ctx, u, tables)).ration : null
      const day = u.stockingDate
        ? Math.max(0, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${u.stockingDate}T00:00:00Z`)) / 86_400_000))
        : null
      const card: Card = {
        id: u._id,
        name: u.name,
        stocked: needsDailyLog(u),
        day: Number.isFinite(day as number) ? day : null,
        abwG: u.currentWeight != null ? round(u.currentWeight, 0) : null,
        fish: u.currentCount ?? null,
        deadYesterday: prev?.mortality ?? 0,
        loggedAt: today?._creationTime ?? null,
        kgPerDay: ration && ration.ok ? round(ration.kgPerDay, 1) : null,
        stockingDate: u.stockingDate ?? null,
      }
      if (card.stocked) {
        stocked += 1
        if (card.loggedAt) loggedN += 1
      }
      const a = await ctx.db
        .query('cageKeepers')
        .withIndex('by_unitId_and_active', (q) => q.eq('unitId', u._id).eq('active', true))
        .first()
      if (!a) {
        unassigned.push(card)
        continue
      }
      const col = columns.get(a.keeperId) ?? { keeperId: a.keeperId, backupId: a.backupId ?? null, cards: [] }
      col.cards.push(card)
      columns.set(a.keeperId, col)
    }

    const ids: Id<'users'>[] = []
    for (const c of columns.values()) {
      ids.push(c.keeperId)
      if (c.backupId) ids.push(c.backupId)
    }
    for (const c of covers) ids.push(c.coverId, c.keeperId)
    const names = await namesOf(ctx, ids)
    const keeperIds = [...columns.keys()] as Id<'users'>[]
    const scores = []
    for (const id of keeperIds) {
      const s = await ctx.db
        .query('keeperScores')
        .withIndex('by_companyId_and_keeperId', (q) => q.eq('companyId', companyId).eq('keeperId', id))
        .first()
      if (s) scores.push({ keeperId: id, name: names.get(id) ?? '', ...pickScore(s) })
    }
    const farm = await ctx.db
      .query('keeperScores')
      .withIndex('by_companyId_and_keeperId', (q) => q.eq('companyId', companyId).eq('keeperId', undefined))
      .first()

    const weekEnd = addDays(date, 7)
    const coversThisWeek = covers
      .filter((c) => c.fromDate < weekEnd && keeperIds.includes(c.keeperId))
      .map((c) => ({ keeperId: c.keeperId, keeper: names.get(c.keeperId) ?? '', cover: names.get(c.coverId) ?? '', fromDate: c.fromDate, toDate: c.toDate }))

    return {
      date,
      deadline: settings.deadline,
      capacity: settings.capacity,
      site: { id: args.siteId, name: site?.name ?? '' },
      row: args.row,
      stocked,
      logged: loggedN,
      unassigned,
      coversThisWeek,
      columns: [...columns.values()]
        .map((c) => {
          const away = active.find((x) => x.keeperId === c.keeperId)
          return {
            keeperId: c.keeperId,
            name: names.get(c.keeperId) ?? '',
            backupName: c.backupId ? names.get(c.backupId) ?? null : null,
            away: away ? { fromDate: away.fromDate, toDate: away.toDate, coverName: names.get(away.coverId) ?? '' } : null,
            fish: c.cards.reduce((n, x) => n + (x.fish ?? 0), 0),
            kgPerDay: c.cards.some((x) => x.kgPerDay != null) ? round(c.cards.reduce((n, x) => n + (x.kgPerDay ?? 0), 0), 0) : null,
            stocked: c.cards.filter((x) => x.stocked).length,
            logged: c.cards.filter((x) => x.stocked && x.loggedAt).length,
            cards: c.cards,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      scores,
      farm: farm ? pickScore(farm) : null,
    }
  },
})

function pickScore(s: Doc<'keeperScores'>) {
  return {
    asOf: s.asOf,
    units: s.units,
    onTimePct: s.onTimePct,
    survivalPct: s.survivalPct,
    fcr: s.fcr,
    sampled: s.sampled,
    stocked: s.stocked,
    worstFcrUnit: s.worstFcrUnit ?? null,
  }
}

/**
 * People a manager can give units to: active members who may record daily
 * entries at the site, matched by name (≥ 2 letters), with their load. One
 * capped scan of the organization's memberships (≤ 1,500) per search.
 */
export const people = query({
  args: { search: v.string(), siteId: v.optional(v.id('farmLocations')) },
  handler: async (ctx, args) => {
    const m = await requireKeeperManager(ctx, args.siteId)
    const q = args.search.trim().toLowerCase().slice(0, 60)
    if (q.length < 2) return []
    const rows = await ctx.db
      .query('memberships')
      .withIndex('by_companyId', (x) => x.eq('companyId', m.companyId))
      .take(1500)
    const out = []
    for (const r of rows) {
      if (out.length >= 20) break
      if (r.status !== 'active') continue
      if (args.siteId && !r.allLocations && !(r.locationIds ?? []).includes(args.siteId)) continue
      const u = await ctx.db.get(r.userId)
      if (!u || u.active === false || u.deletedAt) continue
      if (!personName(u).toLowerCase().includes(q)) continue
      if (!(await mayKeep(ctx, r))) continue
      const load = await ctx.db
        .query('cageKeepers')
        .withIndex('by_keeperId_and_active', (x) => x.eq('keeperId', u._id).eq('active', true))
        .take(500)
      out.push({ id: u._id, name: personName(u), units: load.filter((a) => a.companyId === m.companyId).length })
    }
    return out
  },
})

/** A membership whose role may record daily entries (the keeper's job). */
export async function mayKeep(ctx: QueryCtx, r: Doc<'memberships'>) {
  if (r.roleId) {
    const role = await ctx.db.get(r.roleId)
    return !!role && role.companyId === r.companyId && !role.archived && role.permissions.includes('production.daily.record')
  }
  return ['owner', 'admin', 'manager', 'field_staff'].includes(r.roleKey)
}

/**
 * Plan cover (Paper 56): the away keeper's units with what the cover should
 * know, and who could cover: keepers at the same sites, same row first, with
 * their load now and while covering. Bounded by the keeper's units (≤ 500)
 * and the organization's open assignments.
 */
export const coverPreview = query({
  args: { keeperId: v.id('users'), asOf: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const m = await requireKeeperManager(ctx)
    const companyId = m.companyId
    const date = asOfDate(args.asOf)
    const { settings } = await keeperSettingsOf(ctx, companyId)
    // A person outside the organization: nothing about them, not even a name.
    const found = await memberOf(ctx, companyId, args.keeperId)
    if (!found) throw userError('NOT_FOUND', 'Keeper not found')
    const keeper = found.user
    const theirs = (
      await ctx.db
        .query('cageKeepers')
        .withIndex('by_keeperId_and_active', (q) => q.eq('keeperId', args.keeperId).eq('active', true))
        .take(500)
    ).filter((a) => a.companyId === companyId)
    const units = []
    for (const a of theirs) {
      const u = await ctx.db.get(a.unitId)
      if (!u || u.archivedAt || !inSites(m, u.locationId)) continue
      const prev = await ctx.db
        .query('dailyRecords')
        .withIndex('by_cage_date', (q) => q.eq('cageId', u._id).eq('date', addDays(date, -1)))
        .first()
      const lastSample = await ctx.db
        .query('biweeklyRecords')
        .withIndex('by_cage_and_date', (q) => q.eq('cageId', u._id))
        .order('desc')
        .first()
      const since = lastSample?.date ?? u.stockingDate ?? null
      units.push({
        id: u._id,
        name: u.name,
        row: rowOf(u),
        siteId: u.locationId ?? null,
        deadYesterday: prev?.mortality ?? 0,
        sampleDue: !!since && needsDailyLog(u) && addDays(since, 14) <= date,
      })
    }
    units.sort(byUnitName)
    const sites = new Set(units.map((u) => u.siteId))
    const rows = new Set(units.map((u) => `${u.siteId}|${u.row}`))
    const all = await openAssignments(ctx, companyId)
    const load = new Map<string, { units: number; sameSite: boolean; sameRow: boolean }>()
    for (const a of all.values()) {
      const l = load.get(a.keeperId) ?? { units: 0, sameSite: false, sameRow: false }
      l.units += 1
      // The site is on the assignment; only same-site units are read for their row.
      if (sites.has(a.locationId ?? null)) {
        l.sameSite = true
        const u = l.sameRow ? null : await ctx.db.get(a.unitId)
        if (u && rows.has(`${u.locationId ?? null}|${rowOf(u)}`)) l.sameRow = true
      }
      load.set(a.keeperId, l)
    }
    load.delete(args.keeperId)
    const covers = await openCovers(ctx, companyId, date)
    const away = new Set(covers.filter((c) => c.fromDate <= date).map((c) => c.keeperId as string))
    const candidates = []
    for (const [id, l] of [...load.entries()]
      .filter(([id, l]) => l.sameSite && !away.has(id))
      .sort((a, b) => Number(b[1].sameRow) - Number(a[1].sameRow) || a[1].units - b[1].units)
      .slice(0, 8)) {
      candidates.push({ id: id as Id<'users'>, name: personName(await ctx.db.get(id as Id<'users'>)), units: l.units, sameRow: l.sameRow })
    }
    const unitIds = new Set(units.map((u) => u.id as string))
    const openTasks = (
      await ctx.db
        .query('tasks')
        .withIndex('by_company_and_status', (q) => q.eq('companyId', companyId).eq('status', 'open'))
        .take(1000)
    ).filter((x) => x.cageId && unitIds.has(x.cageId)).length
    return {
      date,
      capacity: settings.capacity,
      keeper: { id: args.keeperId, name: personName(keeper) },
      units,
      candidates,
      openTasks,
      existing: covers
        .filter((c) => c.keeperId === args.keeperId)
        .map((c) => ({ fromDate: c.fromDate, toDate: c.toDate })),
    }
  },
})

/** Keepers who keep units at a site, lightest first, with their whole load (assign picker). */
export const siteKeepers = query({
  args: { siteId: v.id('farmLocations') },
  handler: async (ctx, { siteId }) => {
    const m = await requireKeeperManager(ctx, siteId)
    const { settings } = await keeperSettingsOf(ctx, m.companyId)
    const all = await openAssignments(ctx, m.companyId)
    const load = new Map<string, { units: number; here: number }>()
    for (const a of all.values()) {
      const l = load.get(a.keeperId) ?? { units: 0, here: 0 }
      l.units += 1
      if (a.locationId === siteId) l.here += 1
      load.set(a.keeperId, l)
    }
    const out = []
    for (const [id, l] of load) {
      if (!l.here) continue
      out.push({ id: id as Id<'users'>, name: personName(await ctx.db.get(id as Id<'users'>)), units: l.units, here: l.here })
    }
    return { capacity: settings.capacity, keepers: out.sort((a, b) => a.units - b.units || a.name.localeCompare(b.name)).slice(0, 100) }
  },
})
