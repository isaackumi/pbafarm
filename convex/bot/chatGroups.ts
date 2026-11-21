/**
 * Telegram group chats (VFQ-1 "T7 Telegram: Site group chat"). Not to be
 * confused with groups.ts, which batches drafts.
 *
 * - A group is linked to exactly one organization (`botChatGroups`) by an
 *   admin (integrations.manage, "Configure messaging channels") who sends
 *   /connect and picks the farm locations it may see.
 * - Everyone in the group acts as themselves: the sender's Telegram id finds
 *   their private-chat binding, re-checked on every message (checkBinding),
 *   and their access is the group's scope and capabilities intersected with
 *   their own role (groupScope.ts). A group never adds access.
 * - The bot only sees what is addressed to it (privacy mode; verify.ts).
 * - Entries are never saved from the group: drafts and cards go to the
 *   sender's private chat. Buttons in a group work only for their owner.
 */
import { v } from 'convex/values'
import { internalAction, internalMutation, mutation, query } from '../_generated/server'
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { can, memberContextIn, requireMember, type MemberContext } from '../lib/permissions'
import { rateLimiter } from '../lib/rateLimits'
import { siteUrl } from '../lib/email'
import { logAudit } from '../lib/tenancy'
import { insertAuditLog } from '../lib/auditChain'
import { botActorUser, withApiActor } from '../lib/apiActor'
import { userError } from '../lib/errors'
import { sendTelegramChat, telegramMention } from '../messaging/providers/telegramBot'
import { telegramBotToken } from './outbound'
import { groupCaps } from './tables'
import type { ChatMessageValue, RoutePlan, Target } from './validators'
import { botLocale, t, type BotLocale } from './i18n'
import { gt, type CapKey } from './chatGroupI18n'
import { checkBinding, companiesOf, liveBinding, type BoundMember } from './scope'
import { DEFAULT_CAPS, groupBound } from './groupScope'
import { awaitingCage, namedSite, recall, scopeButton, summaryPlan, wantsSummary, type ChatKey } from './summary'
import { templatesCommand } from './templates'
import { roundCommand } from './rounds'

/** The permission that links, scopes and unlinks a group: the one that configures messaging channels. */
export const GROUP_ADMIN_PERMISSION = 'integrations.manage' as const

const CAP_KEYS: CapKey[] = ['ask', 'log', 'alerts', 'money', 'buyers']

function botUsername(): string {
  return (process.env.TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '').trim()
}

function privateLink(): string {
  const bot = botUsername()
  return bot ? `https://t.me/${bot}` : `${siteUrl()}/account`
}

function text(msg: string): ChatMessageValue {
  return { kind: 'text', text: msg }
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function firstName(name: string | undefined | null): string {
  return (name ?? '').trim().split(/\s+/)[0]?.slice(0, 32) ?? ''
}

type GroupLimit =
  | 'botGroupUnlinked'
  | 'botGroupWelcome'
  | 'botPerGroup'
  | 'botUnboundGlobal'
  | 'botPerBinding'
  | 'botPerBindingHour'
  | 'botPerCompany'

async function limited(ctx: MutationCtx, name: GroupLimit, key: string) {
  const r = await rateLimiter.limit(ctx, name, { key })
  return !r.ok
}

async function rowsForChat(ctx: MutationCtx, chatId: string) {
  return await ctx.db
    .query('botChatGroups')
    .withIndex('by_provider_and_chatId', (q) => q.eq('provider', 'telegram').eq('chatId', chatId))
    .take(20)
}

/** The member's context in `companyId`, when they may manage groups there. */
async function adminIn(ctx: MutationCtx, user: Doc<'users'>, companyId: Id<'companies'>): Promise<MemberContext | null> {
  const m = await memberContextIn(ctx, user, companyId)
  return m && can(m, GROUP_ADMIN_PERMISSION) ? m : null
}

async function activeSites(ctx: MutationCtx, companyId: Id<'companies'>, scope: MemberContext['siteScope']) {
  const rows = await ctx.db
    .query('farmLocations')
    .withIndex('by_company', (q) => q.eq('companyId', companyId))
    .take(100)
  return rows.filter((s) => s.active !== false && (scope === 'all' || scope.has(s._id)))
}

async function scopeLabel(ctx: MutationCtx, locale: BotLocale, group: Pick<Doc<'botChatGroups'>, 'siteScope'>): Promise<string> {
  const s = gt(locale)
  if (group.siteScope === 'all') return s.allLocations
  const names: string[] = []
  for (const id of group.siteScope.slice(0, 4)) {
    const site = await ctx.db.get(id)
    if (site) names.push(site.name)
  }
  const more = group.siteScope.length - names.length
  return more > 0 ? `${names.join(', ')} +${more}` : names.join(', ') || s.sitesCount(0)
}

/** An audit row written as the admin, through the chat (channel telegram). */
function adminCtx(ctx: MutationCtx, account: Doc<'users'>, member: MemberContext, sourceMessageId: string): MutationCtx {
  return withApiActor(ctx, {
    user: botActorUser(account, member.companyId!, member.siteScope),
    companyId: member.companyId!,
    channel: { provider: 'telegram', sourceMessageId },
  })
}

function auditValues(g: Pick<Doc<'botChatGroups'>, 'chatId' | 'title' | 'siteScope' | 'caps' | 'status'>) {
  return { chatId: g.chatId, title: g.title, siteScope: g.siteScope, caps: g.caps, status: g.status }
}

/** Bot added, removed, or the group became a supergroup. */
async function memberEvent(ctx: MutationCtx, inbound: Doc<'channelInbound'>): Promise<RoutePlan> {
  const now = Date.now()
  const rows = await rowsForChat(ctx, inbound.address)
  if (inbound.member === 'removed') {
    for (const g of rows) {
      if (g.status === 'revoked') continue
      await ctx.db.patch(g._id, { status: 'revoked', revokedAt: now, revokedReason: 'bot_removed', threadId: undefined, updatedAt: now })
      // No person acts here: the system revokes on Telegram's word.
      await insertAuditLog(ctx, {
        actionType: 'delete',
        tableName: 'botChatGroups',
        recordId: g._id,
        previousValues: auditValues(g),
        newValues: { status: 'revoked', reason: 'bot_removed' },
        companyId: g.companyId,
        channel: 'telegram',
        sourceMessageId: inbound.externalId,
      })
    }
    return { type: 'none' }
  }
  if (inbound.member === 'migrated') {
    if (!inbound.migrateTo || !/^-?\d{1,20}$/.test(inbound.migrateTo)) return { type: 'none' }
    for (const g of rows) await ctx.db.patch(g._id, { chatId: inbound.migrateTo, updatedAt: now })
    return { type: 'none' }
  }
  // Added: a short welcome, unless already linked.
  if (rows.some((g) => g.status === 'active')) return { type: 'none' }
  if ((await limited(ctx, 'botGroupWelcome', inbound.address)) || (await limited(ctx, 'botUnboundGlobal', 'all'))) {
    return { type: 'none' }
  }
  return { type: 'reply', provider: 'telegram', address: inbound.address, locale: 'en', messages: [text(gt('en').welcome(botUsername()))] }
}

/** A tagged message or tap from someone with no live Anowa link: one short pointer, no farm data. */
async function unlinkedReply(ctx: MutationCtx, inbound: Doc<'channelInbound'>, base: Omit<Target, 'locale'>): Promise<RoutePlan> {
  const s = gt('en')
  const msg = s.unlinked(privateLink())
  if (inbound.kind === 'button') {
    // A tap always gets its toast (it costs no group message).
    if (await limited(ctx, 'botUnboundGlobal', 'all')) return { type: 'none' }
    return { type: 'reply', ...base, locale: 'en', toast: msg, toastAlert: true, messages: [] }
  }
  if (
    (await limited(ctx, 'botGroupUnlinked', `${inbound.address}:${inbound.senderId}`)) ||
    (await limited(ctx, 'botUnboundGlobal', 'all'))
  ) {
    await ctx.db.patch(inbound._id, { status: 'ignored', error: 'rate_limited' })
    return { type: 'none' }
  }
  return { type: 'reply', ...base, locale: 'en', replyTo: inbound.messageId, messages: [text(msg)] }
}

async function ownerName(ctx: MutationCtx, bindingId: Id<'channelBindings'> | undefined): Promise<string> {
  const b = bindingId ? await ctx.db.get(bindingId) : null
  if (!b) return '…'
  const u = await ctx.db.get(b.userId)
  return firstName(u?.name) || firstName(b.displayName) || '…'
}

/** Inline keyboard of sites (✓ = in scope) for the /connect picker or the /access panel. */
function siteRows(
  prefix: string,
  locale: BotLocale,
  sites: Doc<'farmLocations'>[],
  scope: Doc<'botChatGroups'>['siteScope'],
  allowAll: boolean,
) {
  const s = gt(locale)
  const rows: { id: string; title: string }[][] = []
  if (allowAll) rows.push([{ id: `${prefix}all`, title: `${scope === 'all' ? '✓ ' : ''}${s.allLocations}` }])
  const btns = sites.slice(0, 12).map((x) => ({
    id: `${prefix}${x._id}`,
    title: `${scope !== 'all' && scope.includes(x._id) ? '✓ ' : ''}${x.name}`.slice(0, 40),
  }))
  for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2))
  return rows
}

async function pickerMessage(ctx: MutationCtx, group: Doc<'botChatGroups'>, member: MemberContext, locale: BotLocale): Promise<ChatMessageValue> {
  const s = gt(locale)
  const company = await ctx.db.get(group.companyId)
  const sites = await activeSites(ctx, group.companyId, member.siteScope)
  const rows = siteRows('gs:', locale, sites, group.siteScope, member.siteScope === 'all')
  rows.push([
    { id: 'gs:done', title: s.done },
    { id: 'gs:x', title: s.cancel },
  ])
  return { kind: 'keyboard', html: true, text: esc(s.pickScope(company?.name ?? '')), rows }
}

async function accessMessage(ctx: MutationCtx, group: Doc<'botChatGroups'>, member: MemberContext, locale: BotLocale): Promise<ChatMessageValue> {
  const s = gt(locale)
  const company = await ctx.db.get(group.companyId)
  const sites = await activeSites(ctx, group.companyId, member.siteScope)
  const rows = siteRows('ga:s:', locale, sites, group.siteScope, member.siteScope === 'all')
  if (rows.length && member.siteScope === 'all') rows[0] = [{ id: 'ga:all', title: rows[0][0].title }]
  const caps = CAP_KEYS.map((k) => ({ id: `ga:c:${k}`, title: `${group.caps[k] ? '✓ ' : ''}${s.caps[k]}` }))
  rows.push(caps.slice(0, 3), caps.slice(3))
  rows.push([{ id: 'ga:done', title: s.done }])
  return {
    kind: 'keyboard',
    html: true,
    text: s.accessTitle(esc(company?.name ?? ''), esc(await scopeLabel(ctx, locale, group))),
    rows,
  }
}

/** /connect, or a company picked from the /connect list: open the site picker on a pending row. */
async function startConnect(
  ctx: MutationCtx,
  account: Doc<'users'>,
  member: MemberContext,
  inbound: Doc<'channelInbound'>,
  tgt: Target,
): Promise<RoutePlan> {
  const now = Date.now()
  const rows = await rowsForChat(ctx, inbound.address)
  const title = (inbound.chatTitle ?? 'Telegram group').slice(0, 120)
  const companyId = member.companyId!
  // One row per chat: a fresh link resets scope, capabilities and the agent thread.
  const fresh = {
    companyId,
    title,
    status: 'pending' as const,
    siteScope: [] as Id<'farmLocations'>[],
    caps: DEFAULT_CAPS,
    linkedBy: account._id,
    pendingBy: inbound.senderId,
    threadId: undefined,
    linkedAt: undefined,
    revokedAt: undefined,
    revokedReason: undefined,
    updatedAt: now,
  }
  let id: Id<'botChatGroups'>
  if (rows[0]) {
    await ctx.db.patch(rows[0]._id, fresh)
    id = rows[0]._id
    for (const extra of rows.slice(1)) await ctx.db.delete(extra._id)
  } else {
    id = await ctx.db.insert('botChatGroups', { provider: 'telegram', chatId: inbound.address, createdAt: now, ...fresh })
  }
  const group = (await ctx.db.get(id))!
  return { type: 'reply', ...tgt, messages: [await pickerMessage(ctx, group, member, tgt.locale)] }
}

async function connect(ctx: MutationCtx, bound: BoundMember, inbound: Doc<'channelInbound'>, tgt: Target, active: Doc<'botChatGroups'> | null): Promise<RoutePlan> {
  const s = gt(tgt.locale)
  if (active) {
    const mine = await memberContextIn(ctx, bound.account, active.companyId)
    const company = mine ? await ctx.db.get(active.companyId) : null
    return { type: 'reply', ...tgt, messages: [text(company ? s.alreadyLinked(company.name) : s.linkedOther)] }
  }
  const companies = await companiesOf(ctx, bound.account)
  const admin: Array<{ company: Doc<'companies'>; member: MemberContext }> = []
  for (const c of companies) {
    const m = await adminIn(ctx, bound.account, c._id)
    if (m) admin.push({ company: c, member: m })
  }
  if (!admin.length) return { type: 'reply', ...tgt, messages: [text(s.needAdmin)] }
  if (admin.length === 1) return await startConnect(ctx, bound.account, admin[0].member, inbound, tgt)
  return {
    type: 'reply',
    ...tgt,
    messages: [
      {
        kind: 'keyboard',
        text: s.pickOrg,
        rows: admin.slice(0, 10).map((a) => [{ id: `gc:${a.company._id}`, title: a.company.name.slice(0, 40) }]),
      },
    ],
  }
}

/** gc:<companyId>: the company for /connect. Whoever taps must be an admin there. */
async function connectCompany(ctx: MutationCtx, bound: BoundMember, arg: string, inbound: Doc<'channelInbound'>, tgt: Target): Promise<RoutePlan> {
  const s = gt(tgt.locale)
  const companyId = ctx.db.normalizeId('companies', arg)
  const member = companyId ? await adminIn(ctx, bound.account, companyId) : null
  if (!member) return { type: 'reply', ...tgt, toast: s.needAdmin, toastAlert: true, messages: [] }
  const rows = await rowsForChat(ctx, inbound.address)
  const active = rows.find((g) => g.status === 'active')
  if (active) return { type: 'reply', ...tgt, toast: s.linkedOther, messages: [] }
  return await startConnect(ctx, bound.account, member, inbound, tgt)
}

/** gs:<all|siteId|done|x>: the /connect site picker. Only the person who started it, still an admin. */
async function connectScope(ctx: MutationCtx, bound: BoundMember, arg: string, inbound: Doc<'channelInbound'>, tgt: Target): Promise<RoutePlan> {
  const s = gt(tgt.locale)
  const rows = await rowsForChat(ctx, inbound.address)
  const group = rows.find((g) => g.status === 'pending')
  if (!group) return { type: 'reply', ...tgt, toast: s.connectCancelled, messages: [] }
  if (group.pendingBy !== inbound.senderId) {
    const by = await ctx.db.get(group.linkedBy)
    return { type: 'reply', ...tgt, toast: s.connectBusy(firstName(by?.name) || '…'), messages: [] }
  }
  const member = await adminIn(ctx, bound.account, group.companyId)
  if (!member) return { type: 'reply', ...tgt, toast: s.needAdmin, toastAlert: true, messages: [] }
  const now = Date.now()
  if (arg === 'x') {
    await ctx.db.patch(group._id, { status: 'revoked', revokedAt: now, revokedReason: 'cancelled', pendingBy: undefined, updatedAt: now })
    return { type: 'reply', ...tgt, messages: [text(s.connectCancelled)] }
  }
  if (arg === 'done') {
    if (group.siteScope !== 'all' && !group.siteScope.length) return { type: 'reply', ...tgt, toast: s.pickAtLeastOne, messages: [] }
    await ctx.db.patch(group._id, { status: 'active', linkedAt: now, linkedBy: bound.account._id, pendingBy: undefined, updatedAt: now })
    const linked = (await ctx.db.get(group._id))!
    await logAudit(adminCtx(ctx, bound.account, member, inbound.externalId), {
      actionType: 'create',
      tableName: 'botChatGroups',
      recordId: group._id,
      newValues: auditValues(linked),
    })
    const company = await ctx.db.get(group.companyId)
    return {
      type: 'reply',
      ...tgt,
      messages: [text(s.connected(company?.name ?? '', await scopeLabel(ctx, tgt.locale, linked), botUsername()))],
    }
  }
  let next: Doc<'botChatGroups'>['siteScope']
  if (arg === 'all') {
    if (member.siteScope !== 'all') return { type: 'reply', ...tgt, toast: s.onlyAllAdmin, messages: [] }
    next = group.siteScope === 'all' ? [] : 'all'
  } else {
    const siteId = ctx.db.normalizeId('farmLocations', arg)
    const sites = await activeSites(ctx, group.companyId, member.siteScope)
    if (!siteId || !sites.some((x) => x._id === siteId)) return { type: 'reply', ...tgt, toast: s.onlyOwnSites, messages: [] }
    const cur = group.siteScope === 'all' ? [] : group.siteScope
    next = cur.includes(siteId) ? cur.filter((x) => x !== siteId) : [...cur, siteId]
  }
  await ctx.db.patch(group._id, { siteScope: next, updatedAt: now })
  const updated = (await ctx.db.get(group._id))!
  return { type: 'reply', ...tgt, messages: [await pickerMessage(ctx, updated, member, tgt.locale)] }
}

/** /access: the scope and capability panel (admins of the group's organization). */
async function accessPanel(ctx: MutationCtx, bound: BoundMember, group: Doc<'botChatGroups'>, tgt: Target): Promise<RoutePlan> {
  const member = await adminIn(ctx, bound.account, group.companyId)
  if (!member) return { type: 'reply', ...tgt, messages: [text(gt(tgt.locale).needAdmin)] }
  return { type: 'reply', ...tgt, messages: [await accessMessage(ctx, group, member, tgt.locale)] }
}

/** ga:<all|s:siteId|c:cap|done>: one change on the /access panel, re-checked and audited. */
async function accessTap(ctx: MutationCtx, bound: BoundMember, arg: string, inbound: Doc<'channelInbound'>, tgt: Target): Promise<RoutePlan> {
  const s = gt(tgt.locale)
  const rows = await rowsForChat(ctx, inbound.address)
  const group = rows.find((g) => g.status === 'active')
  if (!group) return { type: 'reply', ...tgt, toast: s.notConnected, messages: [] }
  const member = await adminIn(ctx, bound.account, group.companyId)
  if (!member) return { type: 'reply', ...tgt, toast: s.needAdmin, toastAlert: true, messages: [] }
  if (arg === 'done') return { type: 'reply', ...tgt, messages: [text(s.accessSaved(await scopeLabel(ctx, tgt.locale, group)))] }
  const patch: Partial<Pick<Doc<'botChatGroups'>, 'siteScope' | 'caps'>> = {}
  if (arg === 'all') {
    if (member.siteScope !== 'all') return { type: 'reply', ...tgt, toast: s.onlyAllAdmin, messages: [] }
    if (group.siteScope === 'all') {
      // Off "all": keep every site, now one by one, so the admin can drop some.
      const sites = await activeSites(ctx, group.companyId, 'all')
      if (!sites.length) return { type: 'reply', ...tgt, toast: s.pickAtLeastOne, messages: [] }
      patch.siteScope = sites.map((x) => x._id)
    } else patch.siteScope = 'all'
  } else if (arg.startsWith('s:')) {
    const siteId = ctx.db.normalizeId('farmLocations', arg.slice(2))
    const mine = await activeSites(ctx, group.companyId, member.siteScope)
    if (!siteId || !mine.some((x) => x._id === siteId)) return { type: 'reply', ...tgt, toast: s.onlyOwnSites, messages: [] }
    const cur =
      group.siteScope === 'all' ? (await activeSites(ctx, group.companyId, 'all')).map((x) => x._id) : group.siteScope
    const next = cur.includes(siteId) ? cur.filter((x) => x !== siteId) : [...cur, siteId]
    if (!next.length) return { type: 'reply', ...tgt, toast: s.pickAtLeastOne, messages: [] }
    patch.siteScope = next
  } else if (arg.startsWith('c:')) {
    const cap = CAP_KEYS.find((k) => k === arg.slice(2))
    if (!cap) return { type: 'reply', ...tgt, toast: s.notHere, messages: [] }
    patch.caps = { ...group.caps, [cap]: !group.caps[cap] }
  } else {
    return { type: 'reply', ...tgt, toast: s.notHere, messages: [] }
  }
  await ctx.db.patch(group._id, { ...patch, updatedAt: Date.now() })
  const updated = (await ctx.db.get(group._id))!
  await logAudit(adminCtx(ctx, bound.account, member, inbound.externalId), {
    actionType: 'update',
    tableName: 'botChatGroups',
    recordId: group._id,
    previousValues: { siteScope: group.siteScope, caps: group.caps },
    newValues: { siteScope: updated.siteScope, caps: updated.caps },
  })
  return { type: 'reply', ...tgt, messages: [await accessMessage(ctx, updated, member, tgt.locale)] }
}

async function disconnect(ctx: MutationCtx, bound: BoundMember, group: Doc<'botChatGroups'>, inbound: Doc<'channelInbound'>, tgt: Target): Promise<RoutePlan> {
  const s = gt(tgt.locale)
  const member = await adminIn(ctx, bound.account, group.companyId)
  if (!member) return { type: 'reply', ...tgt, messages: [text(s.needAdmin)] }
  const now = Date.now()
  await ctx.db.patch(group._id, { status: 'revoked', revokedAt: now, revokedReason: 'disconnect', threadId: undefined, updatedAt: now })
  await logAudit(adminCtx(ctx, bound.account, member, inbound.externalId), {
    actionType: 'delete',
    tableName: 'botChatGroups',
    recordId: group._id,
    previousValues: auditValues(group),
    newValues: { status: 'revoked', reason: 'disconnect' },
  })
  const company = await ctx.db.get(group.companyId)
  return { type: 'reply', ...tgt, messages: [text(s.disconnected(company?.name ?? ''))] }
}

/**
 * A draft or approval button tapped in a group: only the person it is for.
 * Returns a refusal toast, or null when the tapper owns it.
 */
async function ownerCheck(ctx: MutationCtx, verb: string, arg: string, bindingId: Id<'channelBindings'>, tgt: Target): Promise<RoutePlan | null> {
  const s = gt(tgt.locale)
  if (['ok', 'dup', 'un', 'ed', 'no'].includes(verb)) {
    const id = ctx.db.normalizeId('pendingBotActions', arg)
    const draft = id ? await ctx.db.get(id) : null
    if (!draft || draft.companyId !== tgt.companyId) return { type: 'reply', ...tgt, toast: t(tgt.locale).notPending, messages: [] }
    if (draft.bindingId !== bindingId) return { type: 'reply', ...tgt, toast: s.onlyCanSave(await ownerName(ctx, draft.bindingId)), messages: [] }
    return null
  }
  if (['apr', 'rej', 'rr'].includes(verb)) {
    const cut = arg.lastIndexOf(':')
    const id = ctx.db.normalizeId('botApprovalPrompts', verb === 'rr' && cut > 0 ? arg.slice(0, cut) : arg)
    const prompt = id ? await ctx.db.get(id) : null
    if (!prompt || prompt.companyId !== tgt.companyId) return { type: 'reply', ...tgt, toast: t(tgt.locale).notPending, messages: [] }
    if (prompt.bindingId !== bindingId) return { type: 'reply', ...tgt, toast: s.onlyCanApprove(await ownerName(ctx, prompt.bindingId)), messages: [] }
    return null
  }
  return null
}

/** Group commands that only make sense in a private chat. */
const PRIVATE_ONLY = new Set(['site', 'org', 'stop', 'voice', 'voix', 'account', 'cancel'])

/**
 * One message or tap from a Telegram group. Called by inbound.route after the
 * row is marked processed.
 */
export async function groupRoute(ctx: MutationCtx, inbound: Doc<'channelInbound'>): Promise<RoutePlan> {
  if (inbound.provider !== 'telegram') return { type: 'none' }
  if (inbound.kind === 'member') return await memberEvent(ctx, inbound)
  const chatId = inbound.address
  const base = { provider: 'telegram' as const, address: chatId, callbackQueryId: inbound.callbackQueryId }
  const senderId = inbound.senderId
  if (!senderId || !/^\d{1,20}$/.test(senderId)) return { type: 'none' }
  if (await limited(ctx, 'botPerGroup', chatId)) {
    await ctx.db.patch(inbound._id, { status: 'ignored', error: 'rate_limited' })
    return { type: 'none' }
  }

  const binding = await liveBinding(ctx, 'telegram', senderId)
  if (!binding) return await unlinkedReply(ctx, inbound, base)
  await ctx.db.patch(inbound._id, { bindingId: binding._id })
  const checked = await checkBinding(ctx, binding)
  if (!checked.ok) {
    // Same as a private chat: the person's link is dead (left the org, account off).
    await ctx.db.patch(binding._id, { revokedAt: Date.now(), revokedReason: checked.problem, reminderEnabled: false })
    return await unlinkedReply(ctx, inbound, base)
  }
  const bound = checked.bound
  const locale = bound.locale
  const s = gt(locale)
  const isTap = inbound.kind === 'button'
  const senderName = firstName(inbound.profileName) || firstName(bound.account.name)
  const tgt: Target = {
    ...base,
    companyId: binding.companyId,
    bindingId: binding._id,
    locale,
    senderName,
    privateAddress: binding.address,
    ...(isTap ? { editMessageId: inbound.messageId } : { replyTo: inbound.messageId }),
  }
  if (
    (await limited(ctx, 'botPerBinding', binding._id)) ||
    (await limited(ctx, 'botPerBindingHour', binding._id)) ||
    (await limited(ctx, 'botPerCompany', binding.companyId))
  ) {
    await ctx.db.patch(inbound._id, { status: 'ignored', error: 'rate_limited' })
    return isTap ? { type: 'reply', ...tgt, toast: t(locale).rateLimited, messages: [] } : { type: 'reply', ...tgt, messages: [text(t(locale).rateLimited)] }
  }
  if (inbound.senderUsername !== binding.username) await ctx.db.patch(binding._id, { username: inbound.senderUsername })

  const rows = await rowsForChat(ctx, chatId)
  const active = rows.find((g) => g.status === 'active') ?? null

  if (isTap) {
    const raw = inbound.buttonId ?? ''
    const sep = raw.indexOf(':')
    const verb = sep > 0 ? raw.slice(0, sep) : raw
    const arg = sep > 0 ? raw.slice(sep + 1) : ''
    if (verb === 'gc') return await connectCompany(ctx, bound, arg, inbound, tgt)
    if (verb === 'gs') return await connectScope(ctx, bound, arg, inbound, tgt)
    if (verb === 'ga') return await accessTap(ctx, bound, arg, inbound, tgt)
    const refused = await ownerCheck(ctx, verb, arg, binding._id, tgt)
    if (refused) return refused
    if (!active || active.companyId !== binding.companyId) return { type: 'reply', ...tgt, toast: s.linkedOther, messages: [] }
    const g = await groupBound(ctx, bound, active)
    if (!g.ok) return { type: 'reply', ...tgt, toast: s.roleLimit, toastAlert: true, messages: [] }
    if (verb === 'sq') {
      const key = chatKey(inbound, senderName, binding.companyId)
      return (await scopeButton(ctx, g.bound, arg, key, tgt)) ?? { type: 'reply', ...tgt, toast: s.notHere, messages: [] }
    }
    const pendingId = ctx.db.normalizeId('pendingBotActions', arg)
    const source = inbound.externalId
    // The owner tapped their own draft or approval: the usual commit path, re-checked there.
    if ((verb === 'ok' || verb === 'dup') && pendingId && active.caps.log) {
      return { type: 'commit', ...tgt, bindingId: binding._id, pendingId, confirmDuplicate: verb === 'dup', sourceMessageId: source }
    }
    if (verb === 'un' && pendingId && active.caps.log) return { type: 'undo', ...tgt, bindingId: binding._id, pendingId, sourceMessageId: source }
    if (verb === 'apr') {
      const promptId = ctx.db.normalizeId('botApprovalPrompts', arg)
      if (promptId) return { type: 'approval', ...tgt, bindingId: binding._id, promptId, decision: 'approve', sourceMessageId: source }
    }
    return { type: 'reply', ...tgt, toast: s.notHere, messages: [] }
  }

  if (inbound.kind !== 'text') return { type: 'reply', ...tgt, messages: [text(s.mediaPrivate)] }
  const msgText = (inbound.text ?? '').trim()
  const cmdMatch = /^\/([a-z_]+)\b\s*(.*)$/is.exec(msgText)
  const cmd = cmdMatch?.[1].toLowerCase() ?? null
  const rest = cmdMatch ? cmdMatch[2].trim() : msgText

  if (cmd === 'connect') return await connect(ctx, bound, inbound, tgt, active)
  if (cmd === 'help' || cmd === 'start') {
    return { type: 'reply', ...tgt, messages: [text(active ? s.groupHelp(botUsername()) : `${s.groupHelp(botUsername())}\n\n${s.notConnected}`)] }
  }
  if (!active) return { type: 'reply', ...tgt, messages: [text(s.notConnected)] }
  if (active.companyId !== binding.companyId) {
    // Name the organization only to its own members.
    const member = await memberContextIn(ctx, bound.account, active.companyId)
    const company = member ? await ctx.db.get(active.companyId) : null
    return { type: 'reply', ...tgt, messages: [text(company ? s.linkedTo(company.name) : s.linkedOther)] }
  }
  if (cmd === 'disconnect') return await disconnect(ctx, bound, active, inbound, tgt)
  if (cmd === 'access') return await accessPanel(ctx, bound, active, tgt)
  if (cmd && PRIVATE_ONLY.has(cmd)) return { type: 'reply', ...tgt, messages: [text(s.privateOnly)] }

  const g = await groupBound(ctx, bound, active)
  if (!g.ok) return { type: 'reply', ...tgt, messages: [text(s.roleLimit)] }
  const nb = g.bound
  const tgtGroup: Target = { ...tgt, chatGroupId: active._id }

  if (cmd === 't' || cmd === 'round' || cmd === 'tournee') {
    if (!active.caps.log) return { type: 'reply', ...tgt, messages: [text(s.logOff)] }
    // Cards go to the sender's private chat; the group hears where.
    const priv = { provider: 'telegram' as const, address: binding.address, companyId: binding.companyId, bindingId: binding._id, locale }
    const plan =
      cmd === 't'
        ? await templatesCommand(ctx, nb, rest.split(/\s+/)[0]?.slice(0, 12) ?? '', priv, { sourceMessageId: inbound.externalId, sentAt: inbound.sentAt })
        : await roundCommand(ctx, nb, rest.slice(0, 4), priv)
    if (plan.type === 'none') return plan
    return { ...plan, notice: { address: chatId, text: s.sentCardsPrivately(senderName), replyTo: inbound.messageId } }
  }

  const key = chatKey(inbound, senderName, binding.companyId)
  if (cmd === 'today') {
    if (!active.caps.ask) return { type: 'reply', ...tgt, messages: [text(s.askOff)] }
    return await summaryPlan(ctx, nb, rest, key, tgtGroup, { scope: { kind: 'all' }, range: 'today' })
  }
  if (cmd === 'summary' || cmd === 'report' || cmd === 'bilan') {
    if (!active.caps.ask) return { type: 'reply', ...tgt, messages: [text(s.askOff)] }
    return await summaryPlan(ctx, nb, rest, key, tgtGroup)
  }
  if (cmd) return { type: 'reply', ...tgt, messages: [text(s.groupHelp(botUsername()))] }
  if (!msgText) return { type: 'reply', ...tgt, messages: [text(s.groupHelp(botUsername()))] }

  if (active.caps.ask) {
    const cage = await awaitingCage(ctx, nb, msgText, key, tgtGroup)
    if (cage) return cage
    if (wantsSummary(msgText, await recall(ctx, key))) return await summaryPlan(ctx, nb, msgText, key, tgtGroup)
  }
  if (!active.caps.ask && !active.caps.log) return { type: 'reply', ...tgt, messages: [text(s.askOff)] }
  return {
    type: 'agent',
    ...tgtGroup,
    bindingId: binding._id,
    siteId: await namedSite(ctx, nb, msgText),
    text: msgText,
    sourceMessageId: inbound.externalId,
    sentAt: inbound.sentAt,
  }
}

function chatKey(inbound: Doc<'channelInbound'>, senderName: string, companyId: Id<'companies'>): ChatKey {
  return { provider: 'telegram', chatAddress: inbound.address, senderKey: inbound.senderId ?? inbound.address, senderName, companyId }
}

// ── Group alerts (keeper reminders, water alerts) ───────────────────────────

/**
 * Post an alert to the linked groups of `companyId` that have alerts on and
 * see `locationId`, tagging the responsible person. Best effort; scheduled.
 */
export async function postGroupAlert(
  ctx: MutationCtx,
  a: {
    companyId: Id<'companies'>
    locationId?: Id<'farmLocations'>
    /** Plain text (escaped here), per language: the group speaks its linker's language. */
    text: (locale: BotLocale) => string
    mentionUserId?: Id<'users'>
  },
): Promise<number> {
  const groups = await ctx.db
    .query('botChatGroups')
    .withIndex('by_companyId_and_status', (q) => q.eq('companyId', a.companyId).eq('status', 'active'))
    .take(50)
  const targets = groups.filter(
    (g) => g.caps.alerts && (g.siteScope === 'all' || (!!a.locationId && g.siteScope.includes(a.locationId))),
  )
  if (!targets.length) return 0
  let tag = ''
  if (a.mentionUserId) {
    const user = await ctx.db.get(a.mentionUserId)
    const binding = (
      await ctx.db
        .query('channelBindings')
        .withIndex('by_userId', (q) => q.eq('userId', a.mentionUserId!))
        .take(10)
    ).find((b) => b.provider === 'telegram' && !b.revokedAt && b.companyId === a.companyId)
    tag = binding
      ? telegramMention({ userId: binding.address, username: binding.username, name: firstName(user?.name) || firstName(binding.displayName) })
      : esc(firstName(user?.name))
  }
  for (const g of targets) {
    const linker = await ctx.db.get(g.linkedBy)
    const text = esc(a.text(botLocale(linker?.locale)))
    await ctx.scheduler.runAfter(0, internal.bot.chatGroups.sendAlert, { chatId: g.chatId, text: tag ? `${tag} ${text}` : text })
  }
  return targets.length
}

export const sendAlert = internalAction({
  args: { chatId: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (_ctx, { chatId, text: body }) => {
    const token = telegramBotToken()
    if (!token) return null
    const r = await sendTelegramChat(token, chatId, { kind: 'keyboard', html: true, text: body, rows: [] })
    if (!r.ok) console.warn(`[bot] group alert: ${r.error.slice(0, 200)}`)
    return null
  },
})

/** The bot was removed or the group is gone: Telegram tells us on send (403 / chat not found). */
export const revokeChat = internalMutation({
  args: { chatId: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { chatId, reason }) => {
    const now = Date.now()
    for (const g of await rowsForChat(ctx, chatId)) {
      if (g.status === 'revoked') continue
      await ctx.db.patch(g._id, { status: 'revoked', revokedAt: now, revokedReason: reason.slice(0, 60), threadId: undefined, updatedAt: now })
      await insertAuditLog(ctx, {
        actionType: 'delete',
        tableName: 'botChatGroups',
        recordId: g._id,
        previousValues: auditValues(g),
        newValues: { status: 'revoked', reason },
        companyId: g.companyId,
        channel: 'telegram',
      })
    }
    return null
  },
})

// ── Web: Settings › Messaging › Telegram groups ─────────────────────────────

const groupRow = v.object({
  _id: v.id('botChatGroups'),
  title: v.string(),
  status: v.union(v.literal('pending'), v.literal('active'), v.literal('revoked')),
  allSites: v.boolean(),
  siteIds: v.array(v.id('farmLocations')),
  caps: groupCaps,
  linkedByName: v.union(v.string(), v.null()),
  linkedAt: v.union(v.number(), v.null()),
  revokedAt: v.union(v.number(), v.null()),
  revokedReason: v.union(v.string(), v.null()),
})

/** Linked Telegram groups of the caller's organization (admins). */
export const list = query({
  args: {},
  returns: v.object({
    groups: v.array(groupRow),
    sites: v.array(v.object({ _id: v.id('farmLocations'), name: v.string() })),
    canAll: v.boolean(),
    botUsername: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'integrations.manage' })
    const companyId = m.companyId
    if (!companyId) return { groups: [], sites: [], canAll: false, botUsername: null }
    const rows = await ctx.db
      .query('botChatGroups')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(100)
    const groups = []
    for (const g of rows) {
      if (g.status === 'pending') continue
      const by = await ctx.db.get(g.linkedBy)
      groups.push({
        _id: g._id,
        title: g.title,
        status: g.status,
        allSites: g.siteScope === 'all',
        siteIds: g.siteScope === 'all' ? [] : g.siteScope,
        caps: g.caps,
        linkedByName: by?.name ?? null,
        linkedAt: g.linkedAt ?? null,
        revokedAt: g.revokedAt ?? null,
        revokedReason: g.revokedReason ?? null,
      })
    }
    const sites = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(100)
    return {
      groups,
      sites: sites
        .filter((s) => s.active !== false && (m.siteScope === 'all' || m.siteScope.has(s._id)))
        .map((s) => ({ _id: s._id, name: s.name })),
      canAll: m.siteScope === 'all',
      botUsername: botUsername() || null,
    }
  },
})

async function ownGroup(ctx: MutationCtx, m: MemberContext, groupId: Id<'botChatGroups'>) {
  const g = await ctx.db.get(groupId)
  // Another org's group is "not found", never "forbidden": no existence leak.
  if (!g || !m.companyId || g.companyId !== m.companyId) throw userError('NOT_FOUND', 'Group not found')
  return { m, g }
}

/** Change a group's sites or capabilities from the web. Sites must be the admin's own. */
export const update = mutation({
  args: {
    groupId: v.id('botChatGroups'),
    allSites: v.optional(v.boolean()),
    siteIds: v.optional(v.array(v.id('farmLocations'))),
    caps: v.optional(groupCaps),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const m = await requireMember(ctx, { permission: 'integrations.manage' })
    const { g } = await ownGroup(ctx, m, a.groupId)
    if (g.status !== 'active') throw userError('VALIDATION', 'This group is not linked.')
    let siteScope = g.siteScope
    if (a.allSites) {
      if (m.siteScope !== 'all') throw userError('FORBIDDEN', 'Only someone who sees all farm locations can open a group to all of them.')
      siteScope = 'all'
    } else if (a.siteIds) {
      const ids = [...new Set(a.siteIds)].slice(0, 100)
      if (!ids.length) throw userError('VALIDATION', 'Pick at least one site.')
      const prev = g.siteScope === 'all' ? null : new Set(g.siteScope)
      for (const id of ids) {
        const site = await ctx.db.get(id)
        if (!site || site.companyId !== g.companyId) throw userError('NOT_FOUND', 'Site not found')
        // A site the admin cannot see may stay, but not be added.
        if (m.siteScope !== 'all' && !m.siteScope.has(id) && !prev?.has(id)) {
          throw userError('FORBIDDEN', 'You can only add sites you can see yourself.')
        }
      }
      siteScope = ids
    }
    const caps = a.caps ?? g.caps
    await ctx.db.patch(g._id, { siteScope, caps, updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'botChatGroups',
      recordId: g._id,
      previousValues: { siteScope: g.siteScope, caps: g.caps },
      newValues: { siteScope, caps },
    })
    return null
  },
})

/** Unlink a group from the web. The bot stays in the group but answers only /connect. */
export const unlink = mutation({
  args: { groupId: v.id('botChatGroups') },
  returns: v.null(),
  handler: async (ctx, { groupId }) => {
    const { g } = await ownGroup(ctx, await requireMember(ctx, { permission: 'integrations.manage' }), groupId)
    if (g.status === 'revoked') return null
    const now = Date.now()
    await ctx.db.patch(g._id, { status: 'revoked', revokedAt: now, revokedReason: 'web', threadId: undefined, pendingBy: undefined, updatedAt: now })
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'botChatGroups',
      recordId: g._id,
      previousValues: auditValues(g),
      newValues: { status: 'revoked', reason: 'web' },
    })
    return null
  },
})
