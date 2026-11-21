import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { farmAlertRule } from './schema'
import { addDays, todayIn, zoneFor } from './lib/dates'
import { assertSiteInScope, can, memberContextIn, requireMember, type MemberContext } from './lib/permissions'
import { userError } from './lib/errors'
import { notifyUsers } from './lib/notify'
import { postGroupAlert } from './bot/chatGroups'
import { membersWithPermission } from './approvalAlerts'
import { overridesFor } from './waterQuality'
import { effectiveThresholds } from './lib/waterQuality'
import { unitTypeOf } from './lib/farmRules'
import {
  RULES,
  SEVERITY_RANK,
  alertText,
  decide,
  evaluateUnit,
  langOf,
  type Candidate,
  type DayInput,
  type Lang,
  type UnitInput,
} from './lib/earlyWarning'

/**
 * Early-warning alerts (AI-001, docs/architecture/22-insights-engine.md).
 *
 * A daily cron evaluates every stocked unit of every approved company on the
 * previous business day with the pure rules in lib/earlyWarning, a few units
 * per mutation. One live alert per unit and rule: a re-run on the same day
 * refreshes it, a resolved one stays quiet for the rule's cool-down unless
 * it gets worse. New and escalated alerts notify the site's production.view
 * members on their preferred channels (lib/notify).
 *
 * Site scope (PERM-004): an alert carries its unit's site; members limited
 * to some sites see only those, and alerts of a unit with no site are for
 * all-sites members only (as feedingPlans).
 */

const UNITS_PER_RUN = 8
const COMPANIES_PER_PAGE = 20
/** Days of rollups read per unit: rule windows plus the sample look-back. */
const HISTORY_DAYS = 60
/** Open alerts not seen for this many days are closed automatically. */
const STALE_DAYS = 2
/** Notifications per run (each run is a handful of units). */
const NOTIFY_CAP = 25

const alertValidator = v.object({
  _id: v.id('farmAlerts'),
  unitId: v.id('cages'),
  unitName: v.string(),
  locationId: v.union(v.id('farmLocations'), v.null()),
  rule: farmAlertRule,
  severity: v.union(v.literal('info'), v.literal('warning'), v.literal('critical')),
  status: v.union(v.literal('open'), v.literal('acknowledged'), v.literal('resolved')),
  date: v.string(),
  lastSeenDate: v.string(),
  evidence: v.record(v.string(), v.union(v.string(), v.number(), v.null())),
  acknowledgedAt: v.union(v.number(), v.null()),
  resolvedAt: v.union(v.number(), v.null()),
  autoResolved: v.boolean(),
})

function toClient(a: Doc<'farmAlerts'>) {
  return {
    _id: a._id,
    unitId: a.unitId,
    unitName: a.unitName,
    locationId: a.locationId ?? null,
    rule: a.rule,
    severity: a.severity,
    status: a.status,
    date: a.date,
    lastSeenDate: a.lastSeenDate,
    evidence: a.evidence,
    acknowledgedAt: a.acknowledgedAt ?? null,
    resolvedAt: a.resolvedAt ?? null,
    autoResolved: a.autoResolved ?? false,
  }
}

/** Alerts of units with no site are for all-sites members only. */
function alertInScope(m: MemberContext, a: { locationId?: Id<'farmLocations'> | null }) {
  return m.siteScope === 'all' || (!!a.locationId && m.siteScope.has(a.locationId))
}

const bySeverityThenDate = (a: Doc<'farmAlerts'>, b: Doc<'farmAlerts'>) =>
  SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.lastSeenDate.localeCompare(a.lastSeenDate)

async function liveAlerts(ctx: QueryCtx, companyId: Id<'companies'>) {
  const open = await ctx.db
    .query('farmAlerts')
    .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', 'open'))
    .take(500)
  const acked = await ctx.db
    .query('farmAlerts')
    .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', 'acknowledged'))
    .take(500)
  return [...open, ...acked]
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Open and acknowledged alerts (and, with `includeResolved`, the last resolved ones) in the caller's sites. */
export const list = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    unitId: v.optional(v.id('cages')),
    includeResolved: v.optional(v.boolean()),
  },
  returns: v.array(alertValidator),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'production.view', locationId: args.locationId })
    if (!m.companyId) return []
    const companyId = m.companyId
    let rows = await liveAlerts(ctx, companyId)
    if (args.includeResolved) {
      const resolved = await ctx.db
        .query('farmAlerts')
        .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', 'resolved'))
        .order('desc')
        .take(50)
      rows = [...rows, ...resolved]
    }
    return rows
      .filter(
        (a) =>
          alertInScope(m, a) &&
          (!args.locationId || a.locationId === args.locationId) &&
          (!args.unitId || a.unitId === args.unitId),
      )
      .sort(bySeverityThenDate)
      .slice(0, 100)
      .map(toClient)
  },
})

/**
 * Internal, for the chat bot (and other server callers): the live alerts a
 * member may see, rendered in their language. Null when the user is not an
 * active member of the company or lacks production.view.
 */
export const openForMember = internalQuery({
  args: { companyId: v.id('companies'), userId: v.id('users'), limit: v.optional(v.number()) },
  returns: v.union(
    v.null(),
    v.array(
      v.object({
        alertId: v.id('farmAlerts'),
        unitId: v.id('cages'),
        severity: v.union(v.literal('info'), v.literal('warning'), v.literal('critical')),
        status: v.union(v.literal('open'), v.literal('acknowledged'), v.literal('resolved')),
        date: v.string(),
        title: v.string(),
        detail: v.string(),
        actions: v.array(v.string()),
      }),
    ),
  ),
  handler: async (ctx, { companyId, userId, limit }) => {
    const user = await ctx.db.get(userId)
    if (!user) return null
    const m = await memberContextIn(ctx, user, companyId)
    if (!m || !can(m, 'production.view')) return null
    const lang = langOf(user.locale)
    return (await liveAlerts(ctx, companyId))
      .filter((a) => alertInScope(m, a))
      .sort(bySeverityThenDate)
      .slice(0, Math.max(1, Math.min(limit ?? 10, 50)))
      .map((a) => ({
        alertId: a._id,
        unitId: a.unitId,
        severity: a.severity,
        status: a.status,
        date: a.lastSeenDate,
        ...alertText(a, lang),
      }))
  },
})

// ---------------------------------------------------------------------------
// Acknowledge / resolve
// ---------------------------------------------------------------------------

async function loadForAction(ctx: MutationCtx, m: MemberContext, alertId: Id<'farmAlerts'>) {
  const a = await ctx.db.get(alertId)
  if (!a || a.companyId !== m.companyId) throw userError('NOT_FOUND', 'Alert not found')
  if (!alertInScope(m, a)) {
    assertSiteInScope(m, a.locationId ?? null)
    throw userError('FORBIDDEN', 'You do not have access to this site', { reason: 'SITE_FORBIDDEN' })
  }
  return { m, a }
}

/** "Seen, working on it": stays on the list, no more reminders for this level. */
export const acknowledge = mutation({
  args: { alertId: v.id('farmAlerts') },
  returns: v.null(),
  handler: async (ctx, { alertId }) => {
    const { m, a } = await loadForAction(ctx, await requireMember(ctx, { permission: 'production.daily.record' }), alertId)
    if (a.status !== 'open') return null
    const now = Date.now()
    await ctx.db.patch(a._id, { status: 'acknowledged', acknowledgedBy: m.user._id, acknowledgedAt: now, updatedAt: now })
    return null
  },
})

/** Close the alert; the same rule stays quiet on the unit for its cool-down unless it gets worse. */
export const resolve = mutation({
  args: { alertId: v.id('farmAlerts') },
  returns: v.null(),
  handler: async (ctx, { alertId }) => {
    const { m, a } = await loadForAction(ctx, await requireMember(ctx, { permission: 'production.daily.record' }), alertId)
    if (a.status === 'resolved') return null
    const now = Date.now()
    await ctx.db.patch(a._id, { status: 'resolved', resolvedBy: m.user._id, resolvedAt: now, autoResolved: false, updatedAt: now })
    return null
  },
})

// ---------------------------------------------------------------------------
// Evaluation (cron)
// ---------------------------------------------------------------------------

/** 05:00 UTC: one evaluation per approved company (paged). */
export const tick = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ scheduled: v.number(), done: v.boolean() }),
  handler: async (ctx, { cursor }): Promise<{ scheduled: number; done: boolean }> => {
    const page = await ctx.db
      .query('companies')
      .withIndex('by_status', (q) => q.eq('status', 'approved'))
      .paginate({ numItems: COMPANIES_PER_PAGE, cursor: cursor ?? null })
    for (const c of page.page) {
      await ctx.scheduler.runAfter(0, internal.farmAlerts.evaluateCompany, { companyId: c._id })
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.farmAlerts.tick, { cursor: page.continueCursor })
    return { scheduled: page.page.length, done: page.isDone }
  },
})

type SensorDay = { min: number; max: number }

/** Daily min/max of a unit's sensor readings over [from, to] business dates. */
async function sensorDays(
  ctx: MutationCtx,
  unitId: Id<'cages'>,
  parameter: 'dissolved_oxygen' | 'temperature_c',
  from: string,
  to: string,
  tz: string,
): Promise<Map<string, SensorDay>> {
  // A day either side of the window covers any time-zone offset.
  const fromMs = Date.parse(`${addDays(from, -1)}T00:00:00Z`)
  const toMs = Date.parse(`${addDays(to, 1)}T23:59:59Z`)
  const rows = await ctx.db
    .query('sensorReadings')
    .withIndex('by_cageId_and_parameter_and_measuredAt', (q) =>
      q.eq('cageId', unitId).eq('parameter', parameter).gte('measuredAt', fromMs).lte('measuredAt', toMs),
    )
    .order('desc')
    .take(1000)
  const out = new Map<string, SensorDay>()
  for (const r of rows) {
    const day = todayIn(tz, r.measuredAt)
    if (day < from || day > to) continue
    const d = out.get(day)
    out.set(day, d ? { min: Math.min(d.min, r.value), max: Math.max(d.max, r.value) } : { min: r.value, max: r.value })
  }
  return out
}

const minOf = (...xs: Array<number | null | undefined>) => {
  const known = xs.filter((x): x is number => x != null && Number.isFinite(x))
  return known.length ? Math.min(...known) : null
}
const maxOf = (...xs: Array<number | null | undefined>) => {
  const known = xs.filter((x): x is number => x != null && Number.isFinite(x))
  return known.length ? Math.max(...known) : null
}

/** The rules' input for one open occupancy, from the rollups and sensors. */
async function unitInput(
  ctx: MutationCtx,
  cage: Doc<'cages'>,
  stats: Doc<'batchStats'>,
  asOf: string,
  tz: string,
  thresholds: UnitInput['thresholds'],
): Promise<UnitInput> {
  const from = addDays(asOf, -HISTORY_DAYS)
  const rows = await ctx.db
    .query('unitDailyStats')
    .withIndex('by_unitId_and_batchId_and_date', (q) => q.eq('unitId', cage._id).eq('batchId', stats.batchId).gte('date', from))
    .take(HISTORY_DAYS + 40)
  // Fish at the start of day d: the as-of count minus every net change from d on.
  const byDate = new Map(rows.map((r) => [r.date, r]))
  const netFrom = (d: string) => rows.reduce((sum, r) => (r.date >= d ? sum + r.flows.count : sum), 0)
  const windowFrom = addDays(asOf, -RULES.lookbackDays)
  const doSensor = await sensorDays(ctx, cage._id, 'dissolved_oxygen', windowFrom, asOf, tz)
  const tempSensor = await sensorDays(ctx, cage._id, 'temperature_c', windowFrom, asOf, tz)
  const days: DayInput[] = []
  for (let d = windowFrom; d <= asOf; d = addDays(d, 1)) {
    const r = byDate.get(d)
    const startCount = stats.kpis.opened_on && d >= stats.kpis.opened_on ? stats.kpis.count - netFrom(d) : null
    const ds = doSensor.get(d)
    const ts = tempSensor.get(d)
    days.push({
      date: d,
      hasEntry: !!r && r.feed.length > 0,
      feedKg: r?.feedKg ?? 0,
      deaths: Math.max(r?.flows.mortalityCount ?? 0, r?.mortalityRecorded ?? 0),
      startCount: startCount != null && startCount > 0 ? startCount : null,
      doMin: minOf(ds?.min, r?.dissolvedOxygen),
      tempMin: minOf(ts?.min, r?.temperatureC),
      tempMax: maxOf(ts?.max, r?.temperatureC),
    })
  }
  return {
    unitId: cage._id,
    unitName: cage.name,
    asOf,
    stockedOn: stats.kpis.opened_on,
    days,
    weeklyFcr: stats.weekly.map((w) => ({ weekEnd: w.date, fcr: w.efcr })),
    samples: rows.filter((r) => r.sampleAbwG != null && r.sampleAbwG > 0).map((r) => ({ date: r.date, abwG: r.sampleAbwG! })),
    thresholds,
  }
}

/** Members to tell about a unit's alert: production.view in the unit's site (all-sites members for a unit with no site). */
async function recipients(ctx: MutationCtx, companyId: Id<'companies'>, locationId: Id<'farmLocations'> | undefined) {
  const users = await membersWithPermission(ctx, companyId, 'production.view', locationId)
  if (locationId) return users
  const out: Doc<'users'>[] = []
  for (const u of users) {
    const m = await memberContextIn(ctx, u, companyId)
    if (m && m.siteScope === 'all') out.push(u)
  }
  return out
}

async function notifyAlert(ctx: MutationCtx, alert: Doc<'farmAlerts'>) {
  const users = await recipients(ctx, alert.companyId, alert.locationId)
  const byLang = new Map<Lang, Doc<'users'>[]>()
  for (const u of users) {
    const l = langOf(u.locale)
    byLang.set(l, [...(byLang.get(l) ?? []), u])
  }
  let notified = 0
  for (const [lang, group] of byLang) {
    const text = alertText(alert, lang)
    const res = await notifyUsers(ctx, {
      companyId: alert.companyId,
      users: group,
      channels: alert.severity === 'critical' ? ['in_app', 'sms', 'whatsapp', 'email'] : ['in_app', 'email'],
      title: text.title,
      message: `${text.detail} ${text.actions[0] ?? ''}`.trim(),
      link: `/cages/${alert.unitId}`,
      level: alert.severity === 'critical' ? 'error' : 'warning',
      dedupeKey: `farm-alert:${alert._id}:${alert.severity}`,
      source: 'farm_alert',
      unitName: alert.unitName,
      email: { alert: { steps: text.actions.slice(0, 5) } },
    })
    notified += res.notified
  }
  // Linked Telegram site groups with alerts on: tag the unit's keeper (VFQ-1).
  const keeper = await ctx.db
    .query('cageKeepers')
    .withIndex('by_unitId_and_active', (q) => q.eq('unitId', alert.unitId).eq('active', true))
    .first()
  await postGroupAlert(ctx, {
    companyId: alert.companyId,
    locationId: alert.locationId,
    mentionUserId: keeper && keeper.companyId === alert.companyId ? keeper.keeperId : undefined,
    text: (l) => {
      const x = alertText(alert, l)
      return `${x.title}. ${x.detail} ${x.actions[0] ?? ''}`.trim()
    },
  })
  return notified
}

/**
 * Evaluate a page of a company's units on `date` (default: yesterday in the
 * company's time zone) and schedule the next page. Idempotent per
 * unit/day/rule: running it twice for the same day refreshes the same rows.
 */
export const evaluateCompany = internalMutation({
  args: { companyId: v.id('companies'), date: v.optional(v.string()), cursor: v.optional(v.string()) },
  returns: v.object({ units: v.number(), raised: v.number(), notified: v.number(), done: v.boolean() }),
  handler: async (ctx, { companyId, date, cursor }) => {
    const company = await ctx.db.get(companyId)
    if (!company || company.status !== 'approved') return { units: 0, raised: 0, notified: 0, done: true }
    const tz = zoneFor(null, company)
    const asOf = date ?? addDays(todayIn(tz), -1)
    const page = await ctx.db
      .query('cages')
      .withIndex('by_company_status', (q) => q.eq('companyId', companyId))
      .paginate({ numItems: UNITS_PER_RUN, cursor: cursor ?? null })
    const overrides = await overridesFor(ctx, companyId)
    const now = Date.now()
    let units = 0
    let raised = 0
    let notified = 0
    for (const cage of page.page) {
      if (cage.archivedAt || !cage.currentBatchId || (cage.status !== 'active' && cage.status !== 'harvesting')) continue
      const batchId = cage.currentBatchId
      const stats = await ctx.db
        .query('batchStats')
        .withIndex('by_unitId_and_batchId', (q) => q.eq('unitId', cage._id).eq('batchId', batchId))
        .unique()
      if (!stats?.open || !stats.kpis.opened_on || stats.kpis.opened_on > asOf) continue
      units++
      const th = effectiveThresholds(unitTypeOf(cage), overrides)
      const input = await unitInput(ctx, cage, stats, asOf, tz, {
        doMin: th.dissolvedOxygen?.min,
        tempMin: th.temperatureC?.min,
        tempMax: th.temperatureC?.max,
      })
      const candidates = evaluateUnit(input)
      const seen = new Set<string>()
      for (const c of candidates) {
        seen.add(c.rule)
        const prior = await ctx.db
          .query('farmAlerts')
          .withIndex('by_unitId_and_rule', (q) => q.eq('unitId', cage._id).eq('rule', c.rule))
          .order('desc')
          .first()
        // A new cycle in the unit starts afresh.
        const sameCycle = prior && prior.batchId === batchId ? prior : null
        const decision = decide(sameCycle, c)
        if (decision.action === 'suppress') continue
        if (decision.action === 'refresh' && sameCycle) {
          const severity = SEVERITY_RANK[c.severity] > SEVERITY_RANK[sameCycle.severity] ? c.severity : sameCycle.severity
          const patch: Partial<Doc<'farmAlerts'>> = {
            evidence: c.evidence,
            severity,
            lastSeenDate: c.date > sameCycle.lastSeenDate ? c.date : sameCycle.lastSeenDate,
            unitName: cage.name,
            locationId: cage.locationId,
            updatedAt: now,
          }
          // Getting worse re-opens an acknowledged alert.
          if (decision.escalated && sameCycle.status === 'acknowledged') patch.status = 'open'
          await ctx.db.patch(sameCycle._id, patch)
          if (decision.escalated && sameCycle.status !== 'resolved' && notified < NOTIFY_CAP) {
            const fresh = (await ctx.db.get(sameCycle._id))!
            notified += await notifyAlert(ctx, fresh)
            await ctx.db.patch(sameCycle._id, { notifiedAt: now })
          }
          continue
        }
        const id = await insertAlert(ctx, { companyId, cage, batchId, candidate: c, now })
        raised++
        if (notified < NOTIFY_CAP) {
          notified += await notifyAlert(ctx, (await ctx.db.get(id))!)
          await ctx.db.patch(id, { notifiedAt: now })
        }
      }
      // Conditions that cleared: close their alerts after a grace period.
      const unitAlerts = await ctx.db
        .query('farmAlerts')
        .withIndex('by_unitId_and_rule', (q) => q.eq('unitId', cage._id))
        .order('desc')
        .take(100)
      for (const a of unitAlerts) {
        if (a.status === 'resolved' || seen.has(a.rule)) continue
        if (a.batchId !== batchId || a.lastSeenDate < addDays(asOf, -STALE_DAYS)) {
          await ctx.db.patch(a._id, { status: 'resolved', autoResolved: true, resolvedAt: now, updatedAt: now })
        }
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.farmAlerts.evaluateCompany, { companyId, date: asOf, cursor: page.continueCursor })
    }
    return { units, raised, notified, done: page.isDone }
  },
})

async function insertAlert(
  ctx: MutationCtx,
  a: { companyId: Id<'companies'>; cage: Doc<'cages'>; batchId: Id<'batches'>; candidate: Candidate; now: number },
) {
  return await ctx.db.insert('farmAlerts', {
    companyId: a.companyId,
    locationId: a.cage.locationId,
    unitId: a.cage._id,
    batchId: a.batchId,
    unitName: a.cage.name,
    rule: a.candidate.rule,
    severity: a.candidate.severity,
    status: 'open',
    date: a.candidate.date,
    lastSeenDate: a.candidate.date,
    evidence: a.candidate.evidence,
    createdAt: a.now,
    updatedAt: a.now,
  })
}

/** Alerts raised in [from, to] in a site (or the company), for the weekly report. */
export async function alertsForReport(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
  locationId: Id<'farmLocations'> | null,
  from: string,
  to: string,
) {
  const inSite = (a: Doc<'farmAlerts'>) => !locationId || a.locationId === locationId
  const raised = (
    await ctx.db
      .query('farmAlerts')
      .withIndex('by_companyId_and_date', (q) => q.eq('companyId', companyId).gte('date', from).lte('date', to))
      .take(1000)
  ).filter(inSite)
  const live = (await liveAlerts(ctx, companyId)).filter(inSite)
  return { raised, live }
}
