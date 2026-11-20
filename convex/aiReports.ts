import { v } from 'convex/values'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import { action, internalAction, internalMutation, internalQuery, query } from './_generated/server'
import type { ActionCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { addDays, todayIn, zoneFor } from './lib/dates'
import { can, memberContextIn, requireMember, type MemberContext } from './lib/permissions'
import { userError } from './lib/errors'
import { notifyUsers } from './lib/notify'
import { membersWithPermission } from './approvalAlerts'
import { groupKpis, periodOf, type Period } from './lib/analytics'
import { splitExpenses } from './lib/costing'
import { mergeSettings } from './lib/farmRules'
import { orgProfile } from './lib/orgProfile'
import { recommendRation } from './lib/ration'
import { tablesFor } from './feedingPlans'
import { alertsForReport } from './farmAlerts'
import { alertText, langOf } from './lib/earlyWarning'
import {
  acceptReply,
  financeText,
  packFigures,
  reportFigures,
  reportMessages,
  templateReport,
  weekEndOn,
  weekStartOf,
  weeklyEmailHighlights,
  type FinancePack,
  type Lang,
  type ReportPack,
} from './lib/weeklyReport'
import { decryptJson, readEncryptionKey } from './lib/crypto'
import { FetchLive } from './lib/effectHttp'
import { PROVIDERS, llmCredentialAad } from './lib/llmGateway'
import { listedPrice } from './lib/llmModels'
import { chooseModel } from './llmModels'
import { chatWithUsage, type ChatReply } from './lib/llmProviders'
import type { ReportBegin } from './llmGateway'

/**
 * Weekly natural-language report (AI-003, docs/architecture/22-insights-engine.md).
 *
 * `buildPack` turns the rollups of a site (or the whole company) into a data
 * pack for the week ending on a Sunday; `generateWeekly` asks the LLM
 * gateway (the organization's key, else a server key set in the Convex
 * environment) to phrase it, keeps the reply only if every figure in it is
 * in the pack, and otherwise stores the template text. Costs are rendered by
 * code into `financeText` and never sent to the LLM; readers without
 * finance.view never get them.
 *
 * Scope: a site report is for members with that site; the company-wide
 * report is for all-sites members only (PERM-004).
 */

const MAX_OCCUPANCIES = 2000
const langV = v.union(v.literal('en'), v.literal('fr'))

const reportValidator = v.object({
  _id: v.id('weeklyReports'),
  locationId: v.union(v.id('farmLocations'), v.null()),
  siteName: v.union(v.string(), v.null()),
  weekEnd: v.string(),
  lang: langV,
  text: v.string(),
  financeText: v.union(v.string(), v.null()),
  source: v.union(v.literal('llm'), v.literal('template')),
  createdAt: v.number(),
  /** Key figures from the stored pack (no costs); null when unreadable. */
  figures: v.union(
    v.null(),
    v.object({
      weekStart: v.string(),
      units: v.number(),
      feedKg: v.number(),
      gainKg: v.number(),
      fcr: v.union(v.number(), v.null()),
      previousFcr: v.union(v.number(), v.null()),
      mortality: v.number(),
      mortalityPct: v.union(v.number(), v.null()),
      survivalPct: v.union(v.number(), v.null()),
      feedVsSuggestedPct: v.union(v.number(), v.null()),
      alertsRaised: v.number(),
      alertsOpen: v.number(),
    }),
  ),
})

/** A report scope is visible to the member: their site, or company-wide for all-sites members. */
function reportInScope(m: MemberContext, locationId: Id<'farmLocations'> | null | undefined) {
  if (m.siteScope === 'all') return true
  return !!locationId && m.siteScope.has(locationId)
}

// ---------------------------------------------------------------------------
// Data pack
// ---------------------------------------------------------------------------

type Built = { pack: ReportPack; finance: FinancePack }

async function build(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
  locationId: Id<'farmLocations'> | null,
  weekEnd: string,
  lang: Lang,
): Promise<Built | null> {
  const company = await ctx.db.get(companyId)
  if (!company) return null
  const site = locationId ? await ctx.db.get(locationId) : null
  if (locationId && (!site || site.companyId !== companyId)) return null
  const from = weekStartOf(weekEnd)
  const prevEnd = addDays(weekEnd, -7)
  const prevFrom = weekStartOf(prevEnd)

  const cages = new Map<string, Doc<'cages'>>()
  const cageOf = async (id: Id<'cages'>) => {
    const k = String(id)
    if (!cages.has(k)) {
      const c = await ctx.db.get(id)
      if (c) cages.set(k, c)
    }
    return cages.get(k) ?? null
  }
  const all = await ctx.db
    .query('batchStats')
    .withIndex('by_companyId_and_lastDate', (q) => q.eq('companyId', companyId).gte('lastDate', prevFrom))
    .take(MAX_OCCUPANCIES)
  const stats: Doc<'batchStats'>[] = []
  for (const s of all) {
    const site = s.locationId ?? (await cageOf(s.unitId))?.locationId ?? null
    if (!locationId || site === locationId) stats.push(s)
  }
  const periods = stats.map((s) => periodOf(s, from, weekEnd)).filter((p): p is Period => p != null)
  const prev = stats.map((s) => periodOf(s, prevFrom, prevEnd)).filter((p): p is Period => p != null)
  const k = groupKpis(periods)
  const kp = prev.length ? groupKpis(prev) : null

  // Suggested feed: the daily ration at mid-week count and ABW, times the days stocked in the week.
  const tables = await tablesFor(ctx, companyId)
  let suggested = 0
  let planned = 0
  for (const p of periods) {
    const s = p.stats
    const cage = await cageOf(s.unitId)
    const species = s.speciesCode ?? cage?.species ?? null
    const startCount = p.start?.count ?? p.stockedCount
    const count = (startCount + p.end.count) / 2
    const startAbw = p.start?.abwG ?? s.kpis.initial_abw_g
    const abw = startAbw != null && p.end.abwG != null ? (startAbw + p.end.abwG) / 2 : (p.end.abwG ?? startAbw)
    const r = recommendRation({ count, abwG: abw, bands: species ? tables.get(species) : null, speciesKey: species })
    if (!r.ok) continue
    const first = s.kpis.opened_on && s.kpis.opened_on > from ? s.kpis.opened_on : from
    const last = !s.open && s.lastDate < weekEnd ? s.lastDate : weekEnd
    const days = Math.max(0, Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1)
    suggested += r.kgPerDay * Math.min(7, days)
    planned++
  }

  const units = []
  for (const p of periods) {
    const g = groupKpis([p])
    units.push({ name: (await cageOf(p.stats.unitId))?.name ?? p.stats.batchNumber, mortality: g.mortality, feed_kg: g.feed_kg, gain_kg: g.gain_kg, fcr: g.fcr })
  }
  units.sort((a, b) => b.mortality - a.mortality)

  const alerts = await alertsForReport(ctx, companyId, locationId, from, weekEnd)
  const pack: ReportPack = {
    company: company.name,
    site: site?.name ?? null,
    weekStart: from,
    weekEnd,
    week: packFigures(k, planned ? suggested : null),
    previous: kp ? { feed_kg: kp.feed_kg, gain_kg: kp.gain_kg, fcr: kp.fcr, mortality: kp.mortality } : null,
    units: units.slice(0, 5),
    alerts: {
      raised: alerts.raised.length,
      critical: alerts.raised.filter((a) => a.severity === 'critical').length,
      open: alerts.live.length,
      items: [...alerts.live]
        .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
        .slice(0, 5)
        .map((a) => ({ unit: a.unitName, title: alertText(a, lang).title, severity: a.severity })),
    },
  }

  // Costs (finance.view only): feed at purchase prices plus the week's expenses in scope.
  const expenses = (
    await ctx.db
      .query('expenses')
      .withIndex('by_company_and_date', (q) => q.eq('companyId', companyId).gte('date', from).lte('date', weekEnd))
      .take(5000)
  ).filter((e) => !e.deletedAt)
  const inSite: typeof expenses = []
  for (const e of expenses) {
    const where = e.locationId ?? (e.cageId ? (await cageOf(e.cageId))?.locationId ?? null : null)
    if (!locationId || where === locationId) inSite.push(e)
  }
  const split = splitExpenses(inSite)
  const total = k.feed_cost + split.total
  const finance: FinancePack = {
    currency: mergeSettings(company.settings).locale.currency ?? '',
    feed_cost: k.feed_cost,
    other_cost: Math.round(split.total * 100) / 100,
    total_cost: Math.round(total * 100) / 100,
    cost_per_kg_gain: k.gain_kg > 0 ? Math.round((total / k.gain_kg) * 100) / 100 : null,
  }
  return { pack, finance }
}

/** Internal: the week's pack, its template text and the costs text. */
export const buildPack = internalQuery({
  args: {
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    weekEnd: v.string(),
    lang: langV,
  },
  returns: v.union(
    v.null(),
    v.object({ packJson: v.string(), units: v.number(), templateText: v.string(), financeText: v.string() }),
  ),
  handler: async (ctx, { companyId, locationId, weekEnd, lang }) => {
    const built = await build(ctx, companyId, locationId ?? null, weekEndOn(weekEnd), lang)
    if (!built) return null
    return {
      packJson: JSON.stringify(built.pack),
      units: built.pack.week.units,
      templateText: templateReport(built.pack, lang),
      financeText: financeText(built.finance, lang),
    }
  },
})

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export const existing = internalQuery({
  args: { companyId: v.id('companies'), locationId: v.optional(v.id('farmLocations')), weekEnd: v.string(), lang: langV },
  returns: v.union(v.object({ _id: v.id('weeklyReports'), source: v.union(v.literal('llm'), v.literal('template')) }), v.null()),
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query('weeklyReports')
      .withIndex('by_companyId_and_locationId_and_weekEnd_and_lang', (q) =>
        q.eq('companyId', a.companyId).eq('locationId', a.locationId).eq('weekEnd', a.weekEnd).eq('lang', a.lang),
      )
      .first()
    return row ? { _id: row._id, source: row.source } : null
  },
})

export const save = internalMutation({
  args: {
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    weekEnd: v.string(),
    lang: langV,
    text: v.string(),
    financeText: v.string(),
    source: v.union(v.literal('llm'), v.literal('template')),
    providerId: v.optional(v.string()),
    model: v.optional(v.string()),
    packJson: v.string(),
    requestedBy: v.optional(v.id('users')),
  },
  returns: v.id('weeklyReports'),
  handler: async (ctx, a) => {
    const prior = await ctx.db
      .query('weeklyReports')
      .withIndex('by_companyId_and_locationId_and_weekEnd_and_lang', (q) =>
        q.eq('companyId', a.companyId).eq('locationId', a.locationId).eq('weekEnd', a.weekEnd).eq('lang', a.lang),
      )
      .first()
    const row = { ...a, createdAt: Date.now() }
    if (prior) {
      await ctx.db.replace(prior._id, { ...row, deliveredAt: prior.deliveredAt })
      return prior._id
    }
    return await ctx.db.insert('weeklyReports', row)
  },
})

/** A provider whose key is set in the Convex environment (LLM_DEFAULT_PROVIDER first), or null. */
function serverKey(): { providerId: string; apiKey: string } | null {
  const names: Record<string, string> = {
    gemini: 'GEMINI_API_KEY',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    groq: 'GROQ_API_KEY',
  }
  const preferred = (process.env.LLM_DEFAULT_PROVIDER ?? '').trim()
  for (const id of [preferred, ...Object.keys(names)]) {
    const key = names[id] ? (process.env[names[id]] ?? '').trim() : ''
    if (key && PROVIDERS[id]) return { providerId: id, apiKey: key }
  }
  return null
}

type Phrased = { text: string; providerId: string; model: string } | null

/** Ask the gateway to phrase the pack; null when no key, no quota, a failed call or an ungrounded reply. */
async function phrase(
  ctx: ActionCtx,
  companyId: Id<'companies'>,
  userId: Id<'users'> | undefined,
  pack: ReportPack,
  lang: Lang,
): Promise<Phrased> {
  const server = serverKey()
  const begun: ReportBegin = await ctx.runMutation(internal.llmGateway.beginReport, {
    companyId,
    userId,
    serverProviderId: server?.providerId,
  })
  if (begun.mode === 'none') return null
  let apiKey = server?.apiKey ?? ''
  let baseUrl = PROVIDERS[begun.providerId]?.baseUrl ?? ''
  if (begun.mode === 'org_key') {
    const key = readEncryptionKey()
    if (!key) return null
    try {
      apiKey = (
        await decryptJson<{ apiKey: string }>(
          { ciphertext: begun.ciphertext, iv: begun.iv },
          llmCredentialAad(companyId, begun.credentialId),
          key,
        )
      ).apiKey
    } catch {
      return null
    }
    if (begun.providerId === 'custom') baseUrl = begun.baseUrl ?? ''
  }
  const provider = PROVIDERS[begun.providerId]
  if (!provider || !apiKey) return null
  // The model from the key's live list (D-022); none reachable → template.
  const { choice, models } = await chooseModel(ctx, {
    target: { providerId: provider.id, kind: provider.kind, baseUrl, apiKey },
    scope: begun.mode === 'org_key' ? companyId : 'server',
    saved: begun.model,
  })
  if (!choice.ok) {
    console.warn(`[aiReports] ${choice.error}`)
    return null
  }
  const model = choice.model
  const started = Date.now()
  const outcome = await Effect.runPromise(
    Effect.result(
      chatWithUsage({
        kind: provider.kind,
        providerId: provider.id,
        baseUrl,
        apiKey,
        model,
        messages: reportMessages(pack, lang),
        temperature: 0.2,
      }),
    ).pipe(Effect.provide(FetchLive)),
  )
  const reply: ChatReply | null = Result.isSuccess(outcome) ? outcome.success : null
  await ctx.runMutation(internal.llmGateway.recordReportUsage, {
    companyId,
    userId,
    source: begun.mode,
    providerId: begun.providerId,
    model,
    ok: !!reply,
    error: Result.isFailure(outcome) ? outcome.failure.message : undefined,
    inputTokens: reply?.usage.inputTokens,
    outputTokens: reply?.usage.outputTokens,
    durationMs: Date.now() - started,
    ...(listedPrice(models, model) ?? {}),
  })
  const text = reply ? acceptReply(reply.text, pack, lang) : null
  return text ? { text, providerId: begun.providerId, model } : null
}

type GenerateArgs = {
  companyId: Id<'companies'>
  locationId?: Id<'farmLocations'>
  weekEnd: string
  lang: Lang
  requestedBy?: Id<'users'>
  useLlm?: boolean
  force?: boolean
  deliver?: boolean
  skipEmpty?: boolean
}
type Generated = { reportId: Id<'weeklyReports'>; source: 'llm' | 'template'; reused: boolean } | null

async function generate(ctx: ActionCtx, a: GenerateArgs): Promise<Generated> {
  const weekEnd = weekEndOn(a.weekEnd)
  const key = { companyId: a.companyId, locationId: a.locationId, weekEnd, lang: a.lang }
  if (!a.force) {
    const prior: { _id: Id<'weeklyReports'>; source: 'llm' | 'template' } | null = await ctx.runQuery(internal.aiReports.existing, key)
    if (prior) return { reportId: prior._id, source: prior.source, reused: true }
  }
  const built: { packJson: string; units: number; templateText: string; financeText: string } | null = await ctx.runQuery(
    internal.aiReports.buildPack,
    key,
  )
  if (!built || (a.skipEmpty && built.units === 0)) return null
  const pack = JSON.parse(built.packJson) as ReportPack
  const phrased = a.useLlm === false ? null : await phrase(ctx, a.companyId, a.requestedBy, pack, a.lang)
  const reportId: Id<'weeklyReports'> = await ctx.runMutation(internal.aiReports.save, {
    ...key,
    text: phrased?.text ?? built.templateText,
    financeText: built.financeText,
    source: phrased ? 'llm' : 'template',
    providerId: phrased?.providerId,
    model: phrased?.model,
    packJson: built.packJson,
    requestedBy: a.requestedBy,
  })
  if (a.deliver) await ctx.runMutation(internal.aiReports.deliver, { reportId })
  return { reportId, source: phrased ? 'llm' : 'template', reused: false }
}

const generatedValidator = v.union(
  v.null(),
  v.object({ reportId: v.id('weeklyReports'), source: v.union(v.literal('llm'), v.literal('template')), reused: v.boolean() }),
)

/**
 * Internal (cron, the app, and later the chat bot): the report for a scope,
 * week and language. Reuses a stored one unless `force`. With `deliver`, it
 * also goes to the scope's members (in-app and email, per preferences).
 * `useLlm: false` writes the template text without calling a provider.
 */
export const generateWeekly = internalAction({
  args: {
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    weekEnd: v.string(),
    lang: langV,
    requestedBy: v.optional(v.id('users')),
    useLlm: v.optional(v.boolean()),
    force: v.optional(v.boolean()),
    deliver: v.optional(v.boolean()),
    /** Skip scopes with no stocked units (the weekly cron). */
    skipEmpty: v.optional(v.boolean()),
  },
  returns: generatedValidator,
  handler: async (ctx, a): Promise<Generated> => await generate(ctx, a),
})

/** Members who may read a report scope, with whether they see costs. */
async function readers(ctx: QueryCtx, companyId: Id<'companies'>, locationId: Id<'farmLocations'> | undefined) {
  const out: Array<{ user: Doc<'users'>; finance: boolean; lang: Lang }> = []
  for (const u of await membersWithPermission(ctx, companyId, 'reports.view', locationId)) {
    const m = await memberContextIn(ctx, u, companyId)
    if (!m || !reportInScope(m, locationId)) continue
    out.push({ user: u, finance: can(m, 'finance.view'), lang: langOf(u.locale) })
  }
  return out
}

/** Internal: the languages a scope's readers use (the cron writes one report per language). */
export const readerLangs = internalQuery({
  args: { companyId: v.id('companies'), locationId: v.optional(v.id('farmLocations')) },
  returns: v.array(langV),
  handler: async (ctx, { companyId, locationId }) => {
    return [...new Set((await readers(ctx, companyId, locationId)).map((r) => r.lang))]
  },
})

/** Send a report to its scope's readers in its language; costs only to finance.view. Once per report. */
export const deliver = internalMutation({
  args: { reportId: v.id('weeklyReports') },
  returns: v.number(),
  handler: async (ctx, { reportId }) => {
    const r = await ctx.db.get(reportId)
    if (!r || r.deliveredAt) return 0
    const site = r.locationId ? await ctx.db.get(r.locationId) : null
    const who = (await readers(ctx, r.companyId, r.locationId)).filter((x) => x.lang === r.lang)
    const fr = r.lang === 'fr'
    const title = `${fr ? 'Rapport hebdomadaire' : 'Weekly report'}${site ? ` — ${site.name}` : ''} (${r.weekEnd})`
    // Highlights for the HTML email (Paper E6); facts from the stored pack only.
    const h = weeklyEmailHighlights(r.packJson, r.lang)
    const weeklyEmail = h
      ? {
          weekly: {
            siteName: site?.name,
            weekStart: weekStartOf(r.weekEnd),
            weekEnd: r.weekEnd,
            units: h.units,
            goodNumber: h.goodNumber,
            things: h.things,
          },
        }
      : undefined
    let notified = 0
    for (const finance of [true, false]) {
      const users = who.filter((x) => x.finance === finance).map((x) => x.user)
      if (!users.length) continue
      const res = await notifyUsers(ctx, {
        companyId: r.companyId,
        users,
        channels: ['in_app', 'email'],
        title,
        message: finance && r.financeText ? `${r.text}\n\n${r.financeText}` : r.text,
        link: '/weekly-report',
        level: 'info',
        dedupeKey: `weekly-report:${r._id}`,
        source: 'weekly_report',
        email: weeklyEmail,
      })
      notified += res.notified
    }
    await ctx.db.patch(r._id, { deliveredAt: Date.now() })
    return notified
  },
})

// ---------------------------------------------------------------------------
// Cron: Monday 06:00 UTC, the week that ended on Sunday
// ---------------------------------------------------------------------------

export const weeklyTick = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ scheduled: v.number(), done: v.boolean() }),
  handler: async (ctx, { cursor }): Promise<{ scheduled: number; done: boolean }> => {
    const page = await ctx.db
      .query('companies')
      .withIndex('by_status', (q) => q.eq('status', 'approved'))
      .paginate({ numItems: 20, cursor: cursor ?? null })
    let scheduled = 0
    for (const c of page.page) {
      const weekEnd = weekEndOn(addDays(todayIn(zoneFor(null, c)), -1))
      const sites = await ctx.db
        .query('farmLocations')
        .withIndex('by_company', (q) => q.eq('companyId', c._id))
        .take(100)
      const scopes: Array<Id<'farmLocations'> | undefined> = [undefined, ...sites.filter((s) => s.active).map((s) => s._id)]
      for (const locationId of scopes) {
        await ctx.scheduler.runAfter(scheduled * 2000, internal.aiReports.weeklyForScope, { companyId: c._id, locationId, weekEnd })
        scheduled++
      }
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.aiReports.weeklyTick, { cursor: page.continueCursor })
    return { scheduled, done: page.isDone }
  },
})

export const weeklyForScope = internalAction({
  args: { companyId: v.id('companies'), locationId: v.optional(v.id('farmLocations')), weekEnd: v.string() },
  returns: v.number(),
  handler: async (ctx, a): Promise<number> => {
    const langs: Lang[] = await ctx.runQuery(internal.aiReports.readerLangs, { companyId: a.companyId, locationId: a.locationId })
    let made = 0
    for (const lang of langs) {
      const r = await generate(ctx, { ...a, lang, deliver: true, skipEmpty: true })
      if (r && !r.reused) made++
    }
    return made
  },
})

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/** Recent weekly reports the caller may read (site reports in their sites; company-wide for all-sites members). */
export const list = query({
  args: { locationId: v.optional(v.id('farmLocations')), lang: v.optional(langV) },
  returns: v.array(reportValidator),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'reports.view', locationId: args.locationId })
    if (!m.companyId) return []
    const companyId = m.companyId
    const finance = can(m, 'finance.view')
    const rows = await ctx.db
      .query('weeklyReports')
      .withIndex('by_companyId_and_weekEnd', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(200)
    const names = new Map<string, string>()
    const out = []
    for (const r of rows) {
      if (!reportInScope(m, r.locationId)) continue
      if (args.locationId !== undefined && r.locationId !== args.locationId) continue
      if (args.lang && r.lang !== args.lang) continue
      if (r.locationId && !names.has(r.locationId)) names.set(r.locationId, (await ctx.db.get(r.locationId))?.name ?? '—')
      out.push({
        _id: r._id,
        locationId: r.locationId ?? null,
        siteName: r.locationId ? names.get(r.locationId)! : null,
        weekEnd: r.weekEnd,
        lang: r.lang,
        text: r.text,
        financeText: finance ? (r.financeText ?? null) : null,
        source: r.source,
        createdAt: r.createdAt,
        figures: reportFigures(r.packJson),
      })
      if (out.length >= 30) break
    }
    return out
  },
})

/** Internal: who is asking and what they may do (actions have no db). */
export const access = internalQuery({
  args: { locationId: v.optional(v.id('farmLocations')) },
  returns: v.object({
    companyId: v.id('companies'),
    userId: v.id('users'),
    aiUse: v.boolean(),
    lang: langV,
    tz: v.string(),
  }),
  handler: async (ctx, { locationId }) => {
    const m = await requireMember(ctx, { permission: 'reports.view', locationId })
    if (!m.companyId) throw userError('FORBIDDEN', 'No company')
    if (!reportInScope(m, locationId ?? null)) {
      throw userError('FORBIDDEN', 'The company-wide report is for members with access to every site', { reason: 'SITE_FORBIDDEN' })
    }
    const company = await ctx.db.get(m.companyId)
    return {
      companyId: m.companyId,
      userId: m.user._id,
      aiUse: can(m, 'ai.use'),
      lang: langOf(m.user.locale ?? orgProfile(company).defaultLocale),
      tz: zoneFor(null, company),
    }
  },
})

/** Write (or rewrite) last week's report for a site or the company now; not delivered. */
export const generateNow = action({
  args: { locationId: v.optional(v.id('farmLocations')), lang: v.optional(langV) },
  returns: v.object({ reportId: v.id('weeklyReports'), source: v.union(v.literal('llm'), v.literal('template')) }),
  handler: async (ctx, args): Promise<{ reportId: Id<'weeklyReports'>; source: 'llm' | 'template' }> => {
    const who: { companyId: Id<'companies'>; userId: Id<'users'>; aiUse: boolean; lang: Lang; tz: string } = await ctx.runQuery(
      internal.aiReports.access,
      { locationId: args.locationId },
    )
    const r = await generate(ctx, {
      companyId: who.companyId,
      locationId: args.locationId,
      weekEnd: weekEndOn(addDays(todayIn(who.tz), -1)),
      lang: args.lang ?? who.lang,
      requestedBy: who.userId,
      useLlm: who.aiUse,
      force: true,
    })
    if (!r) throw userError('NOT_FOUND', 'Nothing to report for this scope')
    return { reportId: r.reportId, source: r.source }
  },
})

/**
 * Internal, for the chat bot: last week's report for a member (their site
 * when they have one, else company-wide), in their language, written now if
 * missing. Costs only with finance.view. Null when the user may not read
 * reports.
 */
export const forBot = internalAction({
  args: { companyId: v.id('companies'), userId: v.id('users'), locationId: v.optional(v.id('farmLocations')) },
  returns: v.union(v.null(), v.object({ weekEnd: v.string(), text: v.string(), financeText: v.union(v.string(), v.null()) })),
  handler: async (ctx, a): Promise<{ weekEnd: string; text: string; financeText: string | null } | null> => {
    const who: { lang: Lang; tz: string; finance: boolean; aiUse: boolean; locationId: Id<'farmLocations'> | null } | null =
      await ctx.runQuery(internal.aiReports.botAccess, a)
    if (!who) return null
    const weekEnd = weekEndOn(addDays(todayIn(who.tz), -1))
    const r = await generate(ctx, {
      companyId: a.companyId,
      locationId: who.locationId ?? undefined,
      weekEnd,
      lang: who.lang,
      requestedBy: a.userId,
      useLlm: who.aiUse,
    })
    if (!r) return null
    const row: { text: string; financeText: string | null } | null = await ctx.runQuery(internal.aiReports.textOf, { reportId: r.reportId })
    if (!row) return null
    return { weekEnd, text: row.text, financeText: who.finance ? row.financeText : null }
  },
})

export const botAccess = internalQuery({
  args: { companyId: v.id('companies'), userId: v.id('users'), locationId: v.optional(v.id('farmLocations')) },
  returns: v.union(
    v.null(),
    v.object({ lang: langV, tz: v.string(), finance: v.boolean(), aiUse: v.boolean(), locationId: v.union(v.id('farmLocations'), v.null()) }),
  ),
  handler: async (ctx, { companyId, userId, locationId }) => {
    const user = await ctx.db.get(userId)
    if (!user) return null
    const m = await memberContextIn(ctx, user, companyId)
    if (!m || !can(m, 'reports.view')) return null
    // Default scope: company-wide for all-sites members, else their first site.
    const scope = locationId ?? (m.siteScope === 'all' ? null : ([...m.siteScope][0] ?? null))
    if (!reportInScope(m, scope)) return null
    const company = await ctx.db.get(companyId)
    return {
      lang: langOf(user.locale ?? orgProfile(company).defaultLocale),
      tz: zoneFor(null, company),
      finance: can(m, 'finance.view'),
      aiUse: can(m, 'ai.use'),
      locationId: scope,
    }
  },
})

export const textOf = internalQuery({
  args: { reportId: v.id('weeklyReports') },
  returns: v.union(v.null(), v.object({ text: v.string(), financeText: v.union(v.string(), v.null()) })),
  handler: async (ctx, { reportId }) => {
    const r = await ctx.db.get(reportId)
    return r ? { text: r.text, financeText: r.financeText ?? null } : null
  },
})
