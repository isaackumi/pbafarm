/**
 * Draft groups (T1b, T2a): several chat drafts the user checks and saves
 * with one tap, made by the morning round's "Log all" or by a template.
 *
 * - Each item is an ordinary BOT-003 draft (pendingBotActions, validated by
 *   `proposeFor` or the water builder) tagged draftGroup `chat:<groupId>`.
 * - Save all commits every open draft through `pending.commit`, the same
 *   path as a single Save: binding, permission and site are re-checked, and
 *   each draft is written once (its idempotency key), however often the
 *   button is tapped.
 * - Undo (10 min) reverses each saved draft through `pending.undo`.
 * - Edit and Cancel close the open drafts without writing.
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { isUserError } from '../lib/errors'
import { can } from '../lib/permissions'
import { checkBinding, unitKey, type BoundMember } from './scope'
import { closeDraft, fmtDay, UNDO_WINDOW_MS } from './pending'
import { missingToday } from './reads'
import { effectiveKeeper, personName } from '../keepers/model'
import { escapeHtml } from '../messaging/providers/telegramBot'
import { rt } from './roundI18n'
import type { BotLocale } from './i18n'
import type { ChatMessageValue, RoutePlan, Target } from './validators'

/** Most drafts in one group (a round card holds 24 cages, a template 50). */
export const MAX_GROUP_DRAFTS = 50
/** A group's drafts can be saved for as long as drafts live (24 h). */
const GROUP_OPEN_MS = 24 * 60 * 60 * 1000

export const GROUP_VERBS = { save: 'gs', edit: 'ge', cancel: 'gx', undo: 'gu', tell: 'gt', remind: 'gr' } as const

export const groupKey = (id: Id<'botDraftGroups'>) => `chat:${id}`

const text = (m: string): ChatMessageValue => ({ kind: 'text', text: m })
const esc = escapeHtml

/** "38", "40.5": kg without trailing zeros. */
export function kgText(kg: number): string {
  const r = Math.round(kg * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

export async function groupDrafts(ctx: QueryCtx, group: Doc<'botDraftGroups'>): Promise<Doc<'pendingBotActions'>[]> {
  const rows = await ctx.db
    .query('pendingBotActions')
    .withIndex('by_userId_and_draftGroup', (q) => q.eq('userId', group.userId).eq('draftGroup', groupKey(group._id)))
    .take(MAX_GROUP_DRAFTS + 5)
  return rows.filter((d) => d.bindingId === group.bindingId)
}

export async function newGroup(
  ctx: MutationCtx,
  bound: BoundMember,
  g: { kind: 'round' | 'template'; date: string; roundId?: Id<'botRounds'>; templateId?: Id<'botTemplates'> },
): Promise<Id<'botDraftGroups'>> {
  return await ctx.db.insert('botDraftGroups', {
    companyId: bound.binding.companyId,
    bindingId: bound.binding._id,
    userId: bound.binding.userId,
    provider: bound.binding.provider,
    kind: g.kind,
    roundId: g.roundId,
    templateId: g.templateId,
    date: g.date,
    status: 'open',
    createdAt: Date.now(),
  })
}

/** Close a group's open drafts (Edit, Cancel, or a newer Log all). Returns how many closed. */
export async function closeGroup(ctx: MutationCtx, group: Doc<'botDraftGroups'>): Promise<number> {
  let n = 0
  for (const d of await groupDrafts(ctx, group)) {
    if ((await closeDraft(ctx, group.bindingId, d._id)) === 'closed') n++
  }
  if (group.status === 'open') await ctx.db.patch(group._id, { status: 'closed' })
  return n
}

// ---------------------------------------------------------------------------
// The confirm message

export type GroupExtras = {
  /** Round: plan kg per cage, for "Changed: C-07 42 kg (plan 44)". */
  planKg?: Map<string, number | null>
  /** Cages left out and why. */
  leftOut?: string[]
  /** Water check: the manager to tell and the reminder time, when a cage is low. */
  managerName?: string | null
  remindLabel?: string | null
}

function saveRow(locale: BotLocale, groupId: Id<'botDraftGroups'>, n: number) {
  const s = rt(locale)
  return [
    { id: `${GROUP_VERBS.save}:${groupId}`, title: s.saveAll(n) },
    { id: `${GROUP_VERBS.edit}:${groupId}`, title: s.edit },
    { id: `${GROUP_VERBS.cancel}:${groupId}`, title: s.cancel },
  ]
}

/** "C-01 to C-06" for a run like C-01..C-06, else "A-01, A-02, A-05 +1". */
export function cagesLabel(locale: BotLocale, names: string[]): string {
  const s = rt(locale)
  if (!names.length) return ''
  if (names.length === 1) return names[0]
  const parts = names.map((n) => /^(.*?)(\d+)$/.exec(n))
  if (parts.every(Boolean)) {
    const prefix = parts[0]![1]
    const nums = parts.map((p) => Number(p![2]))
    const run = parts.every((p) => p![1] === prefix) && nums.every((x, i) => i === 0 || x === nums[i - 1] + 1)
    if (run && names.length > 2) return s.rangeLabel(names[0], names[names.length - 1])
  }
  return names.length <= 4 ? names.join(', ') : s.andMore(names.slice(0, 3), names.length - 3)
}

type DailyPayload = Extract<Doc<'pendingBotActions'>['payload'], { kind: 'daily_entry' }>
type WaterPayload = Extract<Doc<'pendingBotActions'>['payload'], { kind: 'water_reading' }>

function feedNames(drafts: DailyPayload[]): string {
  const names = [...new Set(drafts.map((p) => p.feedTypeName).filter((x): x is string => !!x))]
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

function mortalityValue(locale: BotLocale, drafts: Doc<'pendingBotActions'>[]): string {
  const s = rt(locale)
  const said = drafts.filter((d) => !d.notSaid?.includes('mortality'))
  if (!said.length) return s.notSaid
  const items = said
    .map((d) => d.payload)
    .filter((p): p is DailyPayload => p.kind === 'daily_entry')
    .map((p) => s.deadItem(p.cageName, p.mortality))
  return s.deadSome(items, said.length < drafts.length)
}

/** T1b: "Got it. Please check before I save:" with Date / Entries / Feed / Changed / Mortality. */
function roundCard(locale: BotLocale, group: Doc<'botDraftGroups'>, drafts: Doc<'pendingBotActions'>[], x: GroupExtras): string {
  const s = rt(locale)
  const daily = drafts.map((d) => d.payload).filter((p): p is DailyPayload => p.kind === 'daily_entry')
  const total = daily.reduce((a, p) => a + p.feedKg, 0)
  const changed = daily
    .filter((p) => {
      const plan = x.planKg?.get(p.cageId)
      return plan != null && Math.abs(plan - p.feedKg) >= 0.05
    })
    .map((p) => s.changedItem(p.cageName, kgText(p.feedKg), kgText(x.planKg!.get(p.cageId)!)))
  const box = [
    `${s.fieldDate}: ${s.morningFeed(fmtDay(locale, group.date))}`,
    `${s.fieldEntries}: ${s.entriesValue(daily.length, kgText(total))}`,
    ...(feedNames(daily) ? [`${s.fieldFeed}: ${feedNames(daily)}`] : []),
    ...(changed.length ? [`${s.fieldChanged}: ${changed.join(', ')}`] : []),
    `${s.fieldMortality}: ${mortalityValue(locale, drafts)}`,
  ]
  const lines = [esc(s.checkBeforeSave), `<blockquote>${box.map(esc).join('\n')}</blockquote>`]
  if (x.leftOut?.length) lines.push(esc(s.leftOut(x.leftOut)))
  if (drafts.some((d) => d.notSaid?.includes('mortality'))) lines.push(esc(s.deadHint(daily[0]?.cageName ?? 'C-11')))
  return lines.join('\n')
}

/** T2b preview: "C-01 to C-06 · 244 kg / Raanan 4 mm · dead: 0". */
function dailyCompact(locale: BotLocale, drafts: Doc<'pendingBotActions'>[], x: GroupExtras): string {
  const s = rt(locale)
  const daily = drafts.map((d) => d.payload).filter((p): p is DailyPayload => p.kind === 'daily_entry')
  const total = daily.reduce((a, p) => a + p.feedKg, 0)
  const dead = daily.reduce((a, p) => a + p.mortality, 0)
  const first = `${cagesLabel(locale, daily.map((p) => p.cageName))} · ${kgText(total)} kg`
  const second = [feedNames(daily), `${s.templateDead}: ${dead}`].filter(Boolean).join(' · ')
  const lines = [esc(s.pleaseCheck), `<blockquote>${esc(first)}\n${esc(second)}</blockquote>`]
  if (x.leftOut?.length) lines.push(esc(s.leftOut(x.leftOut)))
  if (drafts.some((d) => d.notSaid?.includes('mortality'))) lines.push(esc(s.deadHint(daily[0]?.cageName ?? 'C-11')))
  return lines.join('\n')
}

const pad = (s: string, n: number) => (s.length >= n ? `${s} ` : s + ' '.repeat(n - s.length))

/** T2a water draft: a CAGE / DO / TEMP table with "· low" markers, then the advice. */
function waterCard(locale: BotLocale, group: Doc<'botDraftGroups'>, drafts: Doc<'pendingBotActions'>[]): string {
  const s = rt(locale)
  const rows = drafts.map((d) => d.payload).filter((p): p is WaterPayload => p.kind === 'water_reading')
  const low = new Set((group.low ?? []).map((l) => l.cageName))
  const w1 = Math.max(4, ...rows.map((r) => r.cageName.length)) + 2
  const doCell = (r: WaterPayload) =>
    r.dissolvedOxygen === undefined ? '-' : `${r.dissolvedOxygen}${low.has(r.cageName) ? ` · ${s.low}` : ''}`
  const w2 = Math.max(s.colDo.length, ...rows.map((r) => doCell(r).length)) + 2
  const table = [
    pad(s.colCage, w1) + pad(s.colDo, w2) + s.colTemp,
    ...rows.map((r) => pad(r.cageName, w1) + pad(doCell(r), w2) + (r.temperatureC ?? '-')),
  ]
  const lines = [esc(s.pleaseCheck), `<pre>${esc(table.join('\n'))}</pre>`]
  if (group.low?.length) {
    const limit = Math.min(...group.low.map((l) => l.limit))
    lines.push(esc(s.lowAdvice(group.low.map((l) => l.cageName), limit)))
  }
  return lines.join('\n')
}

function otherCard(locale: BotLocale, drafts: Doc<'pendingBotActions'>[]): string {
  const s = rt(locale)
  return [esc(s.pleaseCheck), `<blockquote>${drafts.map((d) => esc(d.summary)).join('\n')}</blockquote>`].join('\n')
}

/** The confirm message for a group's open drafts, or null when none is open. */
export function groupMessage(
  locale: BotLocale,
  group: Doc<'botDraftGroups'>,
  all: Doc<'pendingBotActions'>[],
  x: GroupExtras = {},
): ChatMessageValue | null {
  const drafts = all.filter((d) => d.status === 'pending')
  if (!drafts.length) return null
  const kinds = new Set(drafts.map((d) => d.payload.kind))
  const s = rt(locale)
  let body: string
  if (group.kind === 'round') body = roundCard(locale, group, drafts, x)
  else if (kinds.size === 1 && kinds.has('daily_entry')) body = dailyCompact(locale, drafts, x)
  else if (kinds.size === 1 && kinds.has('water_reading')) body = waterCard(locale, group, drafts)
  else body = otherCard(locale, drafts)
  const rows = [saveRow(locale, group._id, drafts.length)]
  if (group.low?.length && (x.managerName || x.remindLabel)) {
    const second = []
    if (x.managerName) second.push({ id: `${GROUP_VERBS.tell}:${group._id}`, title: s.tellManager(x.managerName) })
    if (x.remindLabel) second.push({ id: `${GROUP_VERBS.remind}:${group._id}`, title: s.remindAt(x.remindLabel) })
    rows.push(second)
  }
  return { kind: 'keyboard', html: true, text: body, rows }
}

// ---------------------------------------------------------------------------
// Buttons (called from inbound.route, inside its transaction)

export async function loadGroup(ctx: QueryCtx, bound: BoundMember, arg: string) {
  const id = ctx.db.normalizeId('botDraftGroups', arg)
  const group = id ? await ctx.db.get(id) : null
  // Another chat's group is just "not open".
  if (!group || group.bindingId !== bound.binding._id || group.companyId !== bound.binding.companyId) return null
  return group
}

/** Save all / Edit / Cancel / Undo of a group; null when the verb is not ours (tell / remind are templates.ts). */
export async function groupButton(
  ctx: MutationCtx,
  bound: BoundMember,
  verb: string,
  arg: string,
  tgt: Target & { bindingId: Id<'channelBindings'> },
  sourceMessageId: string,
): Promise<RoutePlan | null> {
  if (verb !== GROUP_VERBS.save && verb !== GROUP_VERBS.edit && verb !== GROUP_VERBS.cancel && verb !== GROUP_VERBS.undo) return null
  const s = rt(tgt.locale)
  const group = await loadGroup(ctx, bound, arg)
  if (!group) return { type: 'reply', ...tgt, messages: [text(s.groupClosed)] }
  if (verb === GROUP_VERBS.save) return { type: 'group_commit', ...tgt, groupId: group._id, sourceMessageId }
  if (verb === GROUP_VERBS.undo) return { type: 'group_undo', ...tgt, groupId: group._id, sourceMessageId }
  if (group.status !== 'open') return { type: 'reply', ...tgt, messages: [text(group.status === 'saved' ? s.alreadySaved : s.groupClosed)] }
  await closeGroup(ctx, group)
  return { type: 'reply', ...tgt, messages: [text(verb === GROUP_VERBS.edit ? s.groupEdit : s.groupCancelled)] }
}

const DEAD_RE = /^\s*(?:cage\s+)?([A-Za-z0-9][A-Za-z0-9 _-]{0,30}?)\s*[:,]?\s+(\d{1,7})\s*(?:dead|morts?|died)\.?\s*$/i

/**
 * "C-11 3 dead" while a round or template group is open: set that draft's
 * mortality (no LLM) and show the group again. Null when the text is not
 * that or no group is open.
 */
export async function deadReply(
  ctx: MutationCtx,
  bound: BoundMember,
  msgText: string,
  tgt: Target & { bindingId: Id<'channelBindings'> },
): Promise<RoutePlan | null> {
  const m = DEAD_RE.exec(msgText)
  if (!m) return null
  const group = await ctx.db
    .query('botDraftGroups')
    .withIndex('by_bindingId_and_createdAt', (q) => q.eq('bindingId', bound.binding._id))
    .order('desc')
    .first()
  if (!group || group.status !== 'open' || group.createdAt < Date.now() - GROUP_OPEN_MS) return null
  const drafts = (await groupDrafts(ctx, group)).filter((d) => d.status === 'pending' && d.payload.kind === 'daily_entry')
  if (!drafts.length) return null
  const key = unitKey(m[1])
  const hits = drafts.filter((d) => unitKey((d.payload as DailyPayload).cageName) === key)
  if (hits.length !== 1) return null
  const draft = hits[0]
  const p = draft.payload as DailyPayload
  const dead = Number(m[2])
  await ctx.db.patch(draft._id, {
    payload: { ...p, mortality: dead, mortalityCause: dead > 0 ? 'unknown' : undefined },
    notSaid: (draft.notSaid ?? []).filter((f) => f !== 'mortality'),
    fingerprint: `daily|${p.cageId}|${draft.date}|${p.feedKg}|${dead}`,
    summary: draft.summary.replace(/mortality \d+|mortalité \d+/, (x) => x.replace(/\d+/, String(dead))),
  })
  const msg = await groupMessageFor(ctx, bound.locale, group)
  return { type: 'reply', ...tgt, messages: msg ? [msg] : [] }
}

/** The group's confirm message with its extras (plan kg for rounds). */
export async function groupMessageFor(ctx: QueryCtx, locale: BotLocale, group: Doc<'botDraftGroups'>, x: GroupExtras = {}) {
  const drafts = await groupDrafts(ctx, group)
  if (group.kind === 'round' && group.roundId && !x.planKg) {
    const round = await ctx.db.get(group.roundId)
    if (round) x = { ...x, planKg: new Map(round.cages.map((c) => [c.cageId as string, c.planKg])) }
  }
  return groupMessage(locale, group, drafts, x)
}

// ---------------------------------------------------------------------------
// Save all and Undo (process.ts, outside any transaction)

const draftRef = v.object({ pendingId: v.id('pendingBotActions'), summary: v.string(), status: v.string() })

export const draftsOf = internalQuery({
  args: { groupId: v.id('botDraftGroups'), bindingId: v.id('channelBindings') },
  returns: v.union(
    v.null(),
    v.object({ status: v.string(), roundId: v.union(v.id('botRounds'), v.null()), drafts: v.array(draftRef) }),
  ),
  handler: async (ctx, { groupId, bindingId }) => {
    const group = await ctx.db.get(groupId)
    if (!group || group.bindingId !== bindingId) return null
    const drafts = await groupDrafts(ctx, group)
    return {
      status: group.status,
      roundId: group.roundId ?? null,
      drafts: drafts.map((d) => ({ pendingId: d._id, summary: d.summary, status: d.status })),
    }
  },
})

const progressSite = v.object({ logged: v.number(), total: v.number(), missing: v.array(v.string()), more: v.number() })

/** After Save all: mark the group saved and work out "37 of 38 cages logged today. Still missing: B-12 (Yaw)." */
export const markSaved = internalMutation({
  args: { groupId: v.id('botDraftGroups'), bindingId: v.id('channelBindings'), saved: v.number() },
  returns: v.object({ undoUntil: v.number(), progress: v.union(progressSite, v.null()) }),
  handler: async (ctx, { groupId, bindingId, saved }) => {
    const group = await ctx.db.get(groupId)
    const now = Date.now()
    const undoUntil = now + UNDO_WINDOW_MS
    if (!group || group.bindingId !== bindingId) return { undoUntil, progress: null }
    if (saved > 0 || group.status === 'open') await ctx.db.patch(groupId, { status: 'saved', savedAt: now, undoUntil })
    const binding = await ctx.db.get(bindingId)
    const checked = binding ? await checkBinding(ctx, binding) : null
    if (!checked?.ok || !can(checked.bound.member, 'production.view')) return { undoUntil, progress: null }
    const drafts = await groupDrafts(ctx, group)
    if (!drafts.some((d) => d.payload.kind === 'daily_entry')) return { undoUntil, progress: null }
    return { undoUntil, progress: await siteProgress(ctx, checked.bound, now) }
  },
})

/** Logged / total units in scope today, the first missing ones with their keeper. */
async function siteProgress(ctx: QueryCtx, bound: BoundMember, now: number) {
  const today = await missingToday(ctx, bound, now)
  if (!today.active) return null
  const missing: string[] = []
  for (const u of today.missing.slice(0, 2)) {
    const eff = today.date ? await effectiveKeeper(ctx, u, today.date) : null
    const who = eff ? personName(await ctx.db.get(eff.keeperId)).split(/\s+/)[0] : null
    missing.push(who ? `${u.name} (${who})` : u.name)
  }
  return {
    logged: Math.max(0, today.active - today.missing.length),
    total: today.active,
    missing,
    more: Math.max(0, today.missing.length - 2),
  }
}

export const markUndone = internalMutation({
  args: { groupId: v.id('botDraftGroups'), bindingId: v.id('channelBindings') },
  returns: v.null(),
  handler: async (ctx, { groupId, bindingId }) => {
    const group = await ctx.db.get(groupId)
    if (group && group.bindingId === bindingId) await ctx.db.patch(groupId, { status: 'closed', undoUntil: undefined })
    return null
  },
})

type GroupPlan = Extract<RoutePlan, { type: 'group_commit' | 'group_undo' }>

/** Save all: every open draft through pending.commit (once each). */
export async function commitGroup(ctx: ActionCtx, plan: GroupPlan): Promise<{ messages: ChatMessageValue[]; roundId: Id<'botRounds'> | null }> {
  const s = rt(plan.locale)
  const g = await ctx.runQuery(internal.bot.groups.draftsOf, { groupId: plan.groupId, bindingId: plan.bindingId })
  if (!g) return { messages: [text(s.groupClosed)], roundId: null }
  if (g.status === 'saved') return { messages: [text(s.alreadySaved)], roundId: null }
  const open = g.drafts.filter((d) => d.status === 'pending')
  if (g.status !== 'open' || !open.length) return { messages: [text(s.groupClosed)], roundId: null }
  let saved = 0
  let review = 0
  const failed: string[] = []
  for (const d of open) {
    try {
      const r = await ctx.runMutation(internal.bot.pending.commit, {
        pendingId: d.pendingId,
        bindingId: plan.bindingId,
        sourceMessageId: plan.sourceMessageId,
        confirmDuplicate: false,
      })
      if (r.status === 'saved' || r.status === 'already') saved++
      else if (r.status === 'needs_confirm') review++
      else failed.push(`- ${d.summary}: ${r.status === 'refused' ? r.message : r.status}`)
    } catch (err) {
      const msg = isUserError(err) ? err.data.message : 'something went wrong'
      await ctx.runMutation(internal.bot.pending.markFailed, { pendingId: d.pendingId, error: msg })
      failed.push(`- ${d.summary}: ${msg}`)
    }
  }
  const done = await ctx.runMutation(internal.bot.groups.markSaved, { groupId: plan.groupId, bindingId: plan.bindingId, saved })
  const lines: string[] = []
  if (saved) lines.push(s.savedN(saved))
  if (saved && done.progress) {
    const p = done.progress
    lines.push(s.progressSite(p.logged, p.total, p.missing, p.more))
  }
  const extra: string[] = []
  if (review) extra.push(s.needsReview(review))
  if (failed.length) extra.push(s.someFailed(failed.slice(0, 10).join('\n')))
  const body = [lines.join(' '), ...extra].filter(Boolean).join('\n').slice(0, 3500)
  const messages: ChatMessageValue[] = saved
    ? [
        {
          kind: 'buttons',
          text: body,
          buttons: [{ id: `${GROUP_VERBS.undo}:${plan.groupId}`, title: s.undoFor(Math.round(UNDO_WINDOW_MS / 60_000)) }],
        },
      ]
    : [text(body || s.groupClosed)]
  return { messages, roundId: g.roundId }
}

/** Undo every saved draft of the group within 10 minutes. */
export async function undoGroup(ctx: ActionCtx, plan: GroupPlan): Promise<{ messages: ChatMessageValue[]; roundId: Id<'botRounds'> | null }> {
  const s = rt(plan.locale)
  const g = await ctx.runQuery(internal.bot.groups.draftsOf, { groupId: plan.groupId, bindingId: plan.bindingId })
  if (!g) return { messages: [text(s.groupClosed)], roundId: null }
  const committed = g.drafts.filter((d) => d.status === 'committed')
  if (!committed.length) return { messages: [text(s.undoTooLate)], roundId: null }
  let undone = 0
  let late = 0
  for (const d of committed) {
    try {
      const r = await ctx.runMutation(internal.bot.pending.undo, {
        pendingId: d.pendingId,
        bindingId: plan.bindingId,
        sourceMessageId: plan.sourceMessageId,
      })
      if (r.status === 'undone') undone++
      else late++
    } catch {
      late++
    }
  }
  if (undone) await ctx.runMutation(internal.bot.groups.markUndone, { groupId: plan.groupId, bindingId: plan.bindingId })
  const lines = [undone ? s.undoneN(undone) : '', late ? s.undoTooLate : ''].filter(Boolean)
  return { messages: [text(lines.join('\n'))], roundId: undone ? g.roundId : null }
}
