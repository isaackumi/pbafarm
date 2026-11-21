/**
 * Morning round card (Paper T1a / T1b, Telegram).
 *
 * At the start of each keeper's shift (per site, default 06:00 site time,
 * held while the keeper's quiet hours last) the bot sends one message: the
 * keeper's cages today (cage keepers: own units and covers) with today's
 * ration from the feeding plan (PROD-015) and yesterday's numbers,
 * exceptions first (deaths yesterday, sampling due). Each cage has inline
 * buttons Fed as planned / Same as yesterday / Edit, and the card ends with
 * "Log all N as planned · X kg".
 *
 * A tap only marks the cage on the round row and the card is edited in
 * place (editMessageText; a card that can no longer be edited is sent
 * again). "Log all" turns the card into one draft group (groups.ts): the
 * user checks it ("Please check before I save") and Save all commits each
 * draft through pending.commit, the same path and rules as the web form.
 *
 * Telegram only: WhatsApp has no editable messages and at most 3 reply
 * buttons, so the card is not sent there (the 17:00 reminder still is).
 *
 * Reads are bounded for a 1,000-cage farm: a keeper's units are capped
 * (MAX_SCAN looked at, MAX_ROUND_CAGES shown), each cage reads a handful of
 * indexed rows, and the cron fans out one small transaction per chat.
 */
import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery, mutation, query } from '../_generated/server'
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { can, requireMember } from '../lib/permissions'
import { userError } from '../lib/errors'
import { addDays, todayIn, zoneFor } from '../lib/dates'
import { round } from '../lib/kpi'
import { logAudit } from '../lib/tenancy'
import { inQuietHours } from '../automation/schedule'
import { companyZone, prefsFor } from '../automation/engine'
import { cageRation, tablesFor } from '../feedingPlans'
import { ownUnitIds, minutesIn } from '../keepers/escalation'
import { byUnitName, hhmmToMinutes, isHhmm, needsDailyLog } from '../keepers/model'
import { editTelegramChat, escapeHtml, sendTelegramChat } from '../messaging/providers/telegramBot'
import { checkBinding, inScope, type BoundMember } from './scope'
import { proposeFor } from './pending'
import { closeGroup, groupKey, groupMessageFor, kgText, newGroup } from './groups'
import { telegramBotToken } from './outbound'
import { rt } from './roundI18n'
import type { BotLocale } from './i18n'
import type { ChatMessageValue, RoutePlan, Target } from './validators'
import type { Infer } from 'convex/values'
import type { roundCage } from './tables'

/** Cages shown with buttons on one card (4 buttons each + Log all stays under Telegram's 100). */
export const MAX_ROUND_CAGES = 24
/** A keeper's units looked at to pick the exceptions. */
export const MAX_SCAN = 60
/** Deaths yesterday from which a cage is an exception. */
export const DEAD_FLAG = 2
const SAMPLE_EVERY_DAYS = 14
/** A round is sent from its time until this many minutes later (the cron runs every 15). */
const SEND_SPAN_MIN = 180
export const DEFAULT_ROUND_TIME = '06:00'
const COMPANY_PAGE = 50
const MAX_SITES = 200
const MAX_BINDINGS = 1000

export const ROUND_VERBS = { plan: 'rp', same: 'rs', edit: 're', unmark: 'ru', all: 'ra', noop: 'rn' } as const

type RoundCage = Infer<typeof roundCage>
type Ctx = QueryCtx | MutationCtx

const text = (m: string): ChatMessageValue => ({ kind: 'text', text: m })

export async function roundSettings(ctx: Ctx, locationId: Id<'farmLocations'> | undefined) {
  const row = locationId
    ? await ctx.db
        .query('botRoundSettings')
        .withIndex('by_locationId', (q) => q.eq('locationId', locationId))
        .first()
    : null
  return { enabled: row?.enabled ?? true, time: row?.time ?? DEFAULT_ROUND_TIME, feedTimes: row?.feedTimes ?? [] }
}

/** The keeper's units to log today (own and covered), stocked, in scope, by name; at most MAX_SCAN. */
async function keeperUnits(ctx: Ctx, bound: BoundMember, date: string): Promise<{ units: Doc<'cages'>[]; total: number } | null> {
  const own = await ownUnitIds(ctx, bound.binding.companyId, bound.binding.userId, date)
  if (!own) return null
  const units: Doc<'cages'>[] = []
  for (const raw of [...own].slice(0, 500)) {
    const id = ctx.db.normalizeId('cages', raw)
    const u = id ? await ctx.db.get(id) : null
    if (!u || u.companyId !== bound.binding.companyId || u.archivedAt || !needsDailyLog(u) || !inScope(bound, u.locationId)) continue
    units.push(u)
  }
  return { units: units.sort(byUnitName).slice(0, MAX_SCAN), total: units.length }
}

async function cageFacts(ctx: Ctx, u: Doc<'cages'>, date: string, tables: Awaited<ReturnType<typeof tablesFor>>): Promise<RoundCage> {
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
  const r = (await cageRation(ctx, u, tables)).ration
  return {
    cageId: u._id,
    name: u.name,
    planKg: r.ok ? round(r.kgPerDay, 1) : null,
    pelletMm: r.ok ? r.pelletMm : null,
    feedings: r.ok ? r.feedingsPerDay : null,
    yesterdayKg: prev ? prev.feedAmount : null,
    yesterdayDead: prev ? prev.mortality : null,
    sampleDue: !!since && addDays(since, SAMPLE_EVERY_DAYS) <= date,
  }
}

const isException = (c: RoundCage) => (c.yesterdayDead ?? 0) >= DEAD_FLAG || c.sampleDue

/** Exceptions first (most deaths, then sampling due), then by name. */
export function orderCages(cages: RoundCage[]): RoundCage[] {
  return [...cages].sort((a, b) => {
    const ea = isException(a) ? 1 : 0
    const eb = isException(b) ? 1 : 0
    if (ea !== eb) return eb - ea
    const da = (a.yesterdayDead ?? 0) >= DEAD_FLAG ? (a.yesterdayDead ?? 0) : 0
    const db = (b.yesterdayDead ?? 0) >= DEAD_FLAG ? (b.yesterdayDead ?? 0) : 0
    if (da !== db) return db - da
    if (a.sampleDue !== b.sampleDue) return a.sampleDue ? -1 : 1
    return byUnitName(a, b)
  })
}

/** The round's site and farm date: the keeper's first unit's site, in its time zone. */
function siteDate(bound: BoundMember, site: Doc<'farmLocations'> | null, now: number) {
  return todayIn(zoneFor(site, bound.company), now)
}

/**
 * Today's round row for a chat, made if missing. Null when the keeper has
 * no units to log. `now` comes from the caller (cron or message time).
 */
export async function ensureRound(ctx: MutationCtx, bound: BoundMember, now: number): Promise<Doc<'botRounds'> | null> {
  const roughDate = todayIn(zoneFor(bound.site, bound.company), now)
  const mine = await keeperUnits(ctx, bound, roughDate)
  const units = mine?.units ?? []
  if (!units.length) return null
  const site = units[0].locationId ? await ctx.db.get(units[0].locationId) : null
  const date = siteDate(bound, site, now)
  const existing = await ctx.db
    .query('botRounds')
    .withIndex('by_bindingId_and_date', (q) => q.eq('bindingId', bound.binding._id).eq('date', date))
    .first()
  if (existing) return existing
  const tables = await tablesFor(ctx, bound.binding.companyId)
  const facts: RoundCage[] = []
  for (const u of units) facts.push(await cageFacts(ctx, u, date, tables))
  const cages = orderCages(facts).slice(0, MAX_ROUND_CAGES)
  const settings = await roundSettings(ctx, site?._id)
  const id = await ctx.db.insert('botRounds', {
    companyId: bound.binding.companyId,
    bindingId: bound.binding._id,
    userId: bound.binding.userId,
    provider: bound.binding.provider,
    siteId: site?._id,
    date,
    status: 'queued',
    cages,
    more: Math.max(0, (mine?.total ?? 0) - cages.length),
    ...(settings.feedTimes.length ? { feedTimes: settings.feedTimes } : {}),
    version: 1,
    createdAt: now,
  })
  return (await ctx.db.get(id))!
}

// ---------------------------------------------------------------------------
// Rendering

const pad = (s: string, n: number) => (s.length >= n ? `${s} ` : s + ' '.repeat(n - s.length))

function mostCommon(xs: number[]): number | null {
  if (!xs.length) return null
  const counts = new Map<number, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
}

/**
 * The card for a round: text (Telegram HTML) and the inline keyboard.
 * `logged` maps a cage to today's saved feed kg.
 */
export function roundMessage(locale: BotLocale, r: Pick<Doc<'botRounds'>, '_id' | 'cages' | 'more' | 'feedTimes'>, logged: Map<string, number>): ChatMessageValue {
  const s = rt(locale)
  const esc = escapeHtml
  const cages = r.cages
  const done = (c: RoundCage) => logged.has(c.cageId)
  const marked = cages.filter((c) => !done(c) && c.mark)
  const open = cages.filter((c) => !done(c) && !c.mark)
  const touched = cages.some((c) => c.mark || done(c))
  const lines = [`<b>${esc(s.roundTitle(cages.length))}</b>`]
  if (!open.length && !marked.length) {
    lines.push(esc(s.allLogged(cages.length)))
  } else if (!touched) {
    const planned = cages.filter((c) => c.planKg != null)
    if (planned.length) {
      const kg = planned.reduce((a, c) => a + (c.planKg ?? 0), 0)
      lines.push(esc(s.planLine(kgText(kg), mostCommon(planned.map((c) => c.feedings ?? 0).filter((x) => x > 0)), r.feedTimes ?? [])))
    } else {
      lines.push(esc(s.noPlanLine))
    }
    const dead = cages.filter((c) => (c.yesterdayDead ?? 0) >= DEAD_FLAG).map((c) => s.lostFish(c.name, c.yesterdayDead ?? 0))
    const due = cages.filter((c) => c.sampleDue).map((c) => c.name)
    const flags = [...dead, ...(due.length ? [s.samplingDue(due)] : [])]
    // Telegram cannot colour text: a leading marker stands for the amber box.
    if (flags.length) lines.push(`⚠ ${esc(flags.join(' '))}`)
    const planCell = (c: RoundCage) => (c.planKg != null ? s.planCell(kgText(c.planKg), c.pelletMm) : s.noPlanCell)
    const yCell = (c: RoundCage) => (c.yesterdayKg != null ? s.yesterdayCell(kgText(c.yesterdayKg), c.yesterdayDead ?? 0) : s.notLoggedCell)
    const w1 = Math.max(s.colCage.length, ...cages.map((c) => c.name.length)) + 2
    const w2 = Math.max(s.colPlan.length, ...cages.map((c) => planCell(c).length)) + 2
    const table = [
      pad(s.colCage, w1) + pad(s.colPlan, w2) + s.colYesterday,
      ...cages.map((c) => pad(c.name, w1) + pad(planCell(c), w2) + yCell(c)),
    ]
    lines.push(`<pre>${esc(table.join('\n'))}</pre>`)
  } else {
    lines.push(esc(s.progressLine(marked.length + cages.filter(done).length, open.length)))
  }
  if (r.more) lines.push(esc(s.more(r.more)))

  const rows: { id: string; title: string }[][] = []
  cages.forEach((c, i) => {
    const at = `${r._id}:${i}`
    if (done(c)) {
      rows.push([{ id: ROUND_VERBS.noop, title: `✓ ${s.loggedRow(c.name, kgText(logged.get(c.cageId) ?? 0))}` }])
    } else if (c.mark) {
      const kg = kgText(c.markKg ?? 0)
      rows.push([{ id: `${ROUND_VERBS.unmark}:${at}`, title: `✓ ${c.mark === 'plan' ? s.markedPlan(c.name, kg) : s.markedSame(c.name, kg)}` }])
    } else {
      rows.push([
        { id: ROUND_VERBS.noop, title: c.name },
        { id: `${ROUND_VERBS.plan}:${at}`, title: s.fedAsPlanned },
        { id: `${ROUND_VERBS.same}:${at}`, title: s.sameAsYesterday },
        { id: `${ROUND_VERBS.edit}:${at}`, title: s.edit },
      ])
    }
  })
  if (open.length || marked.length) {
    const openKg = open.reduce((a, c) => a + (c.planKg ?? 0), 0)
    const markedKg = marked.reduce((a, c) => a + (c.markKg ?? 0), 0)
    const label = !touched
      ? s.logAll(open.length, kgText(openKg))
      : open.length
        ? s.logOther(open.length, kgText(openKg))
        : s.checkAll(marked.length, kgText(markedKg))
    rows.push([{ id: `${ROUND_VERBS.all}:${r._id}`, title: label }])
  }
  return { kind: 'keyboard', html: true, text: lines.join('\n'), rows }
}

async function loggedToday(ctx: Ctx, r: Doc<'botRounds'>): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const c of r.cages) {
    const rec = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) => q.eq('cageId', c.cageId).eq('date', r.date))
      .first()
    if (rec) out.set(c.cageId, rec.feedAmount)
  }
  return out
}

/** What the send/edit action needs: the chat, the card now, and what the chat shows. */
export const view = internalQuery({
  args: { roundId: v.id('botRounds') },
  returns: v.union(
    v.null(),
    v.object({
      chatId: v.string(),
      provider: v.union(v.literal('whatsapp'), v.literal('telegram')),
      companyId: v.id('companies'),
      bindingId: v.id('channelBindings'),
      messageId: v.union(v.number(), v.null()),
      version: v.number(),
      renderedVersion: v.union(v.number(), v.null()),
      text: v.string(),
      rows: v.array(v.array(v.object({ id: v.string(), title: v.string() }))),
    }),
  ),
  handler: async (ctx, { roundId }) => {
    const r = await ctx.db.get(roundId)
    const binding = r ? await ctx.db.get(r.bindingId) : null
    if (!r || !binding) return null
    const checked = await checkBinding(ctx, binding)
    if (!checked.ok) return null
    const msg = roundMessage(checked.bound.locale, r, await loggedToday(ctx, r))
    if (msg.kind !== 'keyboard') return null
    return {
      chatId: binding.address,
      provider: binding.provider,
      companyId: r.companyId,
      bindingId: binding._id,
      messageId: r.messageId ?? null,
      version: r.version,
      renderedVersion: r.renderedVersion ?? null,
      text: msg.text,
      rows: msg.rows,
    }
  },
})

/** Record what the chat now shows. Never moves renderedVersion back. */
export const rendered = internalMutation({
  args: {
    roundId: v.id('botRounds'),
    version: v.number(),
    messageId: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.roundId)
    if (!r) return null
    if (a.error) {
      if (r.status === 'queued') await ctx.db.patch(r._id, { status: 'failed', error: a.error.slice(0, 300) })
      return null
    }
    await ctx.db.patch(r._id, {
      status: 'sent',
      sentAt: r.sentAt ?? Date.now(),
      renderedVersion: Math.max(r.renderedVersion ?? 0, a.version),
      ...(a.messageId !== undefined ? { messageId: a.messageId } : {}),
      error: undefined,
    })
    return null
  },
})

/**
 * Show the card in the chat. With `fresh` (first send, ROUND) a new message;
 * otherwise the card message is edited in place, and sent anew when Telegram
 * says it can no longer be edited. An edit the chat already shows is skipped
 * (unless `force`), and an unchanged one is "not modified", which is done.
 */
export async function pushCard(
  ctx: ActionCtx,
  roundId: Id<'botRounds'>,
  fresh: boolean,
  /** Re-render even when no tap changed the card (entries were saved or undone). */
  force = false,
): Promise<{ ok: boolean; error?: string }> {
  const view = await ctx.runQuery(internal.bot.rounds.view, { roundId })
  if (!view || view.provider !== 'telegram') return { ok: false, error: 'not available' }
  const token = telegramBotToken()
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' }
  const message: ChatMessageValue = { kind: 'keyboard', html: true, text: view.text, rows: view.rows }
  if (!fresh && view.messageId != null) {
    if (!force && view.renderedVersion != null && view.renderedVersion >= view.version) return { ok: true }
    const edit = await editTelegramChat(token, view.chatId, view.messageId, message)
    if (edit.ok) {
      await ctx.runMutation(internal.bot.rounds.rendered, { roundId, version: view.version })
      return { ok: true }
    }
    if (!edit.gone) return { ok: false, error: edit.error }
  }
  const sent = await sendTelegramChat(token, view.chatId, message)
  if (!sent.ok) {
    await ctx.runMutation(internal.bot.rounds.rendered, { roundId, version: view.version, error: sent.error })
    return { ok: false, error: sent.error }
  }
  const id = sent.providerMessageId ? Number(sent.providerMessageId) : NaN
  await ctx.runMutation(internal.bot.rounds.rendered, {
    roundId,
    version: view.version,
    ...(Number.isFinite(id) ? { messageId: id } : {}),
  })
  return { ok: true }
}

export const send = internalAction({
  args: { roundId: v.id('botRounds') },
  returns: v.null(),
  handler: async (ctx, { roundId }) => {
    const r = await pushCard(ctx, roundId, true)
    if (!r.ok) console.warn(`[bot] round ${roundId}: ${r.error ?? 'not sent'}`)
    const view = await ctx.runQuery(internal.bot.rounds.view, { roundId })
    if (view) {
      await ctx.runMutation(internal.messaging.outbox.record, {
        companyId: view.companyId,
        channel: 'telegram',
        ok: r.ok,
        source: 'bot_reminder',
        to: view.chatId,
        bindingId: view.bindingId,
        body: view.text.replace(/<[^>]+>/g, '').slice(0, 300),
        error: r.ok ? undefined : r.error,
      })
    }
    return null
  },
})

// ---------------------------------------------------------------------------
// Scheduling

/** Every 15 minutes: queue the organizations with keepers and a Telegram chat. Pages itself. */
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
      const keeper = await ctx.db
        .query('cageKeepers')
        .withIndex('by_companyId_and_active', (q) => q.eq('companyId', c._id).eq('active', true))
        .first()
      if (!keeper) continue
      await ctx.scheduler.runAfter(0, internal.bot.rounds.company, { companyId: c._id, now: at })
      queued++
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.bot.rounds.tick, { cursor: page.continueCursor, now: at })
    return { queued, done: page.isDone }
  },
})

function inWindow(time: string, tz: string, now: number) {
  const since = minutesIn(tz, now) - hhmmToMinutes(time)
  return since >= 0 && since <= SEND_SPAN_MIN
}

/** One organization: when any site's round time is now, check each live Telegram chat in its own transaction. */
export const company = internalMutation({
  args: { companyId: v.id('companies'), now: v.number() },
  returns: v.number(),
  handler: async (ctx, { companyId, now }) => {
    const company = await ctx.db.get(companyId)
    if (!company || company.status !== 'approved') return 0
    const sites = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(MAX_SITES)
    let any = false
    for (const site of sites) {
      if (site.active === false) continue
      const st = await roundSettings(ctx, site._id)
      if (st.enabled && inWindow(st.time, zoneFor(site, company), now)) {
        any = true
        break
      }
    }
    if (!any) return 0
    const bindings = await ctx.db
      .query('channelBindings')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(MAX_BINDINGS)
    let n = 0
    for (const b of bindings) {
      if (b.revokedAt || b.provider !== 'telegram' || b.roundEnabled === false) continue
      await ctx.scheduler.runAfter(0, internal.bot.rounds.queueFor, { bindingId: b._id, now })
      n++
    }
    return n
  },
})

/** One chat: send today's round if its site's time is now, it is not quiet hours, and none was sent. */
export const queueFor = internalMutation({
  args: { bindingId: v.id('channelBindings'), now: v.number() },
  returns: v.union(v.literal('queued'), v.literal('skipped'), v.literal('quiet'), v.literal('exists')),
  handler: async (ctx, { bindingId, now }) => {
    const binding = await ctx.db.get(bindingId)
    if (!binding || binding.revokedAt || binding.provider !== 'telegram' || binding.roundEnabled === false) return 'skipped'
    const checked = await checkBinding(ctx, binding)
    if (!checked.ok || !can(checked.bound.member, 'production.daily.record')) return 'skipped'
    const bound = checked.bound
    const units = (await keeperUnits(ctx, bound, todayIn(zoneFor(bound.site, bound.company), now)))?.units ?? []
    if (!units.length) return 'skipped'
    const site = units[0].locationId ? await ctx.db.get(units[0].locationId) : null
    const st = await roundSettings(ctx, site?._id)
    if (!st.enabled || !inWindow(st.time, zoneFor(site, bound.company), now)) return 'skipped'
    const date = siteDate(bound, site, now)
    const existing = await ctx.db
      .query('botRounds')
      .withIndex('by_bindingId_and_date', (q) => q.eq('bindingId', bindingId).eq('date', date))
      .first()
    if (existing) return 'exists'
    // Quiet hours (AUTO-003, company time): held; a later tick in the window sends it.
    const { tz } = await companyZone(ctx, binding.companyId)
    if (inQuietHours((await prefsFor(ctx, binding.userId)).quietHours, now, tz)) return 'quiet'
    const r = await ensureRound(ctx, bound, now)
    if (!r) return 'skipped'
    await ctx.scheduler.runAfter(0, internal.bot.rounds.send, { roundId: r._id })
    return 'queued'
  },
})

// ---------------------------------------------------------------------------
// Chat (called from inbound.route, inside its transaction)

type Tgt = Target & { bindingId: Id<'channelBindings'> }

/** ROUND: today's card again, as a new message. ROUND ON / ROUND OFF. */
export async function roundCommand(ctx: MutationCtx, bound: BoundMember, arg: string, tgt: Tgt): Promise<RoutePlan> {
  const s = rt(tgt.locale)
  const a = arg.trim().toUpperCase()
  if (a === 'OFF') {
    await ctx.db.patch(bound.binding._id, { roundEnabled: false })
    return { type: 'reply', ...tgt, messages: [text(s.roundOff)] }
  }
  if (a === 'ON') {
    await ctx.db.patch(bound.binding._id, { roundEnabled: true })
    return { type: 'reply', ...tgt, messages: [text(s.roundOn)] }
  }
  if (bound.binding.provider !== 'telegram') return { type: 'reply', ...tgt, messages: [text(s.noRound)] }
  const r = can(bound.member, 'production.daily.record') ? await ensureRound(ctx, bound, Date.now()) : null
  if (!r) return { type: 'reply', ...tgt, messages: [text(s.noRound)] }
  return { type: 'round', ...tgt, roundId: r._id, fresh: true, messages: [] }
}

async function loggedOn(ctx: Ctx, cageId: Id<'cages'>, date: string) {
  return await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage_date', (q) => q.eq('cageId', cageId).eq('date', date))
    .first()
}

/** Round buttons; null when the verb is not a round verb. */
export async function roundButton(
  ctx: MutationCtx,
  bound: BoundMember,
  verb: string,
  arg: string,
  tgt: Tgt,
  source: { sourceMessageId: string; sentAt: number },
): Promise<RoutePlan | null> {
  const verbs = Object.values(ROUND_VERBS) as string[]
  if (!verbs.includes(verb)) return null
  if (verb === ROUND_VERBS.noop) return { type: 'reply', ...tgt, messages: [] }
  const s = rt(tgt.locale)
  const [rawId, rawIndex] = arg.split(':')
  const roundId = ctx.db.normalizeId('botRounds', rawId ?? '')
  const r = roundId ? await ctx.db.get(roundId) : null
  // Another chat's card is just "gone".
  if (!r || r.bindingId !== bound.binding._id || r.companyId !== bound.binding.companyId) {
    return { type: 'reply', ...tgt, messages: [text(s.roundGone)] }
  }
  const site = r.siteId ? await ctx.db.get(r.siteId) : null
  if (r.date !== todayIn(zoneFor(site, bound.company), Date.now())) return { type: 'reply', ...tgt, messages: [text(s.roundGone)] }
  if (!can(bound.member, 'production.daily.record')) return { type: 'reply', ...tgt, messages: [text(s.noPermission)] }
  const keep = (messages: ChatMessageValue[] = []): RoutePlan => ({ type: 'round', ...tgt, roundId: r._id, fresh: false, messages })

  if (verb === ROUND_VERBS.all) return await logAll(ctx, bound, r, tgt, source)

  const i = Number(rawIndex)
  const cage = Number.isInteger(i) ? r.cages[i] : undefined
  if (!cage) return { type: 'reply', ...tgt, messages: [text(s.roundGone)] }
  if (verb === ROUND_VERBS.edit) return { type: 'reply', ...tgt, messages: [text(s.editCage(cage.name))] }
  // Already saved today (from the app, a message or this card): just refresh the card.
  if (await loggedOn(ctx, cage.cageId, r.date)) {
    await ctx.db.patch(r._id, { version: r.version + 1 })
    return keep()
  }
  const cages = [...r.cages]
  if (verb === ROUND_VERBS.unmark) {
    cages[i] = { ...cage, mark: undefined, markKg: undefined }
  } else if (verb === ROUND_VERBS.plan) {
    if (cage.planKg == null) return { type: 'reply', ...tgt, messages: [text(s.noPlanFor(cage.name))] }
    cages[i] = { ...cage, mark: 'plan', markKg: cage.planKg }
  } else {
    if (cage.yesterdayKg == null) return { type: 'reply', ...tgt, messages: [text(s.noYesterday(cage.name))] }
    cages[i] = { ...cage, mark: 'same', markKg: cage.yesterdayKg }
  }
  await ctx.db.patch(r._id, { cages, version: r.version + 1 })
  return keep()
}

/**
 * "Log all": one draft per cage not logged yet, marked cages at their tapped
 * kg and the rest at the plan, through proposeFor (same validation as a
 * typed entry). A newer Log all closes the older group first.
 */
async function logAll(
  ctx: MutationCtx,
  bound: BoundMember,
  r: Doc<'botRounds'>,
  tgt: Tgt,
  source: { sourceMessageId: string; sentAt: number },
): Promise<RoutePlan> {
  const s = rt(tgt.locale)
  if (r.groupId) {
    const old = await ctx.db.get(r.groupId)
    if (old?.status === 'open') await closeGroup(ctx, old)
  }
  const groupId = await newGroup(ctx, bound, { kind: 'round', date: r.date, roundId: r._id })
  const leftOut: string[] = []
  let made = 0
  for (const c of r.cages) {
    if (await loggedOn(ctx, c.cageId, r.date)) continue
    const kg = c.mark ? c.markKg : c.planKg
    if (kg == null) {
      leftOut.push(s.leftNoPlan(c.name))
      continue
    }
    const p = await proposeFor(ctx, bound, { kind: 'daily_entry', unit: c.name, cageId: c.cageId, feedKg: kg }, {
      sourceMessageId: source.sourceMessageId,
      eventTime: source.sentAt,
    })
    if (!p.ok) {
      leftOut.push(`${c.name} (${p.error.slice(0, 80)})`)
      continue
    }
    await ctx.db.patch(p.pendingId, { draftGroup: groupKey(groupId), notSaid: ['mortality'] })
    made++
  }
  await ctx.db.patch(r._id, { groupId })
  const group = (await ctx.db.get(groupId))!
  if (!made) {
    await ctx.db.patch(groupId, { status: 'closed' })
    return { type: 'reply', ...tgt, messages: [text([s.nothingToLog, ...(leftOut.length ? [s.leftOut(leftOut)] : [])].join('\n'))] }
  }
  const msg = await groupMessageFor(ctx, tgt.locale, group, { leftOut })
  return { type: 'round', ...tgt, roundId: r._id, fresh: false, messages: msg ? [msg] : [] }
}

// ---------------------------------------------------------------------------
// Site settings (T9 builds the screen; managers can set it now)

const settingsRow = v.object({
  locationId: v.id('farmLocations'),
  siteName: v.string(),
  enabled: v.boolean(),
  time: v.string(),
  feedTimes: v.array(v.string()),
})

/** Round time per site in the caller's scope. */
export const siteRounds = query({
  args: {},
  returns: v.array(settingsRow),
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'production.view' })
    if (!m.companyId) return []
    const companyId = m.companyId
    const sites = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(MAX_SITES)
    const out = []
    for (const site of sites) {
      if (site.active === false || (m.siteScope !== 'all' && !m.siteScope.has(site._id))) continue
      const st = await roundSettings(ctx, site._id)
      out.push({ locationId: site._id, siteName: site.name, ...st })
    }
    return out
  },
})

/** Set a site's round: on/off, "HH:MM" site time and its feeding times. */
export const setSiteRound = mutation({
  args: {
    locationId: v.id('farmLocations'),
    enabled: v.boolean(),
    time: v.string(),
    feedTimes: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const m = await requireMember(ctx, { permission: 'production.keepers.manage', locationId: a.locationId })
    const site = await ctx.db.get(a.locationId)
    if (!site || !m.companyId || site.companyId !== m.companyId) throw userError('NOT_FOUND', 'Site not found')
    if (!isHhmm(a.time)) throw userError('VALIDATION', 'Round time must be HH:MM')
    const feedTimes = (a.feedTimes ?? []).slice(0, 6)
    if (feedTimes.some((x) => !isHhmm(x))) throw userError('VALIDATION', 'Feeding times must be HH:MM')
    const row = await ctx.db
      .query('botRoundSettings')
      .withIndex('by_locationId', (q) => q.eq('locationId', a.locationId))
      .first()
    const value = { enabled: a.enabled, time: a.time, feedTimes: [...feedTimes].sort(), updatedAt: Date.now(), updatedBy: m.user._id }
    if (row) await ctx.db.patch(row._id, value)
    else await ctx.db.insert('botRoundSettings', { companyId: m.companyId, locationId: a.locationId, ...value })
    await logAudit(ctx, {
      actionType: row ? 'update' : 'create',
      tableName: 'botRoundSettings',
      recordId: row?._id ?? a.locationId,
      newValues: { enabled: a.enabled, time: a.time, feedTimes },
      locationId: a.locationId,
    })
    return null
  },
})
