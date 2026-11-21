/**
 * Bot templates (Paper T2a Telegram /t, T2b web manager).
 *
 * A template is a saved way to fill drafts: a daily entry from the feeding
 * plan or as yesterday, a water check (DO and temperature in one line) or a
 * feed issue. Templates are company-scoped and either personal (only the
 * owner) or shared with a site (everyone at it who may record). Using one
 * never writes: it fills a draft group (groups.ts) the user checks and saves
 * through the normal BOT-003 path.
 *
 * Permissions: personal templates need the permission of what they fill
 * (production.daily.record, inventory.issue for feed issues); sharing with a
 * site, and editing shared ones, needs production.keepers.manage with the
 * site in scope. Every read and write is limited to the caller's
 * organization; ids from another one are "not found".
 */
import { v, type Infer } from 'convex/values'
import { internalAction, internalQuery, mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { can, memberContextIn, requireMember, type MemberContext } from '../lib/permissions'
import { userError } from '../lib/errors'
import { addDays, todayIn, zoneFor } from '../lib/dates'
import { orgProfile } from '../lib/orgProfile'
import { round } from '../lib/kpi'
import { logAudit } from '../lib/tenancy'
import { notifyUsers } from '../lib/notify'
import { unitTypeOf } from '../lib/farmRules'
import { effectiveThresholds } from '../lib/waterQuality'
import { overridesFor } from '../waterQuality'
import { cageRation, tablesFor } from '../feedingPlans'
import { ownUnitIds, minutesIn } from '../keepers/escalation'
import { byUnitName, needsDailyLog, personName, reachesSite, rowOf } from '../keepers/model'
import { escapeHtml } from '../messaging/providers/telegramBot'
import { checkBinding, farmDate, inScope, unitKey, type BoundMember } from './scope'
import { DRAFT_TTL_MS, proposeFor } from './pending'
import { GROUP_VERBS, cagesLabel, groupDrafts, groupKey, groupMessage, loadGroup, newGroup } from './groups'
import { deliver } from './outbound'
import { rt } from './roundI18n'
import { templateCages, templateKind } from './tables'
import type { ChatMessageValue, RoutePlan, Target } from './validators'

export const MAX_TEMPLATES = 200
export const MAX_PERSONAL = 30
export const MAX_TEMPLATE_CAGES = 50
const MAX_LISTED = 20
const USAGE_DAYS = 31
/** Typing one entry in a chat takes about a minute; a template entry saves it (the "typing saved" figure). */
export const SECONDS_SAVED_PER_ENTRY = 60
const AWAIT_MS = 30 * 60 * 1000
const MAX_UNITS_READ = 1000

export const TEMPLATE_VERBS = { use: 'tu', saveLast: 'ts' } as const

type Ctx = QueryCtx | MutationCtx
type Tgt = Target & { bindingId: Id<'channelBindings'> }
type Template = Doc<'botTemplates'>
type Source = { sourceMessageId: string; sentAt: number }

const text = (m: string): ChatMessageValue => ({ kind: 'text', text: m })
const firstName = (u: Doc<'users'> | null) => personName(u).split(/\s+/)[0]

/** What the template needs to fill (feed issues are inventory, the rest daily records). */
function permissionFor(kind: Template['kind']) {
  return kind === 'feed_issue' ? ('inventory.issue' as const) : ('production.daily.record' as const)
}

/** May this member use the template (own personal, or shared with a site in scope)? */
function usableBy(t: Template, m: MemberContext, userId: Id<'users'>, activeSite: Id<'farmLocations'> | null): boolean {
  if (!can(m, permissionFor(t.kind))) return false
  if (t.scope === 'personal') return t.ownerId === userId
  if (!t.siteId || (m.siteScope !== 'all' && !m.siteScope.has(t.siteId))) return false
  return !activeSite || activeSite === t.siteId
}

/** May this member change or delete it: the owner of a personal one, or a manager with the site in scope. */
function editableBy(t: Template, m: MemberContext): boolean {
  const manager = can(m, 'production.keepers.manage')
  if (t.scope === 'personal') return t.ownerId === m.user._id || manager
  return manager && !!t.siteId && (m.siteScope === 'all' || m.siteScope.has(t.siteId))
}

function uses30(t: Template, today: string) {
  const from = addDays(today, -29)
  let uses = 0
  let entries = 0
  for (const u of t.usage) {
    if (u.date >= from && u.date <= today) {
      uses += u.uses
      entries += u.entries
    }
  }
  return { uses, entries }
}

async function bumpUsage(ctx: MutationCtx, t: Template, date: string, entries: number) {
  const usage = t.usage.filter((u) => u.date !== date)
  const today = t.usage.find((u) => u.date === date)
  usage.push({ date, uses: (today?.uses ?? 0) + 1, entries: (today?.entries ?? 0) + entries })
  usage.sort((a, b) => a.date.localeCompare(b.date))
  await ctx.db.patch(t._id, { usage: usage.slice(-USAGE_DAYS), lastUsedAt: Date.now() })
}

async function companyTemplates(ctx: Ctx, companyId: Id<'companies'>) {
  return await ctx.db
    .query('botTemplates')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .take(MAX_TEMPLATES)
}

/** Units of a row (at a site, else every site in scope), stocked, by name. */
async function rowUnits(ctx: Ctx, companyId: Id<'companies'>, m: MemberContext, row: string, siteId: Id<'farmLocations'> | undefined) {
  const rows = siteId
    ? await ctx.db
        .query('cages')
        .withIndex('by_company_location', (q) => q.eq('companyId', companyId).eq('locationId', siteId))
        .take(MAX_UNITS_READ)
    : await ctx.db
        .query('cages')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(MAX_UNITS_READ)
  const key = row.trim().toUpperCase()
  return rows
    .filter(
      (u) =>
        !u.archivedAt &&
        needsDailyLog(u) &&
        rowOf(u).toUpperCase() === key &&
        (m.siteScope === 'all' || (!!u.locationId && m.siteScope.has(u.locationId))),
    )
    .sort(byUnitName)
    .slice(0, MAX_TEMPLATE_CAGES)
}

/** The cages a template fills for this chat today. */
async function templateUnits(ctx: Ctx, bound: BoundMember, t: Template, today: string): Promise<Doc<'cages'>[]> {
  const companyId = bound.binding.companyId
  const c = t.cages
  if (c.mode === 'none') return []
  if (c.mode === 'row') return await rowUnits(ctx, companyId, bound.member, c.row, c.siteId ?? t.siteId)
  const ids: string[] =
    c.mode === 'list' ? c.cageIds : [...((await ownUnitIds(ctx, companyId, bound.binding.userId, today)) ?? [])]
  const out: Doc<'cages'>[] = []
  for (const raw of ids.slice(0, 500)) {
    const id = ctx.db.normalizeId('cages', raw)
    const u = id ? await ctx.db.get(id) : null
    if (!u || u.companyId !== companyId || u.archivedAt || !needsDailyLog(u) || !inScope(bound, u.locationId)) continue
    out.push(u)
  }
  return out.sort(byUnitName).slice(0, MAX_TEMPLATE_CAGES)
}

// ---------------------------------------------------------------------------
// Chat: /t (called from inbound.route, inside its transaction)

async function usableTemplates(ctx: Ctx, bound: BoundMember) {
  const today = todayIn(zoneFor(bound.site, bound.company))
  const rows = (await companyTemplates(ctx, bound.binding.companyId)).filter((t) =>
    usableBy(t, bound.member, bound.binding.userId, bound.site?._id ?? null),
  )
  return rows.sort((a, b) => uses30(b, today).uses - uses30(a, today).uses || a.name.localeCompare(b.name))
}

/** "· C-01 to C-06", "· my cages", "· from Ama" after a template's name in the picker. */
async function hintOf(ctx: Ctx, bound: BoundMember, t: Template): Promise<string> {
  const s = rt(bound.locale)
  if (t.cages.mode === 'mine') return s.myCages
  if (t.cages.mode === 'row') {
    const units = await rowUnits(ctx, bound.binding.companyId, bound.member, t.cages.row, t.cages.siteId ?? t.siteId)
    return units.length ? cagesLabel(bound.locale, units.map((u) => u.name)) : s.rowHint(t.cages.row)
  }
  if (t.cages.mode === 'list') {
    const names: string[] = []
    for (const id of t.cages.cageIds.slice(0, 8)) {
      const u = await ctx.db.get(id)
      if (u && u.companyId === bound.binding.companyId) names.push(u.name)
    }
    return cagesLabel(bound.locale, names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
  }
  return t.ownerId === bound.binding.userId ? '' : s.fromOwner(firstName(await ctx.db.get(t.ownerId)))
}

/** /t lists the templates as buttons; "/t c" uses the one with shortcut c. */
export async function templatesCommand(ctx: MutationCtx, bound: BoundMember, arg: string, tgt: Tgt, source: Source): Promise<RoutePlan> {
  const s = rt(tgt.locale)
  const usable = await usableTemplates(ctx, bound)
  const shortcut = arg.trim().toLowerCase()
  if (shortcut) {
    const t = usable.find((x) => x.shortcut === shortcut)
    if (!t) return { type: 'reply', ...tgt, messages: [text(s.noShortcut(shortcut.slice(0, 12)))] }
    return await applyTemplate(ctx, bound, t, tgt, source)
  }
  const rows: { id: string; title: string }[][] = []
  for (const t of usable.slice(0, MAX_LISTED)) {
    const hint = await hintOf(ctx, bound, t)
    rows.push([{ id: `${TEMPLATE_VERBS.use}:${t._id}`, title: hint ? `${t.name} · ${hint}` : t.name }])
  }
  rows.push([{ id: TEMPLATE_VERBS.saveLast, title: s.saveLast }])
  const body = usable.length
    ? `<b>${escapeHtml(s.templatesTitle)}</b>\n${escapeHtml(s.templatesHint)}`
    : `<b>${escapeHtml(s.templatesTitle)}</b>\n${escapeHtml(s.noTemplates)}`
  return { type: 'reply', ...tgt, messages: [{ kind: 'keyboard', html: true, text: body, rows }] }
}

/** Template buttons: use one, save the last entry, tell the manager, remind me. Null when not ours. */
export async function templateButton(
  ctx: MutationCtx,
  bound: BoundMember,
  verb: string,
  arg: string,
  tgt: Tgt,
  source: Source,
): Promise<RoutePlan | null> {
  const s = rt(tgt.locale)
  if (verb === TEMPLATE_VERBS.saveLast) return { type: 'reply', ...tgt, messages: [text(await saveLastEntry(ctx, bound))] }
  if (verb === TEMPLATE_VERBS.use) {
    const id = ctx.db.normalizeId('botTemplates', arg)
    const t = id ? await ctx.db.get(id) : null
    if (!t || t.companyId !== bound.binding.companyId || !usableBy(t, bound.member, bound.binding.userId, bound.site?._id ?? null)) {
      return { type: 'reply', ...tgt, messages: [text(s.templateGone)] }
    }
    return await applyTemplate(ctx, bound, t, tgt, source)
  }
  if (verb === GROUP_VERBS.tell) return { type: 'reply', ...tgt, messages: [text(await tellManager(ctx, bound, arg))] }
  if (verb === GROUP_VERBS.remind) return { type: 'reply', ...tgt, messages: [text(await remindMe(ctx, bound, arg))] }
  return null
}

async function applyTemplate(ctx: MutationCtx, bound: BoundMember, t: Template, tgt: Tgt, source: Source): Promise<RoutePlan> {
  const s = rt(tgt.locale)
  if (!can(bound.member, permissionFor(t.kind))) return { type: 'reply', ...tgt, messages: [text(s.noPermission)] }
  const today = todayIn(zoneFor(bound.site, bound.company), source.sentAt)

  if (t.kind === 'feed_issue') {
    const feed = t.feedTypeId ? await ctx.db.get(t.feedTypeId) : null
    if (!feed || feed.companyId !== bound.binding.companyId || feed.deletedAt || !t.quantityKg) {
      return { type: 'reply', ...tgt, messages: [text(s.templateGone)] }
    }
    const p = await proposeFor(ctx, bound, { kind: 'feed_issue', feedType: feed.name, quantityKg: t.quantityKg }, {
      sourceMessageId: source.sourceMessageId,
      eventTime: source.sentAt,
    })
    if (!p.ok) return { type: 'reply', ...tgt, messages: [text(p.error)] }
    const groupId = await newGroup(ctx, bound, { kind: 'template', date: today, templateId: t._id })
    await ctx.db.patch(p.pendingId, { draftGroup: groupKey(groupId) })
    await bumpUsage(ctx, t, today, 1)
    return await groupReply(ctx, bound, groupId, tgt)
  }

  const units = await templateUnits(ctx, bound, t, today)
  if (!units.length) return { type: 'reply', ...tgt, messages: [text(s.noCagesToday)] }

  if (t.kind === 'water_check') {
    await ctx.db.patch(bound.binding._id, {
      awaitingTemplate: { templateId: t._id, cageIds: units.map((u) => u._id), until: Date.now() + AWAIT_MS },
    })
    const names = units.map((u) => u.name)
    const example = names[Math.min(2, names.length - 1)]
    return {
      type: 'reply',
      ...tgt,
      messages: [text(`${s.waterPrompt(names.length <= 6 ? names.join(', ') : cagesLabel(tgt.locale, names))}\n${s.waterExample(example)}`)],
    }
  }

  // Daily entries: one draft per cage, plan kg or yesterday's feed, dead fish "not said".
  const groupId = await newGroup(ctx, bound, { kind: 'template', date: today, templateId: t._id })
  const tables = t.kind === 'daily_plan' ? await tablesFor(ctx, bound.binding.companyId) : null
  const leftOut: string[] = []
  let made = 0
  for (const u of units) {
    const date = await farmDate(ctx, bound, u.locationId, source.sentAt)
    const logged = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) => q.eq('cageId', u._id).eq('date', date))
      .first()
    if (logged) {
      leftOut.push(s.leftLogged(u.name))
      continue
    }
    let feedKg: number | null = null
    let feedType: string | undefined
    if (tables) {
      const r = (await cageRation(ctx, u, tables)).ration
      feedKg = r.ok ? round(r.kgPerDay, 1) : null
      if (feedKg == null) leftOut.push(s.leftNoPlan(u.name))
    } else {
      const prev = await ctx.db
        .query('dailyRecords')
        .withIndex('by_cage_date', (q) => q.eq('cageId', u._id).eq('date', addDays(date, -1)))
        .first()
      feedKg = prev && prev.feedAmount > 0 ? prev.feedAmount : null
      const ft = prev?.feedTypeId ? await ctx.db.get(prev.feedTypeId) : null
      feedType = ft && ft.companyId === bound.binding.companyId ? ft.name : undefined
      if (feedKg == null) leftOut.push(s.leftNoYesterday(u.name))
    }
    if (feedKg == null) continue
    const p = await proposeFor(ctx, bound, { kind: 'daily_entry', unit: u.name, cageId: u._id, feedKg, feedType }, {
      sourceMessageId: source.sourceMessageId,
      eventTime: source.sentAt,
    })
    if (!p.ok) {
      leftOut.push(`${u.name} (${p.error.slice(0, 80)})`)
      continue
    }
    await ctx.db.patch(p.pendingId, { draftGroup: groupKey(groupId), notSaid: ['mortality'] })
    made++
  }
  if (!made) {
    await ctx.db.patch(groupId, { status: 'closed' })
    return { type: 'reply', ...tgt, messages: [text([s.nothingFilled, ...(leftOut.length ? [s.leftOut(leftOut)] : [])].join('\n'))] }
  }
  await bumpUsage(ctx, t, today, made)
  return await groupReply(ctx, bound, groupId, tgt, { leftOut })
}

async function groupReply(
  ctx: MutationCtx,
  bound: BoundMember,
  groupId: Id<'botDraftGroups'>,
  tgt: Tgt,
  x: { leftOut?: string[] } = {},
): Promise<RoutePlan> {
  const group = (await ctx.db.get(groupId))!
  const extras = group.low?.length
    ? { ...x, managerName: (await managerFor(ctx, bound, group))?.name ?? null, remindLabel: remindSlot(bound, Date.now()).label }
    : x
  const msg = groupMessage(tgt.locale, group, await groupDrafts(ctx, group), extras)
  return { type: 'reply', ...tgt, messages: msg ? [msg] : [] }
}

// ---------------------------------------------------------------------------
// Water check: one line of readings

const NUM = /^\d{1,2}(?:[.,]\d{1,2})?$/
const ALL_WORDS = new Set(['all', 'tout', 'toutes', 'tous'])

/**
 * "5.6 28 all, A-05 3.8 29": one DO / temperature pair for every cage, and
 * pairs for named cages. Null when a part cannot be read.
 */
export function parseReadings(line: string, names: string[]): { all: [number, number] | null; per: Map<number, [number, number]> } | null {
  const per = new Map<number, [number, number]>()
  let all: [number, number] | null = null
  const keys = names.map(unitKey)
  for (const seg of line.split(/[;\n]+|,\s+/)) {
    const tokens = seg.trim().split(/\s+/).filter((x) => x && !ALL_WORDS.has(x.toLowerCase()))
    if (!tokens.length) continue
    const nums = tokens.filter((x) => NUM.test(x)).map((x) => Number(x.replace(',', '.')))
    const rest = tokens.filter((x) => !NUM.test(x)).join(' ')
    if (nums.length !== 2) return null
    const pair: [number, number] = [nums[0], nums[1]]
    if (!rest) {
      all = pair
      continue
    }
    const idx = keys.indexOf(unitKey(rest))
    if (idx < 0) return null
    per.set(idx, pair)
  }
  return all || per.size ? { all, per } : null
}

/**
 * The text after a water-check template: readings become water drafts, or
 * a hint. CANCEL stops; a message without digits stops and goes on as usual
 * (null). Null too when no template is waiting.
 */
export async function awaitingInput(ctx: MutationCtx, bound: BoundMember, msgText: string, tgt: Tgt, source: Source): Promise<RoutePlan | null> {
  const w = bound.binding.awaitingTemplate
  if (!w) return null
  const s = rt(tgt.locale)
  const stop = async () => ctx.db.patch(bound.binding._id, { awaitingTemplate: undefined })
  if (w.until < Date.now()) {
    await stop()
    return null
  }
  if (/^\/?(cancel|annuler|stop)$/i.test(msgText.trim())) {
    await stop()
    return { type: 'reply', ...tgt, messages: [text(s.waterStopped)] }
  }
  if (!/\d/.test(msgText)) {
    await stop()
    return null
  }
  const t = await ctx.db.get(w.templateId)
  if (!t || t.companyId !== bound.binding.companyId || !usableBy(t, bound.member, bound.binding.userId, bound.site?._id ?? null)) {
    await stop()
    return { type: 'reply', ...tgt, messages: [text(s.templateGone)] }
  }
  const units: Doc<'cages'>[] = []
  for (const id of w.cageIds.slice(0, MAX_TEMPLATE_CAGES)) {
    const u = await ctx.db.get(id)
    if (u && u.companyId === bound.binding.companyId && !u.archivedAt && inScope(bound, u.locationId)) units.push(u)
  }
  const parsed = parseReadings(msgText.slice(0, 500), units.map((u) => u.name))
  const valid = (p: [number, number]) => p[0] >= 0 && p[0] <= 30 && p[1] >= 0 && p[1] <= 45
  if (!parsed || (parsed.all && !valid(parsed.all)) || [...parsed.per.values()].some((p) => !valid(p))) {
    return { type: 'reply', ...tgt, messages: [text(s.waterBad)] }
  }
  await stop()
  const today = todayIn(zoneFor(bound.site, bound.company), source.sentAt)
  const groupId = await newGroup(ctx, bound, { kind: 'template', date: today, templateId: t._id })
  const overrides = await overridesFor(ctx, bound.binding.companyId)
  const low: { cageName: string; value: number; limit: number }[] = []
  const leftOut: string[] = []
  const now = Date.now()
  let made = 0
  for (const [i, u] of units.entries()) {
    const pair = parsed.per.get(i) ?? parsed.all
    if (!pair) {
      leftOut.push(s.leftNoReading(u.name))
      continue
    }
    const [dissolvedOxygen, temperatureC] = pair
    const date = await farmDate(ctx, bound, u.locationId, source.sentAt)
    const min = effectiveThresholds(unitTypeOf(u), overrides).dissolvedOxygen?.min
    if (min != null && dissolvedOxygen < min) low.push({ cageName: u.name, value: dissolvedOxygen, limit: min })
    await ctx.db.insert('pendingBotActions', {
      bindingId: bound.binding._id,
      userId: bound.binding.userId,
      companyId: bound.binding.companyId,
      siteId: u.locationId,
      provider: bound.binding.provider,
      payload: { kind: 'water_reading', cageId: u._id, cageName: u.name, dissolvedOxygen, temperatureC },
      date,
      eventTime: source.sentAt,
      sourceMessageId: source.sourceMessageId,
      summary: `${u.name}: DO ${dissolvedOxygen} mg/L, ${temperatureC} °C`,
      fingerprint: `water|${u._id}|${date}|${dissolvedOxygen}|${temperatureC}`,
      status: 'pending',
      createdAt: now,
      expiresAt: now + DRAFT_TTL_MS,
      draftGroup: groupKey(groupId),
    })
    made++
  }
  if (low.length) await ctx.db.patch(groupId, { low: low.slice(0, MAX_TEMPLATE_CAGES) })
  await bumpUsage(ctx, t, today, made)
  return await groupReply(ctx, bound, groupId, tgt, { leftOut })
}

// ---------------------------------------------------------------------------
// Tell manager / Remind me (water check with a low DO)

/**
 * The manager to tell about a cage: who assigned its keeper, else the first
 * member at its site who manages keepers; never the user themself.
 */
async function managerFor(ctx: Ctx, bound: BoundMember, group: Doc<'botDraftGroups'>) {
  const first = group.low?.[0]
  if (!first) return null
  const drafts = await groupDrafts(ctx, group)
  const p = drafts.map((d) => d.payload).find((x) => x.kind === 'water_reading' && x.cageName === first.cageName)
  const unit = p && p.kind === 'water_reading' ? await ctx.db.get(p.cageId) : null
  if (!unit || unit.companyId !== bound.binding.companyId) return null
  const companyId = bound.binding.companyId
  const me = bound.binding.userId
  const candidates: Id<'users'>[] = []
  const assignment = await ctx.db
    .query('cageKeepers')
    .withIndex('by_unitId_and_active', (q) => q.eq('unitId', unit._id).eq('active', true))
    .first()
  if (assignment && assignment.companyId === companyId) candidates.push(assignment.assignedBy)
  const members = await ctx.db
    .query('memberships')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .take(300)
  for (const m of members) if (m.status === 'active' && reachesSite(m, unit.locationId)) candidates.push(m.userId)
  const seen = new Set<string>()
  for (const id of candidates.slice(0, 60)) {
    if (id === me || seen.has(id)) continue
    seen.add(id)
    const user = await ctx.db.get(id)
    if (!user || user.active === false || user.deletedAt) continue
    const mc = await memberContextIn(ctx, user, companyId)
    if (mc && can(mc, 'production.keepers.manage') && (mc.siteScope === 'all' || (!!unit.locationId && mc.siteScope.has(unit.locationId)))) {
      return { user, name: firstName(user), unit }
    }
  }
  return null
}

const hhmmOf = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

/** One hour from now, on the quarter hour, in the chat's site time: "16:00". */
function remindSlot(bound: BoundMember, now: number) {
  const tz = zoneFor(bound.site, bound.company)
  const at = now + 60 * 60 * 1000
  const local = minutesIn(tz, at)
  const back = local % 15
  return { at: at - back * 60 * 1000, label: hhmmOf(local - back) }
}

async function tellManager(ctx: MutationCtx, bound: BoundMember, arg: string): Promise<string> {
  const s = rt(bound.locale)
  const group = await loadGroup(ctx, bound, arg)
  if (!group?.low?.length) return s.groupClosed
  const mgr = await managerFor(ctx, bound, group)
  if (!mgr) return s.noManager
  if (group.toldAt) return s.alreadyTold(mgr.name)
  const cages = group.low.map((l) => l.cageName)
  await notifyUsers(ctx, {
    companyId: bound.binding.companyId,
    users: [mgr.user],
    channels: ['in_app', 'whatsapp'],
    level: 'warning',
    title: s.lowDoTitle(cages),
    message: s.lowDoBody(group.low.map((l) => `${l.cageName}: DO ${l.value} mg/L (min ${l.limit})`), personName(bound.account)),
    link: `/cages/${mgr.unit._id}`,
    source: 'bot.low_do',
    dedupeKey: `bot-low-do:${group._id}`,
  })
  await ctx.db.patch(group._id, { toldAt: Date.now() })
  return s.told(mgr.name)
}

async function remindMe(ctx: MutationCtx, bound: BoundMember, arg: string): Promise<string> {
  const s = rt(bound.locale)
  const group = await loadGroup(ctx, bound, arg)
  if (!group?.low?.length) return s.groupClosed
  const slot = remindSlot(bound, Date.now())
  if (group.remindAt) return s.alreadyReminded(hhmmOf(minutesIn(zoneFor(bound.site, bound.company), group.remindAt)))
  await ctx.db.patch(group._id, { remindAt: slot.at })
  await ctx.scheduler.runAt(slot.at, internal.bot.templates.sendReminder, { groupId: group._id })
  return s.reminded(slot.label)
}

export const reminderFor = internalQuery({
  args: { groupId: v.id('botDraftGroups') },
  returns: v.union(
    v.null(),
    v.object({
      provider: v.union(v.literal('whatsapp'), v.literal('telegram')),
      address: v.string(),
      companyId: v.id('companies'),
      bindingId: v.id('channelBindings'),
      locale: v.union(v.literal('en'), v.literal('fr')),
      text: v.string(),
    }),
  ),
  handler: async (ctx, { groupId }) => {
    const group = await ctx.db.get(groupId)
    const binding = group ? await ctx.db.get(group.bindingId) : null
    if (!group?.low?.length || !binding) return null
    const checked = await checkBinding(ctx, binding)
    if (!checked.ok) return null
    return {
      provider: binding.provider,
      address: binding.address,
      companyId: binding.companyId,
      bindingId: binding._id,
      locale: checked.bound.locale,
      text: rt(checked.bound.locale).reminderText(group.low.map((l) => l.cageName)),
    }
  },
})

export const sendReminder = internalAction({
  args: { groupId: v.id('botDraftGroups') },
  returns: v.null(),
  handler: async (ctx, { groupId }) => {
    const r = await ctx.runQuery(internal.bot.templates.reminderFor, { groupId })
    if (!r) return null
    await deliver(ctx, r, [{ kind: 'text', text: r.text }])
    return null
  },
})

// ---------------------------------------------------------------------------
// "Save my last entry as a template"

async function saveLastEntry(ctx: MutationCtx, bound: BoundMember): Promise<string> {
  const s = rt(bound.locale)
  const last = await ctx.db
    .query('pendingBotActions')
    .withIndex('by_bindingId_and_status', (q) => q.eq('bindingId', bound.binding._id).eq('status', 'committed'))
    .order('desc')
    .first()
  if (!last) return s.noLastEntry
  const siblings = last.draftGroup?.startsWith('chat:')
    ? (
        await ctx.db
          .query('pendingBotActions')
          .withIndex('by_userId_and_draftGroup', (q) => q.eq('userId', last.userId).eq('draftGroup', last.draftGroup))
          .take(MAX_TEMPLATE_CAGES + 5)
      ).filter((d) => d.status === 'committed' && d.bindingId === bound.binding._id && d.payload.kind === last.payload.kind)
    : [last]
  const p = last.payload
  const own = (await companyTemplates(ctx, bound.binding.companyId)).filter((t) => t.ownerId === bound.binding.userId)
  if (own.length >= MAX_PERSONAL) return s.tooManyTemplates
  const base = {
    companyId: bound.binding.companyId,
    ownerId: bound.binding.userId,
    scope: 'personal' as const,
    usage: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: bound.binding.userId,
  }
  const cageIds = [
    ...new Set(
      siblings
        .map((d) => d.payload)
        .map((x) => (x.kind === 'daily_entry' || x.kind === 'water_reading' ? x.cageId : null))
        .filter((x): x is Id<'cages'> => !!x),
    ),
  ].slice(0, MAX_TEMPLATE_CAGES)
  const names = siblings
    .map((d) => d.payload)
    .map((x) => (x.kind === 'daily_entry' || x.kind === 'water_reading' ? x.cageName : ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  let name: string
  if (p.kind === 'daily_entry') {
    name = s.nameDaily(cagesLabel(bound.locale, names))
    await ctx.db.insert('botTemplates', { ...base, name: name.slice(0, 60), kind: 'daily_same', cages: { mode: 'list', cageIds } })
  } else if (p.kind === 'water_reading') {
    name = s.nameWater(cagesLabel(bound.locale, names))
    await ctx.db.insert('botTemplates', { ...base, name: name.slice(0, 60), kind: 'water_check', cages: { mode: 'list', cageIds } })
  } else if (p.kind === 'feed_issue') {
    if (!can(bound.member, 'inventory.issue')) return s.noPermission
    name = s.nameIssue(p.quantityKg, p.feedTypeName)
    await ctx.db.insert('botTemplates', {
      ...base,
      name: name.slice(0, 60),
      kind: 'feed_issue',
      cages: { mode: 'none' },
      feedTypeId: p.feedTypeId,
      quantityKg: p.quantityKg,
    })
  } else {
    return s.noLastEntry
  }
  return s.savedTemplate(name.slice(0, 60))
}

// ---------------------------------------------------------------------------
// Web: Settings › Messaging › Bot templates (T2b)

const cagesValue = templateCages
type CagesValue = Infer<typeof templateCages>

const templateRow = v.object({
  id: v.id('botTemplates'),
  name: v.string(),
  kind: templateKind,
  shortcut: v.union(v.string(), v.null()),
  scope: v.union(v.literal('personal'), v.literal('site')),
  siteId: v.union(v.id('farmLocations'), v.null()),
  siteName: v.union(v.string(), v.null()),
  ownerName: v.string(),
  mine: v.boolean(),
  cages: cagesValue,
  /** "C-01 to C-06", "Row C", "my cages": what the template covers. */
  cagesText: v.string(),
  cageCount: v.union(v.number(), v.null()),
  /** Members at the shared site (who can use it). */
  siteMembers: v.union(v.number(), v.null()),
  feedTypeId: v.union(v.id('feedTypes'), v.null()),
  feedTypeName: v.union(v.string(), v.null()),
  quantityKg: v.union(v.number(), v.null()),
  uses30: v.number(),
  canEdit: v.boolean(),
  canShare: v.boolean(),
  updatedAt: v.number(),
})

/** Templates the caller can see, sorted by use, with the editor's choices (sites, rows, cages, feeds). */
export const list = query({
  args: { now: v.number() },
  returns: v.object({
    canManage: v.boolean(),
    canIssue: v.boolean(),
    templates: v.array(templateRow),
    totals: v.object({ count: v.number(), uses30: v.number(), minutesSaved: v.number() }),
    sites: v.array(v.object({ id: v.id('farmLocations'), name: v.string() })),
    rows: v.array(v.object({ siteId: v.union(v.id('farmLocations'), v.null()), row: v.string(), cages: v.array(v.string()) })),
    cages: v.array(v.object({ id: v.id('cages'), name: v.string(), siteId: v.union(v.id('farmLocations'), v.null()) })),
    feedTypes: v.array(v.object({ id: v.id('feedTypes'), name: v.string(), bagKg: v.union(v.number(), v.null()) })),
  }),
  handler: async (ctx, { now }) => {
    const m = await requireMember(ctx, { permission: 'production.daily.record' })
    const empty = { canManage: false, canIssue: false, templates: [], totals: { count: 0, uses30: 0, minutesSaved: 0 }, sites: [], rows: [], cages: [], feedTypes: [] }
    if (!m.companyId) return empty
    const companyId = m.companyId
    const company = await ctx.db.get(companyId)
    const today = todayIn(orgProfile(company).timezone, now)
    const manager = can(m, 'production.keepers.manage')
    const all = await companyTemplates(ctx, companyId)
    const visible = all.filter((t) =>
      t.scope === 'personal'
        ? t.ownerId === m.user._id || manager
        : !!t.siteId && (m.siteScope === 'all' || m.siteScope.has(t.siteId)),
    )
    const siteRows = (
      await ctx.db
        .query('farmLocations')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(200)
    ).filter((x) => x.active !== false && (m.siteScope === 'all' || m.siteScope.has(x._id)))
    const siteName = new Map(siteRows.map((x) => [x._id as string, x.name]))
    const units = (
      await ctx.db
        .query('cages')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(MAX_UNITS_READ)
    )
      .filter((u) => !u.archivedAt && (m.siteScope === 'all' || (!!u.locationId && m.siteScope.has(u.locationId))))
      .sort(byUnitName)
    const unitName = new Map(units.map((u) => [u._id as string, u.name]))
    const rowMap = new Map<string, { siteId: Id<'farmLocations'> | null; row: string; cages: string[] }>()
    for (const u of units) {
      if (!needsDailyLog(u)) continue
      const row = rowOf(u)
      if (!row) continue
      const key = `${u.locationId ?? ''}|${row.toUpperCase()}`
      const entry = rowMap.get(key) ?? { siteId: u.locationId ?? null, row, cages: [] }
      entry.cages.push(u.name)
      rowMap.set(key, entry)
    }
    const memberCount = new Map<string, number>()
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(1000)
    for (const site of siteRows) {
      memberCount.set(site._id, memberships.filter((x) => x.status === 'active' && reachesSite(x, site._id)).length)
    }
    const feeds = (
      await ctx.db
        .query('feedTypes')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(200)
    ).filter((f) => !f.deletedAt)
    const feedName = new Map(feeds.map((f) => [f._id as string, f.name]))
    const owners = new Map<string, string>()
    const rows = []
    let uses = 0
    let entries = 0
    for (const t of visible) {
      if (!owners.has(t.ownerId)) owners.set(t.ownerId, personName(await ctx.db.get(t.ownerId)))
      const u30 = uses30(t, today)
      uses += u30.uses
      entries += u30.entries
      const covered = coveredCages(t.cages, t.siteId, rowMap, unitName)
      rows.push({
        id: t._id,
        name: t.name,
        kind: t.kind,
        shortcut: t.shortcut ?? null,
        scope: t.scope,
        siteId: t.siteId ?? null,
        siteName: t.siteId ? (siteName.get(t.siteId) ?? null) : null,
        ownerName: owners.get(t.ownerId)!,
        mine: t.ownerId === m.user._id,
        cages: t.cages,
        cagesText: covered.text,
        cageCount: covered.count,
        siteMembers: t.scope === 'site' && t.siteId ? (memberCount.get(t.siteId) ?? 0) : null,
        feedTypeId: t.feedTypeId ?? null,
        feedTypeName: t.feedTypeId ? (feedName.get(t.feedTypeId) ?? null) : null,
        quantityKg: t.quantityKg ?? null,
        uses30: u30.uses,
        canEdit: editableBy(t, m),
        canShare: manager && t.scope === 'personal',
        updatedAt: t.updatedAt,
      })
    }
    rows.sort((a, b) => b.uses30 - a.uses30 || a.name.localeCompare(b.name))
    return {
      canManage: manager,
      canIssue: can(m, 'inventory.issue'),
      templates: rows,
      totals: { count: rows.length, uses30: uses, minutesSaved: Math.round((entries * SECONDS_SAVED_PER_ENTRY) / 60) },
      sites: siteRows.map((x) => ({ id: x._id, name: x.name })),
      rows: [...rowMap.values()].sort((a, b) => a.row.localeCompare(b.row, undefined, { numeric: true })).slice(0, 200),
      cages: units.filter(needsDailyLog).slice(0, MAX_UNITS_READ).map((u) => ({ id: u._id, name: u.name, siteId: u.locationId ?? null })),
      feedTypes: feeds.map((f) => ({ id: f._id, name: f.name, bagKg: f.bagSizeKg ?? null })),
    }
  },
})

function coveredCages(
  c: CagesValue,
  siteId: Id<'farmLocations'> | undefined,
  rowMap: Map<string, { cages: string[] }>,
  unitName: Map<string, string>,
): { text: string; count: number | null } {
  if (c.mode === 'none' || c.mode === 'mine') return { text: '', count: null }
  if (c.mode === 'row') {
    const site = c.siteId ?? siteId
    const hits = site
      ? (rowMap.get(`${site}|${c.row.toUpperCase()}`)?.cages ?? [])
      : [...rowMap.entries()].filter(([k]) => k.endsWith(`|${c.row.toUpperCase()}`)).flatMap(([, x]) => x.cages)
    return { text: cagesLabel('en', hits), count: hits.length }
  }
  const names = c.cageIds.map((id) => unitName.get(id)).filter((x): x is string => !!x)
  return { text: cagesLabel('en', names), count: names.length }
}

const SHORTCUT_RE = /^[a-z0-9]{1,8}$/

async function checkTemplateInput(
  ctx: MutationCtx,
  m: MemberContext,
  a: {
    name: string
    kind: Template['kind']
    shortcut?: string
    scope: 'personal' | 'site'
    siteId?: Id<'farmLocations'>
    cages: CagesValue
    feedTypeId?: Id<'feedTypes'>
    quantityKg?: number
  },
  selfId: Id<'botTemplates'> | null,
) {
  const companyId = m.companyId!
  const name = a.name.trim()
  if (!name || name.length > 60) throw userError('VALIDATION', 'Give the template a name (at most 60 characters).')
  if (!can(m, permissionFor(a.kind))) throw userError('FORBIDDEN', 'Your role cannot record what this template fills.')
  const shortcut = a.shortcut?.trim().toLowerCase().replace(/^\/t\s*/, '') || undefined
  if (shortcut && !SHORTCUT_RE.test(shortcut)) throw userError('VALIDATION', 'A shortcut is 1 to 8 letters or digits.')
  if (a.scope === 'site') {
    if (!can(m, 'production.keepers.manage')) throw userError('FORBIDDEN', 'Only a manager can share templates with a site.')
    const site = a.siteId ? await ctx.db.get(a.siteId) : null
    if (!site || site.companyId !== companyId || (m.siteScope !== 'all' && !m.siteScope.has(site._id))) {
      throw userError('NOT_FOUND', 'Site not found')
    }
  }
  const cages = a.cages
  if (a.kind === 'feed_issue') {
    const feed = a.feedTypeId ? await ctx.db.get(a.feedTypeId) : null
    if (!feed || feed.companyId !== companyId || feed.deletedAt) throw userError('NOT_FOUND', 'Feed type not found')
    if (!(a.quantityKg && a.quantityKg > 0 && a.quantityKg <= 100_000)) throw userError('VALIDATION', 'Quantity must be between 0 and 100000 kg.')
    if (cages.mode !== 'none') throw userError('VALIDATION', 'A feed issue template has no cages.')
  } else {
    if (cages.mode === 'none') throw userError('VALIDATION', 'Choose the cages this template fills.')
    if (cages.mode === 'row' && (!cages.row.trim() || cages.row.length > 40)) throw userError('VALIDATION', 'Choose a row.')
    if (cages.mode === 'row' && cages.siteId) {
      const site = await ctx.db.get(cages.siteId)
      if (!site || site.companyId !== companyId || (m.siteScope !== 'all' && !m.siteScope.has(site._id))) {
        throw userError('NOT_FOUND', 'Site not found')
      }
    }
    if (cages.mode === 'list') {
      if (!cages.cageIds.length || cages.cageIds.length > MAX_TEMPLATE_CAGES) {
        throw userError('VALIDATION', `Choose 1 to ${MAX_TEMPLATE_CAGES} cages.`)
      }
      for (const id of cages.cageIds) {
        const u = await ctx.db.get(id)
        if (!u || u.companyId !== companyId || u.archivedAt || (m.siteScope !== 'all' && (!u.locationId || !m.siteScope.has(u.locationId)))) {
          throw userError('NOT_FOUND', 'Cage not found')
        }
      }
    }
  }
  const all = await companyTemplates(ctx, companyId)
  if (shortcut && all.some((t) => t._id !== selfId && t.shortcut === shortcut)) {
    throw userError('CONFLICT', `The shortcut /t ${shortcut} is already used.`)
  }
  return {
    name,
    shortcut,
    cages: cages.mode === 'row' ? { ...cages, row: cages.row.trim() } : cages,
    all,
    feedTypeId: a.kind === 'feed_issue' ? a.feedTypeId : undefined,
    quantityKg: a.kind === 'feed_issue' ? a.quantityKg : undefined,
  }
}

async function loadOwn(ctx: Ctx, m: MemberContext, id: Id<'botTemplates'>) {
  const t = await ctx.db.get(id)
  // Another organization's template is "not found".
  if (!t || !m.companyId || t.companyId !== m.companyId) throw userError('NOT_FOUND', 'Template not found')
  return t
}

const saveArgs = {
  id: v.optional(v.id('botTemplates')),
  name: v.string(),
  kind: templateKind,
  shortcut: v.optional(v.string()),
  scope: v.union(v.literal('personal'), v.literal('site')),
  siteId: v.optional(v.id('farmLocations')),
  cages: templateCages,
  feedTypeId: v.optional(v.id('feedTypes')),
  quantityKg: v.optional(v.number()),
}

/** Create or update a template (personal: anyone who may record it; shared: managers). */
export const save = mutation({
  args: saveArgs,
  returns: v.id('botTemplates'),
  handler: async (ctx, a) => {
    const m = await requireMember(ctx, { permission: 'production.daily.record' })
    if (!m.companyId) throw userError('FORBIDDEN', 'Your account is not linked to an organization')
    const existing = a.id ? await loadOwn(ctx, m, a.id) : null
    if (existing && !editableBy(existing, m)) throw userError('FORBIDDEN', 'You cannot change this template.')
    const checked = await checkTemplateInput(ctx, m, a, existing?._id ?? null)
    const now = Date.now()
    const value = {
      name: checked.name,
      kind: a.kind,
      shortcut: checked.shortcut,
      scope: a.scope,
      siteId: a.scope === 'site' ? a.siteId : undefined,
      cages: checked.cages,
      feedTypeId: checked.feedTypeId,
      quantityKg: checked.quantityKg,
      updatedAt: now,
      updatedBy: m.user._id,
    }
    if (existing) {
      await ctx.db.patch(existing._id, value)
      await logAudit(ctx, { actionType: 'update', tableName: 'botTemplates', recordId: existing._id, previousValues: existing, newValues: value, locationId: value.siteId })
      return existing._id
    }
    if (checked.all.length >= MAX_TEMPLATES) throw userError('VALIDATION', `An organization can have at most ${MAX_TEMPLATES} templates.`)
    if (a.scope === 'personal' && checked.all.filter((t) => t.ownerId === m.user._id && t.scope === 'personal').length >= MAX_PERSONAL) {
      throw userError('VALIDATION', `You can have at most ${MAX_PERSONAL} personal templates.`)
    }
    const id = await ctx.db.insert('botTemplates', { ...value, companyId: m.companyId, ownerId: m.user._id, usage: [], createdAt: now })
    await logAudit(ctx, { actionType: 'create', tableName: 'botTemplates', recordId: id, newValues: value, locationId: value.siteId })
    return id
  },
})

/** Share a personal template with a site (managers). */
export const share = mutation({
  args: { id: v.id('botTemplates'), siteId: v.id('farmLocations') },
  returns: v.null(),
  handler: async (ctx, { id, siteId }) => {
    const m = await requireMember(ctx, { permission: 'production.keepers.manage', locationId: siteId })
    const t = await loadOwn(ctx, m, id)
    const site = await ctx.db.get(siteId)
    if (!site || site.companyId !== m.companyId) throw userError('NOT_FOUND', 'Site not found')
    if (t.scope === 'site' && t.siteId === siteId) return null
    await ctx.db.patch(t._id, { scope: 'site', siteId, updatedAt: Date.now(), updatedBy: m.user._id })
    await logAudit(ctx, { actionType: 'update', tableName: 'botTemplates', recordId: t._id, previousValues: { scope: t.scope, siteId: t.siteId }, newValues: { scope: 'site', siteId }, locationId: siteId })
    return null
  },
})

export const remove = mutation({
  args: { id: v.id('botTemplates') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const m = await requireMember(ctx, { permission: 'production.daily.record' })
    const t = await loadOwn(ctx, m, id)
    if (!editableBy(t, m)) throw userError('FORBIDDEN', 'You cannot delete this template.')
    await ctx.db.delete(t._id)
    await logAudit(ctx, { actionType: 'delete', tableName: 'botTemplates', recordId: t._id, previousValues: t, locationId: t.siteId })
    return null
  },
})
