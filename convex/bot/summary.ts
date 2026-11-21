/**
 * Chat summaries (VFQ-1 "Day done", owner's "get me summary from offshore"):
 * the scope resolver's answer turned into a short report from the farm's own
 * records, private chats and Telegram groups alike. Deterministic: no model.
 *
 * Reach is the (group-narrowed) member's site scope, never the chat's active
 * site; money lines need finance.view, which a group strips unless its money
 * capability is on (groupScope.ts).
 */
import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { can } from '../lib/permissions'
import { round } from '../lib/kpi'
import { todayIn, zoneFor } from '../lib/dates'
import { companyCurrency, siteKpis, totalKpis } from '../lib/siteKpis'
import { inScope, type BoundMember, type MemberScope } from './scope'
import type { summaryRange, summaryScope } from './tables'
import type { ChatMessageValue, RoutePlan, Target } from './validators'
import { gt } from './chatGroupI18n'
import { t, type BotLocale } from './i18n'
import { decide, isFollowUp, isSummaryAsk, rangeDates, resolveScope, unitRefs, matchUnits, type RangeKind } from './scopeResolver'

export type SummaryScope = Infer<typeof summaryScope>
export type SummaryRange = Infer<typeof summaryRange>

const MEMORY_MS = 15 * 60 * 1000
const RECORD_CAP = 3000

/** Who is asking where: the memory key. `senderKey` is the Telegram user id (or the chat address). */
export type ChatKey = {
  provider: 'telegram' | 'whatsapp'
  chatAddress: string
  senderKey: string
  senderName?: string
  companyId: Id<'companies'>
}

/** Active sites the member may see (all of their scope, not just the chat's active site). */
export async function sitesInReach(ctx: MutationCtx, bound: MemberScope): Promise<Doc<'farmLocations'>[]> {
  const rows = await ctx.db
    .query('farmLocations')
    .withIndex('by_company', (q) => q.eq('companyId', bound.binding.companyId))
    .take(100)
  return rows.filter((s) => s.active !== false && inScope(bound, s._id))
}

export async function unitsInReach(ctx: MutationCtx, bound: MemberScope): Promise<Doc<'cages'>[]> {
  const rows = await ctx.db
    .query('cages')
    .withIndex('by_company', (q) => q.eq('companyId', bound.binding.companyId))
    .take(1000)
  return rows.filter((c) => !c.archivedAt && inScope(bound, c.locationId))
}

export async function recall(ctx: MutationCtx, key: ChatKey): Promise<Doc<'botChatScopes'> | null> {
  const row = await ctx.db
    .query('botChatScopes')
    .withIndex('by_provider_and_chatAddress_and_senderKey', (q) =>
      q.eq('provider', key.provider).eq('chatAddress', key.chatAddress).eq('senderKey', key.senderKey),
    )
    .first()
  if (!row || row.companyId !== key.companyId || row.expiresAt <= Date.now()) return null
  return row
}

export async function remember(
  ctx: MutationCtx,
  key: ChatKey,
  v: { scope?: SummaryScope; range: SummaryRange; awaiting?: 'scope' | 'cage' },
): Promise<void> {
  const now = Date.now()
  const row = await ctx.db
    .query('botChatScopes')
    .withIndex('by_provider_and_chatAddress_and_senderKey', (q) =>
      q.eq('provider', key.provider).eq('chatAddress', key.chatAddress).eq('senderKey', key.senderKey),
    )
    .first()
  const fields = {
    companyId: key.companyId,
    senderName: key.senderName,
    scope: v.scope,
    range: v.range,
    awaiting: v.awaiting,
    expiresAt: now + MEMORY_MS,
    updatedAt: now,
  }
  if (row) await ctx.db.replace(row._id, { ...row, ...fields })
  else await ctx.db.insert('botChatScopes', { provider: key.provider, chatAddress: key.chatAddress, senderKey: key.senderKey, ...fields })
}

/** Old remembered scopes (pruned with the inbound log). */
export async function pruneScopes(ctx: MutationCtx): Promise<number> {
  const old = await ctx.db
    .query('botChatScopes')
    .withIndex('by_expiresAt', (q) => q.lt('expiresAt', Date.now() - 24 * 60 * 60 * 1000))
    .take(500)
  for (const r of old) await ctx.db.delete(r._id)
  return old.length
}

const kg = (n: number) => (round(n, 1) ?? 0).toLocaleString('en-US')
const num = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * The report text for a scope and period, or null when the scope is out of
 * reach (a stale button, another org's id).
 */
export async function buildSummary(
  ctx: MutationCtx,
  bound: BoundMember,
  scope: SummaryScope,
  range: RangeKind,
  now: number,
): Promise<string | null> {
  const s = gt(bound.locale)
  const reach = await unitsInReach(ctx, bound)
  let label: string
  let units: Doc<'cages'>[]
  let site: Doc<'farmLocations'> | null = null
  if (scope.kind === 'unit') {
    const u = reach.find((x) => x._id === scope.unitId)
    if (!u) return null
    units = [u]
    site = u.locationId ? await ctx.db.get(u.locationId) : null
    label = site ? `${u.code ?? u.name} · ${site.name}` : (u.code ?? u.name)
  } else if (scope.kind === 'site') {
    site = await ctx.db.get(scope.siteId)
    if (!site || site.companyId !== bound.binding.companyId || site.active === false || !inScope(bound, site._id)) return null
    units = reach.filter((u) => u.locationId === scope.siteId)
    label = site.name
  } else {
    units = reach
    label = s.allSites
  }
  const today = todayIn(zoneFor(site, bound.company), now)
  const { from, to } = rangeDates(range, today)
  const lines = [`<b>${esc(label)} · ${esc(s.period(range, from, to))}</b>`]
  if (!units.length) return [...lines, s.noUnits].join('\n')

  const ids = new Set<string>(units.map((u) => u._id))
  const records = await ctx.db
    .query('dailyRecords')
    .withIndex('by_company_and_date', (q) => q.eq('companyId', bound.binding.companyId).gte('date', from).lte('date', to))
    .take(RECORD_CAP)
  const rows = records.filter((r) => ids.has(r.cageId))
  const name = (id: Id<'cages'>) => {
    const u = units.find((x) => x._id === id)
    return u ? (u.code ?? u.name) : '?'
  }

  const active = units.filter((u) => u.status === 'active')
  if (from === to) {
    const logged = new Set(rows.map((r) => r.cageId as string))
    if (scope.kind === 'unit') lines.push(s.unitLogged(logged.has(units[0]._id)))
    else if (active.length) {
      const missing = active.filter((u) => !logged.has(u._id)).map((u) => u.code ?? u.name)
      lines.push(s.logged(active.length - missing.length, active.length))
      if (missing.length) lines.push(s.missing(missing.slice(0, 8), Math.max(0, missing.length - 8)))
    }
  } else {
    lines.push(s.entries(rows.length))
  }
  const feed = rows.reduce((a, r) => a + (r.feedAmount || 0), 0)
  const dead = rows.reduce((a, r) => a + (r.mortality || 0), 0)
  lines.push(s.feedDead(kg(feed), dead))
  const low = rows
    .filter((r) => typeof r.dissolvedOxygen === 'number')
    .sort((a, b) => (a.dissolvedOxygen ?? 0) - (b.dissolvedOxygen ?? 0))[0]
  if (low) lines.push(s.lowDo(String(round(low.dissolvedOxygen!, 1)), name(low.cageId)))
  if (scope.kind === 'unit') {
    const u = units[0]
    if (u.currentCount) lines.push(s.unitState(num(u.currentCount), u.currentWeight ? String(round(u.currentWeight, 1)) : null))
  } else {
    const fish = active.reduce((a, u) => a + (u.currentCount ?? 0), 0)
    if (fish) lines.push(s.fish(num(fish)))
  }

  // Harvest and money from the shared KPI helper (region report, ENT-002).
  const siteFilter = (id: Id<'farmLocations'> | undefined) =>
    inScope(bound, id) && (scope.kind !== 'site' || id === scope.siteId) && scope.kind !== 'unit'
  const money = can(bound.member, 'finance.view')
  const feedCost = rows.reduce((a, r) => a + (r.feedCost || 0), 0)
  if (scope.kind !== 'unit') {
    const k = await siteKpis(ctx, bound.binding.companyId, { from, to }, siteFilter)
    const total = totalKpis(k.bySite)
    if (total.harvestKg) lines.push(s.harvest(kg(total.harvestKg)))
    if (money) lines.push(s.money(companyCurrency(bound.company), num(feedCost), num(total.salesAmount), num(total.expensesAmount)))
    if (k.truncated) lines.push(s.partial)
  } else if (money && feedCost) {
    lines.push(s.money(companyCurrency(bound.company), num(feedCost), '0', '0'))
  }
  if (records.length >= RECORD_CAP) lines.push(s.partial)
  return lines.join('\n')
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function html(text: string): ChatMessageValue {
  return { kind: 'keyboard', html: true, text, rows: [] }
}

/** Clarify buttons: All sites · each site · A cage… (or the matching units). */
function clarifyMessage(
  bound: BoundMember,
  key: ChatKey,
  d: { sites: Doc<'farmLocations'>[]; units: Doc<'cages'>[]; reason: 'none' | 'ambiguous' | 'unknown_unit'; code?: string },
): ChatMessageValue {
  const s = gt(bound.locale)
  const k = key.senderKey
  if (d.reason === 'unknown_unit') return { kind: 'text', text: s.noCage(d.code ?? '') }
  const rows: { id: string; title: string }[][] = []
  if (d.units.length) {
    const btns = d.units.slice(0, 8).map((u) => {
      const site = d.sites.find((x) => x._id === u.locationId)
      return { id: `sq:${k}:u${u._id}`, title: `${u.code ?? u.name}${site ? ` · ${site.name}` : ''}`.slice(0, 40) }
    })
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2))
    return asChoice(key, bound.locale, s.clarifyAmbiguous, rows)
  }
  if (d.reason === 'none' && d.sites.length > 1) rows.push([{ id: `sq:${k}:a`, title: s.allSites }])
  const sb = d.sites.slice(0, 8).map((x) => ({ id: `sq:${k}:s${x._id}`, title: x.name.slice(0, 30) }))
  for (let i = 0; i < sb.length; i += 2) rows.push(sb.slice(i, i + 2))
  if (d.reason === 'none') rows.push([{ id: `sq:${k}:c`, title: s.aCage }])
  return asChoice(key, bound.locale, d.reason === 'none' ? s.clarify : s.clarifyAmbiguous, rows)
}

/** Telegram: inline keyboard; WhatsApp: a list (its reply buttons stop at 3). */
function asChoice(key: ChatKey, locale: BotLocale, text: string, rows: { id: string; title: string }[][]): ChatMessageValue {
  if (key.provider === 'telegram') return { kind: 'keyboard', text, rows }
  return { kind: 'list', text, button: t(locale).pick, rows: rows.flat().slice(0, 10).map((b) => ({ id: b.id, title: b.title.slice(0, 24) })) }
}

/** A summary ask, or a short follow-up ("and yesterday?") on a remembered scope. */
export function wantsSummary(text: string, memory: Pick<Doc<'botChatScopes'>, 'scope'> | null): boolean {
  return isSummaryAsk(text) || (!!memory?.scope && isFollowUp(text))
}

/** Answer a summary ask: straight away when the scope is clear, else the clarify buttons. */
export async function summaryPlan(
  ctx: MutationCtx,
  bound: BoundMember,
  text: string,
  key: ChatKey,
  tgt: Target,
  forced?: { scope?: SummaryScope; range?: RangeKind },
): Promise<RoutePlan> {
  const now = Date.now()
  const memory = await recall(ctx, key)
  const sites = await sitesInReach(ctx, bound)
  const units = await unitsInReach(ctx, bound)
  const r = resolveScope(text, sites, units)
  if (forced?.range) r.range = forced.range
  const d = forced?.scope
    ? { kind: 'answer' as const, scope: forced.scope, range: r.range ?? memory?.range ?? 'today' }
    : decide(r, {
        sitesInReach: sites.map((x) => x._id),
        units,
        // Memory answers follow-ups ("and yesterday?"); a fresh "summary" with no place asks again.
        remembered: memory && isFollowUp(text) ? { scope: memory.scope ?? null, range: memory.range } : null,
      })
  if (d.kind === 'clarify') {
    await remember(ctx, key, { range: d.range, awaiting: d.reason === 'unknown_unit' ? 'cage' : 'scope' })
    const msg = clarifyMessage(bound, key, {
      sites: d.units.length ? sites : sites.filter((x) => d.sites.includes(x._id)),
      units: units.filter((u) => d.units.includes(u._id)),
      reason: d.reason,
      code: r.unknownUnit ?? undefined,
    })
    return { type: 'reply', ...tgt, messages: [msg] }
  }
  const body = await buildSummary(ctx, bound, d.scope, d.range, now)
  if (!body) return { type: 'reply', ...tgt, messages: [clarifyMessage(bound, key, { sites, units: [], reason: 'none' })] }
  await remember(ctx, key, { scope: d.scope, range: d.range })
  return { type: 'reply', ...tgt, messages: [html(body)] }
}

/**
 * A clarify button: `sq:<senderKey>:a | s<siteId> | u<unitId> | c`. Only the
 * person who asked may pick. Returns null when the id is not ours.
 */
export async function scopeButton(
  ctx: MutationCtx,
  bound: BoundMember,
  arg: string,
  key: ChatKey,
  tgt: Target,
): Promise<RoutePlan | null> {
  const m = /^([^:]{1,32}):(a|c|s(.+)|u(.+))$/.exec(arg)
  if (!m) return null
  const s = gt(bound.locale)
  if (m[1] !== key.senderKey) {
    const memory = await ctx.db
      .query('botChatScopes')
      .withIndex('by_provider_and_chatAddress_and_senderKey', (q) =>
        q.eq('provider', key.provider).eq('chatAddress', key.chatAddress).eq('senderKey', m[1]),
      )
      .first()
    return { type: 'reply', ...tgt, toast: s.onlyAsker(memory?.senderName ?? '…'), messages: [] }
  }
  const memory = await recall(ctx, key)
  const range = memory?.range ?? 'today'
  if (m[2] === 'c') {
    await remember(ctx, key, { range, awaiting: 'cage' })
    return { type: 'reply', ...tgt, messages: [{ kind: 'text', text: s.askCage }] }
  }
  let scope: SummaryScope | null = null
  if (m[2] === 'a') scope = { kind: 'all' }
  else if (m[3]) {
    const siteId = ctx.db.normalizeId('farmLocations', m[3])
    if (siteId) scope = { kind: 'site', siteId }
  } else if (m[4]) {
    const unitId = ctx.db.normalizeId('cages', m[4])
    if (unitId) scope = { kind: 'unit', unitId }
  }
  const body = scope ? await buildSummary(ctx, bound, scope, range, Date.now()) : null
  if (!scope || !body) return { type: 'reply', ...tgt, messages: [{ kind: 'text', text: s.noUnits }] }
  await remember(ctx, key, { scope, range })
  return { type: 'reply', ...tgt, messages: [html(body)] }
}

/** The answer to "Which cage?": a code finishes the summary; anything else falls through. */
export async function awaitingCage(
  ctx: MutationCtx,
  bound: BoundMember,
  text: string,
  key: ChatKey,
  tgt: Target,
): Promise<RoutePlan | null> {
  const memory = await recall(ctx, key)
  if (memory?.awaiting !== 'cage') return null
  if (!unitRefs(text).length && text.length > 12) {
    await remember(ctx, key, { scope: memory.scope, range: memory.range })
    return null
  }
  const units = await unitsInReach(ctx, bound)
  const hit = matchUnits(unitRefs(text).length ? text : `cage ${text}`, units)
  if (hit.units.length === 1) {
    return await summaryPlan(ctx, bound, text, key, tgt, { scope: { kind: 'unit', unitId: hit.units[0]._id }, range: memory.range })
  }
  if (hit.units.length > 1) {
    const sites = await sitesInReach(ctx, bound)
    return { type: 'reply', ...tgt, messages: [clarifyMessage(bound, key, { sites, units: hit.units, reason: 'ambiguous' })] }
  }
  return { type: 'reply', ...tgt, messages: [{ kind: 'text', text: gt(bound.locale).noCage(text.slice(0, 12)) }] }
}

/** The one site a message names, for the agent (null when none or several). */
export async function namedSite(ctx: MutationCtx, bound: BoundMember, text: string): Promise<Id<'farmLocations'> | undefined> {
  const sites = await sitesInReach(ctx, bound)
  if (sites.length < 2) return undefined
  const r = resolveScope(text, sites, [])
  return r.sites.length === 1 && !r.all ? r.sites[0] : undefined
}
