/**
 * Sidebar counts and the top-bar search palette (Paper 71 grouped sidebar,
 * 72a/72b search).
 *
 * - navCounts: the red "open alerts" and grey "approvals waiting" badges.
 * - quickHints: the live hints of the palette's quick actions.
 * - palette: cages, batches, harvest lots and people matching what was typed.
 * - recordRecent / recents: the member's recently opened cages, batches and
 *   pages.
 *
 * Every read is bounded and goes through a company index; results are
 * filtered to the caller's permissions and site scope (PERM-004), so nothing
 * the member could not open is ever returned. Queries never read the clock:
 * the client passes its local "today" where a date matters.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser } from './lib/authz'
import { TEMPLATE_LABELS, can, isTemplateKey, memberContext, type MemberContext } from './lib/permissions'
import { userError } from './lib/errors'
import { inSiteScope } from './lib/scope'
import { addDays } from './lib/dates'
import { daysBetween } from './lib/kpi'
import { DEFAULT_SPECIES } from './lib/species'
import { SEVERITY_RANK, alertText, langOf, type Lang } from './lib/earlyWarning'
import { needsDailyLog, rowOf } from './keepers/model'

/** Results per kind in the palette. */
const PER_KIND = 5
/** Rows read per company scan (sized for 1,000 units). */
const SCAN = 1000
/** Recents kept per member and company. */
const MAX_RECENTS = 20
/** Recents shown in the palette. */
const SHOWN_RECENTS = 3
/** Same rule as "My cages" (convex/keepers/views.ts): sampling due after 14 days without a sample. */
const SAMPLE_EVERY_DAYS = 14
const WATER_RULES = new Set(['low_oxygen', 'temperature_out_of_range'])

const severityV = v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))
const cageV = v.object({
  kind: v.literal('cage'),
  _id: v.id('cages'),
  name: v.string(),
  species: v.union(v.string(), v.null()),
  dayOfCycle: v.union(v.number(), v.null()),
  location: v.union(v.string(), v.null()),
  alert: v.union(v.null(), v.object({ text: v.string(), severity: severityV, water: v.boolean() })),
  /** Short reading from the open alert, e.g. "DO 3.1 mg/L"; null without an alert. */
  sampleText: v.union(v.string(), v.null()),
})
const batchV = v.object({
  _id: v.id('batches'),
  code: v.string(),
  cageId: v.union(v.id('cages'), v.null()),
  cageName: v.union(v.string(), v.null()),
  fishCount: v.union(v.number(), v.null()),
  abwG: v.union(v.number(), v.null()),
})
const lotV = v.object({
  _id: v.id('harvestLots'),
  code: v.string(),
  cageName: v.union(v.string(), v.null()),
  weightKg: v.union(v.number(), v.null()),
  date: v.union(v.string(), v.null()),
})
const personV = v.object({ userId: v.id('users'), name: v.string(), detail: v.union(v.string(), v.null()) })
const recentKind = v.union(v.literal('cage'), v.literal('batch'), v.literal('page'))

type CageResult = typeof cageV.type
type BatchResult = typeof batchV.type

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The caller as a member of their active organization, or null (signed out, no organization). */
async function optionalMember(ctx: QueryCtx): Promise<(MemberContext & { companyId: Id<'companies'> }) | null> {
  if (!(await ctx.auth.getUserIdentity())) return null
  try {
    const user = await requireUser(ctx)
    const m = await memberContext(ctx, user)
    return m.companyId ? (m as MemberContext & { companyId: Id<'companies'> }) : null
  } catch {
    return null
  }
}

/** Rows with no site stay visible (lib/scope rowInSiteScope). */
function siteInScope(m: MemberContext, locationId: Id<'farmLocations'> | null | undefined) {
  return m.siteScope === 'all' || !locationId || m.siteScope.has(locationId)
}

/** Alerts of units with no site are for all-sites members only (as farmAlerts.list). */
function alertInScope(m: MemberContext, a: { locationId?: Id<'farmLocations'> | null }) {
  return m.siteScope === 'all' || (!!a.locationId && m.siteScope.has(a.locationId))
}

/** Lower-case letters and digits only: "C-07", "c07" and "C 07" all become "c07". */
export function normalizeTerm(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '')
}

/** 0 exact, 1 prefix, 2 contains, -1 no match. */
export function matchRank(haystack: string | null | undefined, needle: string): number {
  const h = normalizeTerm(haystack)
  if (!needle || !h) return -1
  if (h === needle) return 0
  if (h.startsWith(needle)) return 1
  return h.includes(needle) ? 2 : -1
}

const num1 = (x: unknown) => {
  const n = typeof x === 'number' ? x : Number(x)
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '—'
}

/**
 * One short line for an alert: water rules as reading · target (Paper 72b
 * "Dissolved O₂ 3.1 mg/L · below 4.0 target"), other rules as their title
 * without the unit name.
 */
export function alertLine(
  a: Pick<Doc<'farmAlerts'>, 'rule' | 'unitName' | 'evidence'>,
  lang: Lang,
): string {
  const e = a.evidence
  if (a.rule === 'low_oxygen') {
    return lang === 'fr'
      ? `O₂ dissous ${num1(e.do_mg_l)} mg/L · sous l'objectif de ${num1(e.min_mg_l)}`
      : `Dissolved O₂ ${num1(e.do_mg_l)} mg/L · below ${num1(e.min_mg_l)} target`
  }
  if (a.rule === 'temperature_out_of_range') {
    const high = e.direction === 'high'
    if (lang === 'fr') {
      return `Eau ${num1(e.temp_c)} °C · ${high ? 'au-dessus' : 'en dessous'} de l'objectif de ${num1(high ? e.max_c : e.min_c)} °C`
    }
    return `Water ${num1(e.temp_c)} °C · ${high ? 'above' : 'below'} ${num1(high ? e.max_c : e.min_c)} °C target`
  }
  const title = alertText(a, lang).title
  const prefix = new RegExp(`^${a.unitName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s?:\\s*`)
  const rest = title.replace(prefix, '')
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

/** The alert's key value in a few characters (Paper 72a Recent row "DO 3.1 mg/L"). */
export function alertSample(a: Pick<Doc<'farmAlerts'>, 'rule' | 'evidence'>, lang: Lang): string | null {
  const e = a.evidence
  const fr = lang === 'fr'
  switch (a.rule) {
    case 'low_oxygen':
      return `${fr ? 'OD' : 'DO'} ${num1(e.do_mg_l)} mg/L`
    case 'temperature_out_of_range':
      return `${num1(e.temp_c)} °C`
    case 'mortality_spike':
      return `${fr ? 'Mortalité' : 'Mortality'} ${num1(e.rate_pct)} %`
    case 'feed_drop':
      return `${fr ? 'Aliment' : 'Feed'} −${num1(e.drop_pct)} %`
    case 'missing_entries':
      return fr ? `${num1(e.days_missing)} j sans saisie` : `${num1(e.days_missing)} days unlogged`
    case 'fcr_deterioration':
      return `FCR ${num1(e.fcr_to)}`
    case 'growth_stall':
      return `SGR ${num1(e.sgr_pct)} %/${fr ? 'j' : 'day'}`
    default:
      return null
  }
}

/** Per-request caches so a palette reads each site, group and species once. */
function makeCache(ctx: QueryCtx, companyId: Id<'companies'>) {
  const sites = new Map<string, string | null>()
  const groups = new Map<string, string | null>()
  const species = new Map<string, string | null>()
  const cages = new Map<string, Doc<'cages'> | null>()
  return {
    async site(id: Id<'farmLocations'> | undefined) {
      if (!id) return null
      if (!sites.has(id)) {
        const s = await ctx.db.get(id)
        sites.set(id, s && s.companyId === companyId ? s.name : null)
      }
      return sites.get(id) ?? null
    },
    async group(id: Id<'unitGroups'> | undefined) {
      if (!id) return null
      if (!groups.has(id)) {
        const g = await ctx.db.get(id)
        groups.set(id, g && g.companyId === companyId ? g.name : null)
      }
      return groups.get(id) ?? null
    },
    async species(code: string | undefined) {
      if (!code) return null
      if (!species.has(code)) {
        const row = await ctx.db
          .query('species')
          .withIndex('by_companyId_and_key', (q) => q.eq('companyId', companyId).eq('key', code))
          .first()
        const fallback =
          DEFAULT_SPECIES.find((s) => s.key === code)?.name ??
          code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
        species.set(code, row?.name ?? fallback)
      }
      return species.get(code) ?? null
    },
    async cage(id: Id<'cages'> | undefined | null) {
      if (!id) return null
      if (!cages.has(id)) {
        const c = await ctx.db.get(id)
        cages.set(id, c && c.companyId === companyId ? c : null)
      }
      return cages.get(id) ?? null
    },
  }
}
type Cache = ReturnType<typeof makeCache>

async function cageResult(
  ctx: QueryCtx,
  m: MemberContext,
  cache: Cache,
  c: Doc<'cages'>,
  date: string | undefined,
  lang: Lang,
): Promise<CageResult> {
  const groupName = (await cache.group(c.unitGroupId)) ?? (c.unitGroup?.trim() || null)
  const row = groupName ?? (rowOf(c) ? `${lang === 'fr' ? 'Rangée' : 'Row'} ${rowOf(c)}` : null)
  const site = await cache.site(c.locationId)
  const location = [row, site].filter(Boolean).join(', ') || null
  const stocked = needsDailyLog(c) && !!c.stockingDate
  // Open alerts of this unit, worst first (one per rule, so a handful).
  const alerts = (
    await ctx.db
      .query('farmAlerts')
      .withIndex('by_unitId_and_rule', (q) => q.eq('unitId', c._id))
      .take(20)
  ).filter((a) => a.status === 'open' && a.companyId === m.companyId && alertInScope(m, a))
  alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.lastSeenDate.localeCompare(a.lastSeenDate))
  const top = alerts[0]
  return {
    kind: 'cage' as const,
    _id: c._id,
    name: c.name,
    species: stocked ? await cache.species(c.species) : null,
    dayOfCycle: stocked && date && c.stockingDate ? daysBetween(c.stockingDate, date) : null,
    location,
    alert: top ? { text: alertLine(top, lang), severity: top.severity, water: WATER_RULES.has(top.rule) } : null,
    sampleText: top ? alertSample(top, lang) : null,
  }
}

/** A batch the member may open, with its current unit, count and ABW; null when out of scope. */
async function batchResult(
  ctx: QueryCtx,
  m: MemberContext,
  cache: Cache,
  b: Doc<'batches'>,
): Promise<BatchResult | null> {
  if (b.companyId !== m.companyId) return null
  const stats = await ctx.db
    .query('batchStats')
    .withIndex('by_batchId', (q) => q.eq('batchId', b._id))
    .take(10)
  const live = stats.find((s) => s.open) ?? null
  let cage = live ? await cache.cage(live.unitId) : null
  if (!cage && b.status === 'active') {
    // Rollups lag a new batch: fall back to the unit that holds it.
    const holder = await ctx.db
      .query('stockEvents')
      .withIndex('by_batchId_and_eventDate', (q) => q.eq('batchId', b._id))
      .order('desc')
      .first()
    cage = holder ? await cache.cage(holder.unitId) : null
  }
  const site = live?.locationId ?? cage?.locationId ?? b.homeLocationId
  if (!siteInScope(m, site)) return null
  const current = cage && cage.currentBatchId === b._id
  return {
    _id: b._id,
    code: b.batchNumber,
    cageId: cage?._id ?? null,
    cageName: cage?.name ?? null,
    fishCount: live ? live.kpis.count : current ? (cage?.currentCount ?? null) : null,
    abwG: live?.kpis.current_abw_g ?? null,
  }
}

// ---------------------------------------------------------------------------
// Sidebar counts
// ---------------------------------------------------------------------------

/** Open alerts in the caller's sites (red badge) and approvals waiting for them (grey badge). */
export const navCounts = query({
  args: {},
  returns: v.object({ openAlerts: v.union(v.number(), v.null()), approvals: v.union(v.number(), v.null()) }),
  handler: async (ctx) => {
    const m = await optionalMember(ctx)
    if (!m) return { openAlerts: null, approvals: null }
    const companyId = m.companyId

    let openAlerts: number | null = null
    if (can(m, 'production.view')) {
      const open = await ctx.db
        .query('farmAlerts')
        .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', 'open'))
        .take(500)
      openAlerts = open.filter((a) => alertInScope(m, a)).length
    }

    let approvals: number | null = null
    if (can(m, 'production.stocking.approve')) {
      // The queue stocking.listPendingApprovals shows: a stocking or top-up
      // created by a pending transfer is counted once, as the transfer.
      const pending = <T extends 'stockingHistory' | 'topupHistory' | 'fishTransfers'>(table: T) =>
        (ctx.db.query(table) as any)
          .withIndex('by_company_and_status', (q: any) => q.eq('companyId', companyId).eq('status', 'pending_approval'))
          .take(500) as Promise<Doc<T>[]>
      const stockings = inSiteScope(m.user, await pending('stockingHistory')).filter((s) => !s.deletedAt)
      const topups = inSiteScope(m.user, await pending('topupHistory'))
      const transfers = inSiteScope(m.user, await pending('fishTransfers'))
      const linkedStockings = new Set(transfers.map((t) => t.destinationStockingId).filter(Boolean).map(String))
      const linkedTopups = new Set(transfers.map((t) => t.destinationTopupId).filter(Boolean).map(String))
      approvals =
        stockings.filter((s) => !linkedStockings.has(String(s._id))).length +
        topups.filter((t) => !linkedTopups.has(String(t._id))).length +
        transfers.length
    }
    return { openAlerts, approvals }
  },
})

// ---------------------------------------------------------------------------
// Quick-action hints
// ---------------------------------------------------------------------------

/** Stocked units in the caller's sites (active or harvesting, not archived). */
async function stockedUnits(ctx: QueryCtx, m: MemberContext & { companyId: Id<'companies'> }) {
  const out: Doc<'cages'>[] = []
  for (const status of ['active', 'harvesting'] as const) {
    const rows = await ctx.db
      .query('cages')
      .withIndex('by_company_status', (q) => q.eq('companyId', m.companyId).eq('status', status))
      .take(SCAN)
    out.push(...rows.filter((c) => !c.archivedAt && siteInScope(m, c.locationId)))
  }
  return out
}

/**
 * "N cages not logged today" and "N cages due" (sampling). Null when the
 * caller may not record that kind of entry, so the hint is hidden.
 */
export const quickHints = query({
  args: { date: v.string() },
  returns: v.object({
    notLoggedToday: v.union(v.number(), v.null()),
    samplingDue: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { date }) => {
    const m = await optionalMember(ctx)
    if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { notLoggedToday: null, samplingDue: null }
    const wantLog = can(m, 'production.daily.record')
    const wantSample = can(m, 'production.sampling.record')
    if (!wantLog && !wantSample) return { notLoggedToday: null, samplingDue: null }
    const units = await stockedUnits(ctx, m)

    let notLoggedToday: number | null = null
    if (wantLog) {
      const logged = new Set(
        (
          await ctx.db
            .query('dailyRecords')
            .withIndex('by_company_and_date', (q) => q.eq('companyId', m.companyId).eq('date', date))
            .take(SCAN * 2)
        ).map((r) => String(r.cageId)),
      )
      notLoggedToday = units.filter((u) => !logged.has(String(u._id))).length
    }

    let samplingDue: number | null = null
    if (wantSample) {
      let due = 0
      for (const u of units) {
        const last = await ctx.db
          .query('biweeklyRecords')
          .withIndex('by_cage_and_date', (q) => q.eq('cageId', u._id).lte('date', date))
          .order('desc')
          .first()
        const since = last?.date ?? u.stockingDate ?? null
        if (since && addDays(since, SAMPLE_EVERY_DAYS) <= date) due++
      }
      samplingDue = due
    }
    return { notLoggedToday, samplingDue }
  },
})

// ---------------------------------------------------------------------------
// Palette search
// ---------------------------------------------------------------------------

const EMPTY = { cages: [], batches: [], lots: [], people: [] }

/**
 * Cages (name or code), batches (code, or the batch in a matching cage),
 * harvest lots (code, or harvested from a matching cage) and — for member
 * managers — people. At most five of each.
 */
export const palette = query({
  args: { q: v.string(), date: v.optional(v.string()) },
  returns: v.object({
    cages: v.array(cageV),
    batches: v.array(batchV),
    lots: v.array(lotV),
    people: v.array(personV),
  }),
  handler: async (ctx, { q, date }) => {
    const needle = normalizeTerm(q.slice(0, 80))
    if (!needle) return EMPTY
    const m = await optionalMember(ctx)
    if (!m) return EMPTY
    const companyId = m.companyId
    const lang = langOf(m.user.locale)
    const cache = makeCache(ctx, companyId)
    const out = {
      cages: [] as CageResult[],
      batches: [] as BatchResult[],
      lots: [] as (typeof lotV.type)[],
      people: [] as (typeof personV.type)[],
    }

    if (can(m, 'production.view')) {
      // Cages: one bounded company scan, best match first.
      const units = (
        await ctx.db
          .query('cages')
          .withIndex('by_company', (ix) => ix.eq('companyId', companyId))
          .take(SCAN)
      ).filter((c) => !c.archivedAt && siteInScope(m, c.locationId))
      const ranked = units
        .map((c) => {
          const ranks = [matchRank(c.name, needle), matchRank(c.code, needle)].filter((r) => r >= 0)
          return { c, rank: ranks.length ? Math.min(...ranks) : -1 }
        })
        .filter((x) => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name, undefined, { numeric: true }))
      const matchedCages = ranked.map((x) => x.c)
      const matchedIds = new Set(matchedCages.map((c) => String(c._id)))
      for (const c of matchedCages.slice(0, PER_KIND)) out.cages.push(await cageResult(ctx, m, cache, c, date, lang))

      // Batches: the batch in each matching cage, then batch codes.
      const seen = new Set<string>()
      const addBatch = async (b: Doc<'batches'> | null) => {
        if (!b || out.batches.length >= PER_KIND || seen.has(String(b._id))) return
        seen.add(String(b._id))
        const r = await batchResult(ctx, m, cache, b)
        if (r) out.batches.push(r)
      }
      for (const c of matchedCages.slice(0, PER_KIND)) {
        if (c.currentBatchId) await addBatch(await ctx.db.get(c.currentBatchId))
      }
      if (out.batches.length < PER_KIND) {
        const active = await ctx.db
          .query('batches')
          .withIndex('by_companyId_and_status', (ix) => ix.eq('companyId', companyId).eq('status', 'active'))
          .take(SCAN)
        const hits = active
          .map((b) => ({ b, rank: matchRank(b.batchNumber, needle) }))
          .filter((x) => x.rank >= 0)
          .sort((a, b) => a.rank - b.rank || b.b.openedOn.localeCompare(a.b.openedOn))
        for (const { b } of hits) await addBatch(b)
      }
      if (out.batches.length < PER_KIND) {
        // Closed batches: code prefix as typed (upper case, batch numbers' usual form).
        const prefix = q.trim().toUpperCase()
        if (prefix) {
          const closed = await ctx.db
            .query('batches')
            .withIndex('by_companyId_and_batchNumber', (ix) =>
              ix.eq('companyId', companyId).gte('batchNumber', prefix).lt('batchNumber', `${prefix}￿`),
            )
            .take(PER_KIND * 2)
          for (const b of closed) await addBatch(b)
        }
      }

      // Harvest lots: recent lots whose code or cage matches.
      const lots = await ctx.db
        .query('harvestLots')
        .withIndex('by_companyId_and_harvestDate', (ix) => ix.eq('companyId', companyId))
        .order('desc')
        .take(SCAN)
      for (const l of lots) {
        if (out.lots.length >= PER_KIND) break
        if (!siteInScope(m, l.locationId)) continue
        if (matchRank(l.lotCode, needle) < 0 && !matchedIds.has(String(l.cageId))) continue
        const cage = await cache.cage(l.cageId)
        out.lots.push({
          _id: l._id,
          code: l.lotCode,
          cageName: cage?.name ?? null,
          weightKg: l.weightKg ?? null,
          date: l.harvestDate ?? null,
        })
      }
    }

    // People: member managers only (results open /users?member=…).
    if (can(m, 'org.members.manage')) {
      const members = await ctx.db
        .query('memberships')
        .withIndex('by_companyId', (ix) => ix.eq('companyId', companyId))
        .take(SCAN)
      for (const ms of members) {
        if (out.people.length >= PER_KIND) break
        if (ms.status !== 'active') continue
        const u = await ctx.db.get(ms.userId)
        if (!u || u.active === false || u.deletedAt) continue
        if (matchRank(u.name, needle) < 0 && matchRank(u.email, needle) < 0) continue
        let role: string | null = null
        if (ms.roleId) {
          const r = await ctx.db.get(ms.roleId)
          role = r && r.companyId === companyId ? r.name : null
        } else if (isTemplateKey(ms.roleKey)) {
          role = TEMPLATE_LABELS[ms.roleKey]
        }
        out.people.push({
          userId: u._id,
          name: u.name?.trim() || u.email?.split('@')[0] || 'Member',
          detail: role ?? u.email ?? null,
        })
      }
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------

/** Remember that the caller opened a cage, batch or page (newest first, ≤ 20 kept). */
export const recordRecent = mutation({
  args: { kind: recentKind, key: v.string() },
  returns: v.null(),
  handler: async (ctx, { kind, key }) => {
    const user = await requireUser(ctx)
    const m = await memberContext(ctx, user)
    const companyId = m.companyId
    if (!companyId) throw userError('FORBIDDEN', 'Your account is not linked to an organization')
    if (kind === 'page') {
      if (!key.startsWith('/') || key.length > 200) return null
    } else if (kind === 'cage') {
      const id = ctx.db.normalizeId('cages', key)
      const doc = id ? await ctx.db.get(id) : null
      if (!doc || doc.companyId !== companyId) return null
    } else {
      const id = ctx.db.normalizeId('batches', key)
      const doc = id ? await ctx.db.get(id) : null
      if (!doc || doc.companyId !== companyId) return null
    }
    const now = Date.now()
    const existing = await ctx.db
      .query('navRecents')
      .withIndex('by_userId_and_companyId_and_key', (q) =>
        q.eq('userId', user._id).eq('companyId', companyId).eq('key', key),
      )
      .first()
    if (existing) await ctx.db.patch(existing._id, { openedAt: now, kind })
    else await ctx.db.insert('navRecents', { userId: user._id, companyId, kind, key, openedAt: now })
    const rows = await ctx.db
      .query('navRecents')
      .withIndex('by_userId_and_companyId_and_openedAt', (q) => q.eq('userId', user._id).eq('companyId', companyId))
      .order('desc')
      .take(MAX_RECENTS + 10)
    for (const r of rows.slice(MAX_RECENTS)) await ctx.db.delete(r._id)
    return null
  },
})

/** The caller's last opened cages, batches and pages they may still open, newest first. */
export const recents = query({
  args: { date: v.optional(v.string()) },
  returns: v.array(
    v.union(
      v.object({ kind: v.literal('cage'), key: v.string(), cage: cageV }),
      v.object({ kind: v.literal('batch'), key: v.string(), batch: batchV }),
      v.object({ kind: v.literal('page'), key: v.string() }),
    ),
  ),
  handler: async (ctx, { date }) => {
    const m = await optionalMember(ctx)
    if (!m) return []
    const companyId = m.companyId
    const lang = langOf(m.user.locale)
    const cache = makeCache(ctx, companyId)
    const rows = await ctx.db
      .query('navRecents')
      .withIndex('by_userId_and_companyId_and_openedAt', (q) => q.eq('userId', m.user._id).eq('companyId', companyId))
      .order('desc')
      .take(10)
    const out = []
    for (const r of rows) {
      if (out.length >= SHOWN_RECENTS) break
      if (r.kind === 'page') {
        out.push({ kind: 'page' as const, key: r.key })
        continue
      }
      if (!can(m, 'production.view')) continue
      if (r.kind === 'cage') {
        const id = ctx.db.normalizeId('cages', r.key)
        const c = id ? await cache.cage(id) : null
        if (!c || c.archivedAt || !siteInScope(m, c.locationId)) continue
        out.push({ kind: 'cage' as const, key: r.key, cage: await cageResult(ctx, m, cache, c, date, lang) })
      } else {
        const id = ctx.db.normalizeId('batches', r.key)
        const b = id ? await ctx.db.get(id) : null
        const batch = b ? await batchResult(ctx, m, cache, b) : null
        if (batch) out.push({ kind: 'batch' as const, key: r.key, batch })
      }
    }
    return out
  },
})
