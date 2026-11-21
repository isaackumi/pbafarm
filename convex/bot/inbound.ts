/**
 * Inbound pipeline (BOT-001, doc 23 §2). The httpAction verifies the
 * signature and calls `ingest`, which stores each message once per
 * (provider, externalId) and schedules `process.handle`. `route` then decides,
 * in one transaction, what the message means: onboarding, a link code, a
 * command, a button, or free text for the agent. Every text and button id is
 * untrusted input.
 */
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { memberContextIn } from '../lib/permissions'
import { rateLimiter } from '../lib/rateLimits'
import { siteUrl } from '../lib/email'
import { todayIn } from '../lib/dates'
import { botProvider, inboundGroupFields } from './tables'
import { routePlan, type RoutePlan, type ChatMessageValue, type Target } from './validators'
import { botLocale, t, type BotLocale } from './i18n'
import { checkBinding, companiesOf, liveBinding, type BoundMember } from './scope'
import { codeHash, revokeBindingsForUser, shortCodeHash } from './bindings'
import { parseShortCode } from '../lib/tokens'
import { closeDraft } from './pending'
import { logbookButton, logbookPlan } from './logbook'
import { voiceButton, voiceCommand, voicePlan } from './voice'
import { roundButton, roundCommand } from './rounds'
import { deadReply, groupButton } from './groups'
import { awaitingInput, templateButton, templatesCommand } from './templates'
import { MAX_EVENT_AGE_MS } from './verify'
import { groupRoute } from './chatGroups'
import { awaitingCage, namedSite, pruneScopes, recall, scopeButton, summaryPlan, wantsSummary, type ChatKey } from './summary'
import { REJECT_REASON_CODES, MAX_REASON_CHARS, askRejectReason, awaitingReason, keepPending } from './approvals'

const inboundEvent = v.object({
  provider: botProvider,
  externalId: v.string(),
  address: v.string(),
  kind: v.union(
    v.literal('text'),
    v.literal('button'),
    v.literal('image'),
    v.literal('audio'),
    v.literal('member'),
    v.literal('unsupported'),
  ),
  text: v.optional(v.string()),
  buttonId: v.optional(v.string()),
  callbackQueryId: v.optional(v.string()),
  profileName: v.optional(v.string()),
  mediaId: v.optional(v.string()),
  mediaMime: v.optional(v.string()),
  mediaSize: v.optional(v.number()),
  ...inboundGroupFields,
  sentAt: v.number(),
})

const statusEvent = v.object({
  providerMessageId: v.string(),
  status: v.string(),
  billable: v.optional(v.boolean()),
  pricingModel: v.optional(v.string()),
  category: v.optional(v.string()),
  pricingType: v.optional(v.string()),
})

/** Store new messages (duplicates are no-ops) and schedule their processing. */
export const ingest = internalMutation({
  args: { events: v.array(inboundEvent), statuses: v.array(statusEvent) },
  returns: v.object({ inserted: v.number(), duplicates: v.number() }),
  handler: async (ctx, { events, statuses }) => {
    let inserted = 0
    let duplicates = 0
    const now = Date.now()
    for (const e of events.slice(0, 50)) {
      // A replay older than the dedupe window could otherwise run again.
      if (e.sentAt < now - MAX_EVENT_AGE_MS) continue
      const prior = await ctx.db
        .query('channelInbound')
        .withIndex('by_provider_and_externalId', (q) => q.eq('provider', e.provider).eq('externalId', e.externalId))
        .first()
      if (prior) {
        duplicates++
        continue
      }
      const id = await ctx.db.insert('channelInbound', { ...e, receivedAt: now, status: 'queued' })
      await ctx.scheduler.runAfter(0, internal.bot.process.handle, { inboundId: id })
      inserted++
    }
    // Meta's per-message pricing, for the org's WhatsApp cost report.
    for (const s of statuses.slice(0, 50)) {
      const row = await ctx.db
        .query('channelMessageCosts')
        .withIndex('by_providerMessageId', (q) => q.eq('providerMessageId', s.providerMessageId))
        .first()
      if (!row) continue
      await ctx.db.patch(row._id, {
        status: s.status,
        billable: s.billable ?? row.billable,
        pricingModel: s.pricingModel ?? row.pricingModel,
        category: s.category ?? row.category,
        pricingType: s.pricingType ?? row.pricingType,
        updatedAt: now,
      })
    }
    return { inserted, duplicates }
  },
})

const LINK_RE = /^\s*(?:link|code|lier)\s*:?\s*(\d{6})\s*$/i
const START_RE = /^\s*\/start\s+([0-9a-f]{64})\s*$/i
const START_BARE_RE = /^\s*\/start\s*$/i
/** "/start K7Q-42P", "link K7Q42P", "code: k7q 42p": the part after the keyword. */
const TG_PREFIXED_RE = /^\s*(?:\/start|link|code|lier)\s*:?\s+(.+?)\s*$/i

/** A link attempt: WhatsApp code, Telegram deep-link token, or Telegram short code. */
type LinkAttempt = { kind: 'code' | 'token' | 'short'; value: string }

/**
 * Reads a link attempt from a text message. A bare Telegram short code counts
 * only from a chat that is not linked yet, so a linked user's ordinary
 * message is never taken for one; a linked chat re-links with the deep link
 * or "link K7Q-42P".
 */
export function linkAttempt(provider: 'whatsapp' | 'telegram', msgText: string, bound: boolean): LinkAttempt | null {
  if (provider === 'whatsapp') {
    const code = LINK_RE.exec(msgText)?.[1]
    return code ? { kind: 'code', value: code } : null
  }
  const token = START_RE.exec(msgText)?.[1]
  if (token) return { kind: 'token', value: token }
  const prefixed = TG_PREFIXED_RE.exec(msgText)?.[1]
  const short = prefixed ? parseShortCode(prefixed) : bound ? null : parseShortCode(msgText)
  return short ? { kind: 'short', value: short } : null
}

async function liveBareShortCode(ctx: MutationCtx, msgText: string): Promise<LinkAttempt | null> {
  const short = parseShortCode(msgText)
  if (!short) return null
  const now = Date.now()
  const hash = await shortCodeHash(short)
  const rows = await ctx.db
    .query('channelConnectCodes')
    .withIndex('by_provider_and_shortCodeHash', (q) => q.eq('provider', 'telegram').eq('shortCodeHash', hash))
    .take(5)
  return rows.some((c) => !c.usedAt && c.expiresAt > now) ? { kind: 'short', value: short } : null
}

function text(msg: string): ChatMessageValue {
  return { kind: 'text', text: msg }
}

async function sitesFor(ctx: MutationCtx, bound: BoundMember) {
  const rows = await ctx.db
    .query('farmLocations')
    .withIndex('by_company', (q) => q.eq('companyId', bound.binding.companyId))
    .take(100)
  return rows.filter(
    (s) => s.active !== false && (bound.member.siteScope === 'all' || bound.member.siteScope.has(s._id)),
  )
}

function sitePicker(locale: BotLocale, sites: Doc<'farmLocations'>[], allowAll: boolean): ChatMessageValue {
  const s = t(locale)
  const rows = sites.slice(0, allowAll ? 9 : 10).map((x) => ({ id: `site:${x._id}`, title: x.name.slice(0, 24) }))
  if (allowAll) rows.push({ id: 'site:all', title: s.allSites })
  return { kind: 'list', text: s.chooseSite, button: s.pick, rows }
}

function orgPicker(locale: BotLocale, companies: Doc<'companies'>[]): ChatMessageValue {
  const s = t(locale)
  return {
    kind: 'list',
    text: s.chooseCompany,
    button: s.pick,
    rows: companies.slice(0, 10).map((c) => ({ id: `org:${c._id}`, title: c.name.slice(0, 24) })),
  }
}

/** After binding or changing org: offer a site list when the member sees more than one site. */
async function maybeSitePicker(ctx: MutationCtx, bound: BoundMember): Promise<ChatMessageValue[]> {
  const sites = await sitesFor(ctx, bound)
  if (sites.length <= 1) return []
  return [sitePicker(bound.locale, sites, bound.member.siteScope === 'all')]
}

/**
 * LINK <code> (WhatsApp), /start <token> or a typed short code (Telegram):
 * bind this chat to the code's user and org.
 */
async function link(
  ctx: MutationCtx,
  inbound: Doc<'channelInbound'>,
  attempt: LinkAttempt,
  base: Omit<Target, 'locale'>,
): Promise<RoutePlan> {
  const now = Date.now()
  let locale: BotLocale = 'en'
  const isShort = attempt.kind === 'short'
  const chatKey = `${inbound.provider}:${inbound.address}`
  if (
    isShort &&
    (!(await rateLimiter.check(ctx, 'botLinkCodeFailGlobal', { key: 'all' })).ok ||
      !(await rateLimiter.check(ctx, 'botLinkCodeFailPerChatDaily', { key: chatKey })).ok)
  ) {
    // Paused, not "bad code": a real user learns to use the link instead.
    return { type: 'reply', ...base, locale, messages: [text(t(locale).linkCodePaused)] }
  }
  const hash = isShort ? await shortCodeHash(attempt.value) : await codeHash(inbound.provider, attempt.value)
  const rows = isShort
    ? await ctx.db
        .query('channelConnectCodes')
        .withIndex('by_provider_and_shortCodeHash', (q) => q.eq('provider', 'telegram').eq('shortCodeHash', hash))
        .take(5)
    : await ctx.db
        .query('channelConnectCodes')
        .withIndex('by_provider_and_codeHash', (q) => q.eq('provider', inbound.provider).eq('codeHash', hash))
        .take(5)
  let candidates = rows.filter((c) => !c.usedAt && c.expiresAt > now)
  if (inbound.provider === 'whatsapp') {
    // The code must belong to a user whose verified phone is this sender.
    const users = await ctx.db
      .query('users')
      .withIndex('phone', (q) => q.eq('phone', inbound.address))
      .take(10)
    const verified = users.filter((u) => u.phoneVerificationTime && u.active !== false)
    if (!verified.length) return { type: 'reply', ...base, locale, messages: [text(t(locale).linkPhoneMismatch)] }
    locale = botLocale(verified[0].locale)
    candidates = candidates.filter((c) => verified.some((u) => u._id === c.userId))
  }
  const code0 = candidates.length === 1 ? candidates[0] : null
  if (!code0) {
    if (isShort) {
      await rateLimiter.limit(ctx, 'botLinkCodeFailGlobal', { key: 'all' })
      await rateLimiter.limit(ctx, 'botLinkCodeFailPerChatDaily', { key: chatKey })
    }
    return { type: 'reply', ...base, locale, messages: [text(t(locale).linkBadCode)] }
  }
  await ctx.db.patch(code0._id, { usedAt: now })
  const user = await ctx.db.get(code0.userId)
  locale = botLocale(user?.locale)
  if (!user || user.active === false || !(await memberContextIn(ctx, user, code0.companyId))) {
    return { type: 'reply', ...base, locale, messages: [text(t(locale).noOrg)] }
  }
  // One live binding per chat and per user+provider.
  const others = await ctx.db
    .query('channelBindings')
    .withIndex('by_provider_and_address', (q) => q.eq('provider', inbound.provider).eq('address', inbound.address))
    .take(20)
  for (const b of others) {
    if (!b.revokedAt) await ctx.db.patch(b._id, { revokedAt: now, revokedReason: 'relinked', reminderEnabled: false })
  }
  await revokeBindingsForUser(ctx, user._id, 'relinked', { provider: inbound.provider })
  const bindingId = await ctx.db.insert('channelBindings', {
    provider: inbound.provider,
    address: inbound.address,
    userId: user._id,
    companyId: code0.companyId,
    verifiedAt: now,
    displayName: inbound.profileName,
    lastInboundAt: now,
  })
  const binding = (await ctx.db.get(bindingId))!
  const checked = await checkBinding(ctx, binding)
  if (!checked.ok) {
    await ctx.db.patch(bindingId, { revokedAt: now, revokedReason: checked.problem })
    return { type: 'reply', ...base, locale, messages: [text(t(locale).bindingInactive)] }
  }
  const bound = checked.bound
  // Start on the user's current site in the web app when it is in scope.
  if (user.activeLocationId) {
    const site = await ctx.db.get(user.activeLocationId)
    if (
      site &&
      site.companyId === code0.companyId &&
      site.active !== false &&
      (bound.member.siteScope === 'all' || bound.member.siteScope.has(site._id))
    ) {
      await ctx.db.patch(bindingId, { activeSiteId: site._id })
      bound.site = site
    }
  }
  const s = t(locale)
  const messages: ChatMessageValue[] = [text(`${s.linked(user.name ?? '', bound.company.name)}\n${s.help}`)]
  if (!bound.site) messages.push(...(await maybeSitePicker(ctx, bound)))
  await ctx.db.patch(inbound._id, { bindingId })
  return { type: 'reply', ...base, companyId: bound.company._id, bindingId, locale, messages }
}

type BotLimit = 'botPerBinding' | 'botPerBindingHour' | 'botPerCompany' | 'botUnboundPerAddress' | 'botUnboundGlobal'

async function limited(ctx: MutationCtx, name: BotLimit, key: string) {
  const r = await rateLimiter.limit(ctx, name, { key })
  return !r.ok
}

/**
 * What to do with one inbound message. Runs once per message: the status
 * moves off `queued` in the same transaction.
 */
export const route = internalMutation({
  args: { inboundId: v.id('channelInbound') },
  returns: routePlan,
  handler: async (ctx, { inboundId }): Promise<RoutePlan> => {
    const inbound = await ctx.db.get(inboundId)
    if (!inbound || inbound.status !== 'queued') return { type: 'none' }
    await ctx.db.patch(inboundId, { status: 'processed' })
    // Telegram groups (VFQ-1) have their own gate: sender's binding, the group's org and scope.
    if (inbound.chatType === 'group' || inbound.kind === 'member') return await groupRoute(ctx, inbound)
    const base = { provider: inbound.provider, address: inbound.address, callbackQueryId: inbound.callbackQueryId }
    const msgText = (inbound.text ?? '').trim()

    const binding = await liveBinding(ctx, inbound.provider, inbound.address)
    // Link attempts come first: they replace any older binding of this chat.
    let linkCode = inbound.kind === 'text' ? linkAttempt(inbound.provider, msgText, !!binding) : null
    // A linked chat may paste a fresh bare code (re-link or switch farm, as
    // /account says): link only if a live code matches, so the code never
    // reaches the agent or its transcript. No match: an ordinary message,
    // and no failure is counted.
    if (!linkCode && binding && inbound.kind === 'text' && inbound.provider === 'telegram') {
      linkCode = await liveBareShortCode(ctx, msgText)
    }
    if (!binding || linkCode) {
      // Unbound (or linking): strict limits, onboarding text only, no LLM.
      if (
        (await limited(ctx, 'botUnboundPerAddress', `${inbound.provider}:${inbound.address}`)) ||
        (await limited(ctx, 'botUnboundGlobal', 'all'))
      ) {
        await ctx.db.patch(inboundId, { status: 'ignored', error: 'rate_limited' })
        return { type: 'none' }
      }
      if (linkCode) return await link(ctx, inbound, linkCode, base)
      const locale: BotLocale = 'en'
      const s = t(locale)
      const hint = inbound.provider === 'whatsapp' ? `\n${s.linkHowTo}` : ''
      if (inbound.provider === 'telegram' && START_BARE_RE.test(msgText)) {
        return { type: 'reply', ...base, locale, messages: [text(s.onboarding(siteUrl()))] }
      }
      return { type: 'reply', ...base, locale, messages: [text(`${s.onboarding(siteUrl())}${hint}`)] }
    }

    await ctx.db.patch(inboundId, { bindingId: binding._id })
    const checked = await checkBinding(ctx, binding)
    if (!checked.ok) {
      // Phone changed, membership ended, org suspended: the binding is dead.
      await ctx.db.patch(binding._id, { revokedAt: Date.now(), revokedReason: checked.problem, reminderEnabled: false })
      return { type: 'reply', ...base, locale: checked.locale, messages: [text(t(checked.locale).bindingInactive)] }
    }
    const bound = checked.bound
    const locale = bound.locale
    const s = t(locale)
    const tgt = { ...base, companyId: binding.companyId, bindingId: binding._id, locale }

    if (
      (await limited(ctx, 'botPerBinding', binding._id)) ||
      (await limited(ctx, 'botPerBindingHour', binding._id)) ||
      (await limited(ctx, 'botPerCompany', binding.companyId))
    ) {
      await ctx.db.patch(inboundId, { status: 'ignored', error: 'rate_limited' })
      return { type: 'reply', ...tgt, messages: [text(s.rateLimited)] }
    }
    await ctx.db.patch(binding._id, {
      lastInboundAt: Date.now(),
      displayName: inbound.profileName ?? binding.displayName,
    })

    if (inbound.kind === 'unsupported') return { type: 'reply', ...tgt, messages: [text(s.unsupported)] }
    // A photo of a logbook page (BOT-006): read into drafts by the processing action.
    if (inbound.kind === 'image') return logbookPlan(inbound, { ...tgt, bindingId: binding._id })
    // A voice note (BOT-005): transcribed into drafts by the voice workflow.
    if (inbound.kind === 'audio') return await voicePlan(ctx, inbound, bound, { ...tgt, bindingId: binding._id })

    if (inbound.kind === 'button') {
      const raw = inbound.buttonId ?? ''
      const sep = raw.indexOf(':')
      const verb = sep > 0 ? raw.slice(0, sep) : raw
      const arg = sep > 0 ? raw.slice(sep + 1) : ''
      const pendingId = ctx.db.normalizeId('pendingBotActions', arg)
      const source = { sourceMessageId: inbound.externalId, sentAt: inbound.sentAt }
      const bt = { ...tgt, bindingId: binding._id }
      // Morning round (T1a/T1b), draft groups and templates (T2a).
      const flowPlan =
        (await roundButton(ctx, bound, verb, arg, bt, source)) ??
        (await groupButton(ctx, bound, verb, arg, bt, inbound.externalId)) ??
        (await templateButton(ctx, bound, verb, arg, bt, source))
      if (flowPlan) return flowPlan
      const scanPlan = await logbookButton(ctx, bound, verb, arg, { ...tgt, bindingId: binding._id }, inbound.externalId)
      if (scanPlan) return scanPlan
      const voiceReply = await voiceButton(ctx, bound, verb, arg, { ...tgt, bindingId: binding._id }, inbound.externalId)
      if (voiceReply) return voiceReply
      if (verb === 'sq') {
        const r = await scopeButton(ctx, bound, arg, privateKey(inbound, binding.companyId), tgt)
        if (r) return r
      }
      switch (verb) {
        case 'ok':
        case 'dup':
          if (!pendingId) break
          return {
            type: 'commit',
            ...tgt,
            bindingId: binding._id,
            pendingId,
            confirmDuplicate: verb === 'dup',
            sourceMessageId: inbound.externalId,
          }
        case 'un':
          if (!pendingId) break
          return { type: 'undo', ...tgt, bindingId: binding._id, pendingId, sourceMessageId: inbound.externalId }
        case 'ed':
        case 'no': {
          if (!pendingId) break
          const r = await closeDraft(ctx, binding._id, pendingId)
          const msg = r === 'closed' ? (verb === 'ed' ? s.editPrompt : s.cancelled) : s.notPending
          return { type: 'reply', ...tgt, messages: [text(msg)] }
        }
        case 'site': {
          if (arg === 'all') {
            if (bound.member.siteScope !== 'all') break
            await ctx.db.patch(binding._id, { activeSiteId: undefined })
            return { type: 'reply', ...tgt, messages: [text(s.siteSet(s.allSites))] }
          }
          const siteId = ctx.db.normalizeId('farmLocations', arg)
          const sites = await sitesFor(ctx, bound)
          const site = siteId ? sites.find((x) => x._id === siteId) : undefined
          if (!site) break
          await ctx.db.patch(binding._id, { activeSiteId: site._id })
          return { type: 'reply', ...tgt, messages: [text(s.siteSet(site.name))] }
        }
        case 'org': {
          const companyId = ctx.db.normalizeId('companies', arg)
          const companies = await companiesOf(ctx, bound.account)
          const company = companyId ? companies.find((c) => c._id === companyId) : undefined
          if (!company) break
          // A fresh agent thread per org so one org's data never sits in another's context.
          await ctx.db.patch(binding._id, { companyId: company._id, activeSiteId: undefined, threadId: undefined })
          const next = await checkBinding(ctx, (await ctx.db.get(binding._id))!)
          const more = next.ok ? await maybeSitePicker(ctx, next.bound) : []
          return {
            type: 'reply',
            ...tgt,
            companyId: company._id,
            messages: [text(s.companySet(company.name)), ...more],
          }
        }
        // Approvals (BOT-007): the decision runs in its own mutation from the action.
        case 'apr': {
          const promptId = ctx.db.normalizeId('botApprovalPrompts', arg)
          if (!promptId) break
          return {
            type: 'approval',
            ...tgt,
            bindingId: binding._id,
            promptId,
            decision: 'approve',
            sourceMessageId: inbound.externalId,
          }
        }
        case 'rej': {
          const promptId = ctx.db.normalizeId('botApprovalPrompts', arg)
          if (!promptId) break
          return { type: 'reply', ...tgt, messages: await askRejectReason(ctx, promptId, binding._id, locale) }
        }
        case 'rr': {
          const cut = arg.lastIndexOf(':')
          const promptId = cut > 0 ? ctx.db.normalizeId('botApprovalPrompts', arg.slice(0, cut)) : null
          const code = REJECT_REASON_CODES.find((c) => c === arg.slice(cut + 1))
          if (!promptId || !code) break
          return {
            type: 'approval',
            ...tgt,
            bindingId: binding._id,
            promptId,
            decision: 'reject',
            reason: s.rejectReasons[code],
            sourceMessageId: inbound.externalId,
          }
        }
        case 'rem': {
          if (arg === 'stop') {
            await ctx.db.patch(binding._id, { reminderEnabled: false })
            return { type: 'reply', ...tgt, messages: [text(s.remindersStopped)] }
          }
          if (arg === 'later') {
            const today = todayIn(binding.reminderTimezone ?? undefined)
            await ctx.db.patch(binding._id, { lastReminderDate: today })
            return { type: 'reply', ...tgt, messages: [text(s.laterOk)] }
          }
          if (arg === 'enter') return { type: 'reply', ...tgt, messages: [text(s.help)] }
          break
        }
      }
      return { type: 'reply', ...tgt, messages: [text(s.notPending)] }
    }

    const command = msgText.toUpperCase()
    if (command === 'HELP' || command === 'AIDE' || command === '?' || command === '/HELP' || START_BARE_RE.test(msgText)) {
      return { type: 'reply', ...tgt, messages: [text(s.help)] }
    }
    if (command === 'SITE' || command === '/SITE') {
      const sites = await sitesFor(ctx, bound)
      if (!sites.length) return { type: 'reply', ...tgt, messages: [text(s.help)] }
      return { type: 'reply', ...tgt, messages: [sitePicker(locale, sites, bound.member.siteScope === 'all')] }
    }
    if (command === 'ORG' || command === '/ORG') {
      const companies = await companiesOf(ctx, bound.account)
      if (companies.length <= 1) return { type: 'reply', ...tgt, messages: [text(s.companySet(bound.company.name))] }
      return { type: 'reply', ...tgt, messages: [orgPicker(locale, companies)] }
    }
    const tArg = /^\/t(?:@\w+)?(?:\s+(\S{1,12}))?\s*$/i.exec(msgText)
    if (tArg) {
      return await templatesCommand(ctx, bound, tArg[1] ?? '', { ...tgt, bindingId: binding._id }, {
        sourceMessageId: inbound.externalId,
        sentAt: inbound.sentAt,
      })
    }
    const roundArg = /^\/?(?:ROUND|TOURNEE|TOURNÉE)\b\s*(ON|OFF)?\s*$/i.exec(msgText)
    if (roundArg) return await roundCommand(ctx, bound, roundArg[1] ?? '', { ...tgt, bindingId: binding._id })
    const voiceArg = /^\/?(?:VOICE|VOIX)\b\s*(.*)$/i.exec(msgText)
    if (voiceArg) return { type: 'reply', ...tgt, messages: [text(await voiceCommand(ctx, bound, voiceArg[1].slice(0, 20)))] }
    if (command === 'STOP' || command === '/STOP') {
      await ctx.db.patch(binding._id, { revokedAt: Date.now(), revokedReason: 'user_stop', reminderEnabled: false })
      return { type: 'reply', ...tgt, messages: [text(s.disconnected)] }
    }
    if (!msgText) return { type: 'reply', ...tgt, messages: [text(s.help)] }
    // After Reject (BOT-007) the next text message is the reason, or CANCEL.
    const waiting = await awaitingReason(ctx, binding._id)
    if (waiting) {
      if (command === 'CANCEL' || command === '/CANCEL' || command === 'ANNULER') {
        await keepPending(ctx, waiting._id)
        return { type: 'reply', ...tgt, messages: [text(s.rejectKept)] }
      }
      return {
        type: 'approval',
        ...tgt,
        bindingId: binding._id,
        promptId: waiting._id,
        decision: 'reject',
        reason: msgText.slice(0, MAX_REASON_CHARS),
        sourceMessageId: inbound.externalId,
      }
    }
    // A water-check template waiting for its readings, then "C-11 3 dead" on an open group (no LLM).
    const flowText =
      (await awaitingInput(ctx, bound, msgText, { ...tgt, bindingId: binding._id }, { sourceMessageId: inbound.externalId, sentAt: inbound.sentAt })) ??
      (await deadReply(ctx, bound, msgText, { ...tgt, bindingId: binding._id }))
    if (flowText) return flowText
    // "get me summary from offshore": the scope resolver, then a report from the records (no LLM).
    const key = privateKey(inbound, binding.companyId)
    const cage = await awaitingCage(ctx, bound, msgText, key, tgt)
    if (cage) return cage
    if (wantsSummary(msgText, await recall(ctx, key))) return await summaryPlan(ctx, bound, msgText, key, tgt)
    return {
      type: 'agent',
      ...tgt,
      bindingId: binding._id,
      siteId: await namedSite(ctx, bound, msgText),
      text: msgText,
      sourceMessageId: inbound.externalId,
      sentAt: inbound.sentAt,
    }
  },
})

/** The memory key of a private chat: the chat address is the person. */
function privateKey(inbound: Doc<'channelInbound'>, companyId: Id<'companies'>): ChatKey {
  return { provider: inbound.provider, chatAddress: inbound.address, senderKey: inbound.address, senderName: inbound.profileName, companyId }
}

/** Close out an inbound message after processing. */
export const finish = internalMutation({
  args: { inboundId: v.id('channelInbound'), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { inboundId, error }) => {
    const row = await ctx.db.get(inboundId)
    if (row && error) await ctx.db.patch(inboundId, { status: 'failed', error: error.slice(0, 300) })
    return null
  },
})

/** Track a sent WhatsApp message so status webhooks can attach Meta's pricing to the org. */
export const recordSent = internalMutation({
  args: {
    provider: botProvider,
    providerMessageId: v.string(),
    companyId: v.optional(v.id('companies')),
    bindingId: v.optional(v.id('channelBindings')),
    kind: v.union(v.literal('free_form'), v.literal('template')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.provider !== 'whatsapp' || !args.companyId) return null
    const now = Date.now()
    await ctx.db.insert('channelMessageCosts', {
      provider: args.provider,
      providerMessageId: args.providerMessageId,
      companyId: args.companyId,
      bindingId: args.bindingId,
      kind: args.kind,
      sentAt: now,
      updatedAt: now,
    })
    return null
  },
})

/** Delete processed inbound rows after 30 days (the dedupe window Meta and Telegram need is minutes). */
export const pruneInbound = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const old = await ctx.db
      .query('channelInbound')
      .withIndex('by_receivedAt', (q) => q.lt('receivedAt', cutoff))
      .take(500)
    for (const r of old) await ctx.db.delete(r._id)
    return old.length + (await pruneScopes(ctx))
  },
})

