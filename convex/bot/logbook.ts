/**
 * Logbook photo OCR (BOT-006, research report §1.4).
 *
 * A worker sends a photo of a paper daily-logbook page. `route` (inbound.ts)
 * turns an image message from a live binding into a `logbook` plan; the
 * processing action then:
 *   1. `prepareScan` (mutation): binding, `production.daily.record`, the
 *      org's assistant switch and plan feature, SEC-004 limits and the admin's
 *      daily cap (AI policy), the plan's AI credits on the server key; one
 *      scan per (binding, message) so a webhook retry never reads twice.
 *   2. downloads the photo at once (WhatsApp media URLs expire in ~5 min),
 *      at most 5 MB, JPEG/PNG/WebP by magic bytes (media.ts);
 *   3. stores it in the files register under the organization
 *      (entityType 'logbookScans', Convex storage or R2);
 *   4. reads it with a vision model on the org's key or the server's
 *      (llmVision.ts), JSON validated with Schema; metered in llmUsage as
 *      feature 'ocr';
 *   5. `createScanDrafts` (mutation): fuzzy-matches each row's unit code to
 *      the member's units in scope (unitMatch.ts), and makes one BOT-003
 *      draft per matched row through `proposeFor` (same validation as a
 *      typed entry). Unmatched or invalid rows are flagged, never drafted.
 * The reply lists the drafts with [Save all] [Review each] [Discard all].
 * Nothing is written until a tap; Save all commits each draft through the
 * normal `pending.commit` (re-checked, once per draft).
 */
import { v } from 'convex/values'
import * as Effect from 'effect/Effect'
import { internalMutation, internalQuery } from '../_generated/server'
import type { ActionCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { can } from '../lib/permissions'
import { rateLimiter, retryAfterText } from '../lib/rateLimits'
import { HOUR } from '@convex-dev/rate-limiter'
import { aiPolicyOf } from '../lib/aiPolicyShared'
import { assertPlanLimit, hasFeature } from '../lib/planLimits'
import { isUserError } from '../lib/errors'
import { logAudit } from '../lib/tenancy'
import { PROVIDERS, gatewayModel, llmCredentialAad } from '../lib/llmGateway'
import { decryptJson, readEncryptionKey } from '../lib/crypto'
import { addDays, todayIn, zoneFor } from '../lib/dates'
import { runEffect } from '../lib/effect'
import { FetchLive } from '../lib/effectHttp'
import { R2Storage, r2ConfigFromEnv, r2Live } from '../lib/r2'
import { filesProvider } from '../lib/r2Files'
import { logbookPrompt, readLogbookPhoto, MAX_EXTRACTED_ROWS, type LogbookExtraction } from '../lib/llmVision'
import { companyCredentials, insertUsage, pickCredential } from '../llmGateway'
import { checkBinding, botCtx, unitsInScope, type BoundMember } from './scope'
import { serverKey, serverProvider, openAiBaseUrl } from './agent'
import { closeDraft, draftMessage, proposeFor } from './pending'
import { fuzzyMatchUnit, CHECK_CONFIDENCE, MIN_CONFIDENCE } from './unitMatch'
import { fetchTelegramPhoto, fetchWhatsAppPhoto, MAX_PHOTO_BYTES, type Photo } from './media'
import { telegramBotToken, whatsappBotConfig } from './outbound'
import { t, type BotLocale } from './i18n'
import { lt } from './logbookI18n'
import type { ChatMessageValue, RoutePlan, Target } from './validators'

/** Drafts per page; rows beyond are flagged. */
export const MAX_DRAFTS_PER_SCAN = 20
const MAX_DAYS_AGO = 7
/** WhatsApp interactive bodies are at most 1024 characters. */
const BODY_BUDGET = 1000

/** Button verbs (with `:<scanId>`): save all, review each, discard all. */
export const SCAN_VERBS = { all: 'lba', review: 'lbr', discard: 'lbx' } as const

const text = (m: string): ChatMessageValue => ({ kind: 'text', text: m })

// ---------------------------------------------------------------------------
// Routing (called from inbound.route, inside its transaction)

/** An image from a live binding: refuse a declared oversize at once, else read it. */
export function logbookPlan(inbound: Doc<'channelInbound'>, tgt: Target & { bindingId: Id<'channelBindings'> }): RoutePlan {
  const s = lt(tgt.locale)
  if (!inbound.mediaId) return { type: 'reply', ...tgt, messages: [text(s.badType)] }
  if (inbound.mediaSize !== undefined && inbound.mediaSize > MAX_PHOTO_BYTES) {
    return { type: 'reply', ...tgt, messages: [text(s.tooLarge(MAX_PHOTO_BYTES / (1024 * 1024)))] }
  }
  return {
    type: 'logbook',
    ...tgt,
    bindingId: tgt.bindingId,
    mediaId: inbound.mediaId,
    sourceMessageId: inbound.externalId,
    sentAt: inbound.sentAt,
  }
}

async function openDrafts(ctx: MutationCtx, scanId: Id<'logbookScans'>) {
  const rows = await ctx.db
    .query('pendingBotActions')
    .withIndex('by_scanId', (q) => q.eq('scanId', scanId))
    .take(MAX_DRAFTS_PER_SCAN + 5)
  return rows.filter((d) => d.status === 'pending')
}

/** Save all / Review each / Discard all; null when the button is not ours. */
export async function logbookButton(
  ctx: MutationCtx,
  bound: BoundMember,
  verb: string,
  arg: string,
  tgt: Target & { bindingId: Id<'channelBindings'> },
  sourceMessageId: string,
): Promise<RoutePlan | null> {
  if (verb !== SCAN_VERBS.all && verb !== SCAN_VERBS.review && verb !== SCAN_VERBS.discard) return null
  const s = lt(tgt.locale)
  const scanId = ctx.db.normalizeId('logbookScans', arg)
  const scan = scanId ? await ctx.db.get(scanId) : null
  // Another chat's scan is just "not open".
  if (!scan || scan.bindingId !== bound.binding._id || scan.companyId !== bound.binding.companyId) {
    return { type: 'reply', ...tgt, messages: [text(t(tgt.locale).notPending)] }
  }
  if (verb === SCAN_VERBS.all) {
    return { type: 'logbook_commit', ...tgt, bindingId: bound.binding._id, scanId: scan._id, sourceMessageId }
  }
  const drafts = await openDrafts(ctx, scan._id)
  if (!drafts.length) return { type: 'reply', ...tgt, messages: [text(s.noneOpen)] }
  if (verb === SCAN_VERBS.discard) {
    let n = 0
    for (const d of drafts) if ((await closeDraft(ctx, bound.binding._id, d._id)) === 'closed') n++
    return { type: 'reply', ...tgt, messages: [text(s.discarded(n))] }
  }
  return { type: 'reply', ...tgt, messages: drafts.slice(0, 10).map((d) => draftMessage(tgt.locale, d)) }
}

// ---------------------------------------------------------------------------
// Gate and scan row

const VISION_INCAPABLE = new Set(['groq'])

const prepared = v.union(
  v.object({
    ok: v.literal(true),
    scanId: v.id('logbookScans'),
    userId: v.id('users'),
    companyId: v.id('companies'),
    locale: v.union(v.literal('en'), v.literal('fr')),
    prompt: v.string(),
    source: v.union(v.literal('org_key'), v.literal('server_key')),
    providerId: v.string(),
    model: v.string(),
    baseUrl: v.union(v.string(), v.null()),
    credentialId: v.union(v.id('llmCredentials'), v.null()),
    ciphertext: v.union(v.string(), v.null()),
    iv: v.union(v.string(), v.null()),
  }),
  v.object({
    ok: v.literal(false),
    reason: v.union(
      v.literal('duplicate'),
      v.literal('binding'),
      v.literal('permission'),
      v.literal('disabled'),
      v.literal('quota'),
      v.literal('unavailable'),
    ),
    message: v.string(),
  }),
)

/** The site a scan's photo is filed under: the active site, else a site-limited member's first. */
function scanSite(bound: BoundMember): Id<'farmLocations'> | undefined {
  if (bound.site) return bound.site._id
  const scope = bound.member.siteScope
  return scope === 'all' ? undefined : [...scope][0]
}

export const prepareScan = internalMutation({
  args: { bindingId: v.id('channelBindings'), sourceMessageId: v.string() },
  returns: prepared,
  handler: async (ctx, { bindingId, sourceMessageId }) => {
    const binding = await ctx.db.get(bindingId)
    const checked = binding ? await checkBinding(ctx, binding) : null
    if (!binding || !checked || !checked.ok) {
      return { ok: false as const, reason: 'binding' as const, message: t(checked && !checked.ok ? checked.locale : 'en').bindingInactive }
    }
    const bound = checked.bound
    const s = lt(bound.locale)
    // A provider retry that slipped past inbound dedupe never reads (or bills) twice.
    const prior = await ctx.db
      .query('logbookScans')
      .withIndex('by_bindingId_and_sourceMessageId', (q) => q.eq('bindingId', bindingId).eq('sourceMessageId', sourceMessageId))
      .first()
    if (prior) return { ok: false as const, reason: 'duplicate' as const, message: '' }
    if (!can(bound.member, 'production.daily.record')) {
      return { ok: false as const, reason: 'permission' as const, message: s.noPermission }
    }
    const companyId = binding.companyId
    if (bound.company.settings?.aiAssistantEnabled !== true || !(await hasFeature(ctx, companyId, 'ai_assistant'))) {
      return { ok: false as const, reason: 'disabled' as const, message: s.disabled }
    }

    const cred = pickCredential(await companyCredentials(ctx, companyId))
    const secret = cred
      ? await ctx.db
          .query('integrationSecrets')
          .withIndex('by_llmCredentialId', (q) => q.eq('llmCredentialId', cred._id))
          .unique()
      : null
    const useOrgKey = !!(cred && secret && !VISION_INCAPABLE.has(cred.providerId))
    const serverId = useOrgKey ? null : (process.env.BOT_VISION_PROVIDER && serverKey(process.env.BOT_VISION_PROVIDER) ? process.env.BOT_VISION_PROVIDER : serverProvider())
    if (!useOrgKey && (!serverId || VISION_INCAPABLE.has(serverId))) {
      return { ok: false as const, reason: 'unavailable' as const, message: s.unavailable }
    }
    if (!useOrgKey) {
      // Platform-key calls count against the plan's assistant credits.
      try {
        await assertPlanLimit(ctx, companyId, 'aiCredits')
      } catch (err) {
        if (isUserError(err)) return { ok: false as const, reason: 'quota' as const, message: err.data.message }
        throw err
      }
    }

    // SEC-004 limits and the admin's daily cap: check all, then spend.
    const limits = [
      ['llmPerUserMinute', binding.userId],
      ['llmPerUserHour', binding.userId],
      ['llmPerCompanyHour', companyId],
    ] as const
    for (const [name, key] of limits) {
      const verdict = await rateLimiter.check(ctx, name, { key })
      if (!verdict.ok) return { ok: false as const, reason: 'quota' as const, message: t(bound.locale).aiQuota(retryAfterText(verdict.retryAfter)) }
    }
    const cap = aiPolicyOf(bound.company).dailyQuestionsPerMember
    const daily = cap === null ? null : { key: String(binding.userId), config: { kind: 'fixed window' as const, rate: cap, period: 24 * HOUR } }
    if (daily) {
      const verdict = await rateLimiter.check(ctx, 'llmDailyPerMember', daily)
      if (!verdict.ok) return { ok: false as const, reason: 'quota' as const, message: t(bound.locale).aiQuota(retryAfterText(verdict.retryAfter)) }
    }
    for (const [name, key] of limits) await rateLimiter.limit(ctx, name, { key })
    if (daily) await rateLimiter.limit(ctx, 'llmDailyPerMember', daily)

    const units = await unitsInScope(ctx, bound, 150)
    const feedTypes = (
      await ctx.db
        .query('feedTypes')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(50)
    ).filter((f) => !f.deletedAt)
    const today = todayIn(zoneFor(bound.site, bound.company))
    const prompt = logbookPrompt({
      today,
      units: units.slice(0, 100).map((u) => (u.code ? `${u.name} (${u.code})` : u.name).slice(0, 40)),
      feedTypes: feedTypes.slice(0, 30).map((f) => f.name.slice(0, 40)),
    })
    const scanId = await ctx.db.insert('logbookScans', {
      companyId,
      locationId: scanSite(bound),
      userId: binding.userId,
      bindingId,
      provider: binding.provider,
      sourceMessageId,
      status: 'processing',
      createdAt: Date.now(),
    })
    const base = { ok: true as const, scanId, userId: binding.userId, companyId, locale: bound.locale, prompt }
    if (useOrgKey && cred && secret) {
      return {
        ...base,
        source: 'org_key' as const,
        providerId: cred.providerId,
        model: gatewayModel(cred.providerId, cred.model),
        baseUrl: cred.baseUrl ?? null,
        credentialId: cred._id,
        ciphertext: secret.ciphertext,
        iv: secret.iv,
      }
    }
    const providerId = serverId!
    return {
      ...base,
      source: 'server_key' as const,
      providerId,
      model: process.env.BOT_VISION_MODEL || PROVIDERS[providerId]?.defaultModel || 'gpt-4o-mini',
      baseUrl: null,
      credentialId: null,
      ciphertext: null,
      iv: null,
    }
  },
})

export const failScan = internalMutation({
  args: { scanId: v.id('logbookScans'), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { scanId, error }) => {
    const scan = await ctx.db.get(scanId)
    if (scan && scan.status === 'processing') await ctx.db.patch(scanId, { status: 'failed', error: error.slice(0, 300) })
    return null
  },
})

/** Register the stored photo in the files register under the scan's organization. */
export const attachScanFile = internalMutation({
  args: {
    scanId: v.id('logbookScans'),
    bindingId: v.id('channelBindings'),
    mime: v.string(),
    size: v.number(),
    storageId: v.optional(v.id('_storage')),
    r2Key: v.optional(v.string()),
  },
  returns: v.union(v.id('files'), v.null()),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId)
    const binding = await ctx.db.get(args.bindingId)
    const checked = binding ? await checkBinding(ctx, binding) : null
    if (!scan || !checked?.ok || scan.bindingId !== args.bindingId || scan.status !== 'processing' || scan.fileId) {
      if (args.storageId) await ctx.storage.delete(args.storageId)
      return null
    }
    const ext = args.mime === 'image/png' ? 'png' : args.mime === 'image/webp' ? 'webp' : 'jpg'
    const name = `logbook-${scan.sourceMessageId.replace(/[^A-Za-z0-9._-]/g, '').slice(-40) || 'page'}.${ext}`
    const fileId = await ctx.db.insert('files', {
      companyId: scan.companyId,
      locationId: scan.locationId,
      entityType: 'logbookScans',
      entityId: scan._id,
      provider: args.r2Key ? 'r2' : 'convex',
      storageId: args.storageId,
      r2Key: args.r2Key,
      name,
      mime: args.mime,
      size: args.size,
      uploadedBy: scan.userId,
      createdAt: Date.now(),
    })
    await ctx.db.patch(scan._id, { fileId })
    await logAudit(botCtx(ctx, checked.bound, scan.sourceMessageId), {
      actionType: 'file_attached',
      tableName: 'files',
      recordId: fileId,
      newValues: { entityType: 'logbookScans', entityId: scan._id, name, mime: args.mime, size: args.size },
      locationId: scan.locationId,
    })
    return fileId
  },
})

export const recordScanUsage = internalMutation({
  args: {
    companyId: v.id('companies'),
    userId: v.id('users'),
    source: v.union(v.literal('org_key'), v.literal('server_key')),
    providerId: v.string(),
    model: v.string(),
    ok: v.boolean(),
    error: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await insertUsage(ctx, { ...args, feature: 'ocr' })
    return null
  },
})

// ---------------------------------------------------------------------------
// Rows → drafts

const num = v.optional(v.union(v.number(), v.null()))
const str = v.optional(v.union(v.string(), v.null()))
const extractionValidator = v.object({
  date: str,
  rows: v.array(
    v.object({
      unit: v.string(),
      feedType: str,
      feedKg: num,
      mortality: num,
      temperatureC: num,
      dissolvedOxygen: num,
      notes: str,
    }),
  ),
})

const draftsResult = v.object({
  drafts: v.array(v.object({ pendingId: v.id('pendingBotActions'), summary: v.string() })),
  flagged: v.array(v.object({ unit: v.string(), reason: v.string() })),
  rowCount: v.number(),
  pageDate: v.union(v.string(), v.null()),
})

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const opt = <T>(x: T | null | undefined): T | undefined => (x === null ? undefined : x)

/** How many days before `today` the page date is, or null when out of range; 0 without a usable date. */
function daysAgoOf(today: string, pageDate: string | undefined): number | null {
  if (!pageDate || !ISO_DATE.test(pageDate)) return 0
  for (let d = 0; d <= MAX_DAYS_AGO; d++) if (addDays(today, -d) === pageDate) return d
  return null
}

/**
 * One draft per matched row, in one transaction. Company, site and units come
 * from the binding; the model's text is only matched against them.
 */
export const createScanDrafts = internalMutation({
  args: {
    scanId: v.id('logbookScans'),
    bindingId: v.id('channelBindings'),
    sentAt: v.number(),
    providerId: v.string(),
    model: v.string(),
    extraction: extractionValidator,
  },
  returns: v.union(draftsResult, v.null()),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId)
    const binding = await ctx.db.get(args.bindingId)
    if (!scan || !binding || scan.bindingId !== binding._id || scan.status !== 'processing') return null
    const checked = await checkBinding(ctx, binding)
    if (!checked.ok) {
      await ctx.db.patch(scan._id, { status: 'failed', error: checked.problem })
      return null
    }
    const bound = checked.bound
    const s = lt(bound.locale)
    const units = await unitsInScope(ctx, bound)
    const today = todayIn(zoneFor(bound.site, bound.company))
    const pageDate = opt(args.extraction.date)
    const usableDate = pageDate && ISO_DATE.test(pageDate) ? pageDate : undefined
    const daysAgo = daysAgoOf(today, usableDate)

    const drafts: { pendingId: Id<'pendingBotActions'>; summary: string }[] = []
    const flagged: { unit: string; reason: string }[] = []
    const seen = new Set<string>()
    const rows = args.extraction.rows.slice(0, MAX_EXTRACTED_ROWS)
    for (const row of rows) {
      const read = row.unit.trim().slice(0, 60)
      if (daysAgo === null) {
        flagged.push({ unit: read, reason: s.dateRange })
        continue
      }
      const match = fuzzyMatchUnit(units, read)
      if (!match.unit || match.confidence < MIN_CONFIDENCE) {
        flagged.push({ unit: read, reason: s.unmatched(match.unit ? [] : match.candidates) })
        continue
      }
      const unit = match.unit
      if (seen.has(unit._id)) {
        flagged.push({ unit: read, reason: s.twice })
        continue
      }
      seen.add(unit._id)
      if (drafts.length >= MAX_DRAFTS_PER_SCAN) {
        flagged.push({ unit: read, reason: s.tooMany })
        continue
      }
      const r = await proposeFor(
        ctx,
        bound,
        {
          kind: 'daily_entry',
          unit: unit.name,
          feedKg: opt(row.feedKg),
          feedType: opt(row.feedType)?.slice(0, 60) || undefined,
          mortality: opt(row.mortality),
          notes: opt(row.notes)?.slice(0, 300) || undefined,
          dissolvedOxygen: opt(row.dissolvedOxygen),
          temperatureC: opt(row.temperatureC),
          daysAgo,
        },
        { sourceMessageId: scan.sourceMessageId, eventTime: args.sentAt },
      )
      if (!r.ok) {
        flagged.push({ unit: read, reason: r.error.slice(0, 160) })
        continue
      }
      const summary = match.confidence < CHECK_CONFIDENCE ? `${r.summary} (${s.readAs(read)})` : r.summary
      await ctx.db.patch(r.pendingId, { scanId: scan._id, summary })
      drafts.push({ pendingId: r.pendingId, summary })
    }
    await ctx.db.patch(scan._id, {
      status: 'ready',
      providerId: args.providerId.slice(0, 40),
      model: args.model.slice(0, 100),
      pageDate: usableDate,
      rowCount: rows.length,
      draftCount: drafts.length,
      flagged: flagged.slice(0, MAX_EXTRACTED_ROWS),
    })
    return { drafts, flagged, rowCount: rows.length, pageDate: usableDate ?? null }
  },
})

/** Open drafts of a scan, for Save all (the scan must be this binding's). */
export const scanDrafts = internalQuery({
  args: { scanId: v.id('logbookScans'), bindingId: v.id('channelBindings') },
  returns: v.array(v.object({ pendingId: v.id('pendingBotActions'), summary: v.string() })),
  handler: async (ctx, { scanId, bindingId }) => {
    const scan = await ctx.db.get(scanId)
    if (!scan || scan.bindingId !== bindingId) return []
    const rows = await ctx.db
      .query('pendingBotActions')
      .withIndex('by_scanId', (q) => q.eq('scanId', scanId))
      .take(MAX_DRAFTS_PER_SCAN + 5)
    return rows
      .filter((d) => d.bindingId === bindingId && d.status === 'pending')
      .map((d) => ({ pendingId: d._id, summary: d.summary }))
  },
})

// ---------------------------------------------------------------------------
// Action side (process.ts)

/** The confirm message: numbered drafts, flagged rows, [Save all] [Review each] [Discard all]. */
export function scanMessage(
  locale: BotLocale,
  scanId: Id<'logbookScans'>,
  r: { drafts: { summary: string }[]; flagged: { unit: string; reason: string }[]; pageDate: string | null },
): ChatMessageValue {
  const s = lt(locale)
  const tail = r.drafts.length ? s.confirmAll : ''
  const lines: string[] = []
  let used = tail.length + 2
  const push = (line: string) => {
    if (used + line.length + 1 > BODY_BUDGET) return false
    lines.push(line)
    used += line.length + 1
    return true
  }
  if (r.drafts.length) {
    push(s.header(r.drafts.length, r.pageDate ?? undefined))
    for (const [i, d] of r.drafts.entries()) {
      if (!push(`${i + 1}. ${d.summary}`)) {
        push(s.more(r.drafts.length - i))
        break
      }
    }
  } else {
    push(s.nothingFound)
  }
  if (r.flagged.length) {
    push('')
    push(s.flaggedHeader)
    for (const f of r.flagged) if (!push(`- "${f.unit}": ${f.reason}`)) break
  }
  if (!r.drafts.length) return text(lines.join('\n'))
  lines.push('', tail)
  return {
    kind: 'buttons',
    text: lines.join('\n'),
    buttons: [
      { id: `${SCAN_VERBS.all}:${scanId}`, title: s.saveAll },
      { id: `${SCAN_VERBS.review}:${scanId}`, title: s.review },
      { id: `${SCAN_VERBS.discard}:${scanId}`, title: s.discardAll },
    ],
  }
}

async function storePhoto(ctx: ActionCtx, companyId: Id<'companies'>, scanId: Id<'logbookScans'>, photo: Photo) {
  if (filesProvider() === 'r2' && r2ConfigFromEnv()) {
    const key = `files/${companyId}/logbook/${scanId}`
    await runEffect(
      Effect.gen(function* () {
        const r2 = yield* R2Storage
        yield* r2.put(key, photo.bytes, { contentType: photo.mime })
      }).pipe(Effect.provide(r2Live())),
    )
    return { r2Key: key }
  }
  const storageId = await ctx.storage.store(new Blob([photo.bytes as BlobPart], { type: photo.mime }))
  return { storageId }
}

type LogbookPlan = Extract<RoutePlan, { type: 'logbook' }>

/** Read a logbook photo into drafts. Returns the messages to send. */
export async function runLogbook(ctx: ActionCtx, plan: LogbookPlan): Promise<ChatMessageValue[]> {
  const p = await ctx.runMutation(internal.bot.logbook.prepareScan, {
    bindingId: plan.bindingId,
    sourceMessageId: plan.sourceMessageId,
  })
  if (!p.ok) return p.reason === 'duplicate' ? [] : [text(p.message)]
  const s = lt(p.locale)
  const fail = async (error: string, reply: string) => {
    await ctx.runMutation(internal.bot.logbook.failScan, { scanId: p.scanId, error })
    return [text(reply)]
  }

  // 1. Download now: the WhatsApp media URL expires in minutes.
  let program
  if (plan.provider === 'whatsapp') {
    const config = whatsappBotConfig()
    if (!config) return await fail('whatsapp_not_configured', s.downloadFailed)
    program = fetchWhatsAppPhoto(plan.mediaId, config.accessToken)
  } else {
    const token = telegramBotToken()
    if (!token) return await fail('telegram_not_configured', s.downloadFailed)
    program = fetchTelegramPhoto(plan.mediaId, token)
  }
  const fetched = await runEffect(
    program.pipe(
      Effect.map((photo) => ({ ok: true as const, photo })),
      Effect.catchTag('MediaError', (e) => Effect.succeed({ ok: false as const, reason: e.reason })),
      Effect.provide(FetchLive),
    ),
  )
  if (!fetched.ok) {
    const reply =
      fetched.reason === 'too_large'
        ? s.tooLarge(MAX_PHOTO_BYTES / (1024 * 1024))
        : fetched.reason === 'bad_type'
          ? s.badType
          : s.downloadFailed
    return await fail(`media_${fetched.reason}`, reply)
  }
  const photo = fetched.photo

  // 2. File it under the organization.
  const stored = await storePhoto(ctx, p.companyId, p.scanId, photo)
  const fileId = await ctx.runMutation(internal.bot.logbook.attachScanFile, {
    scanId: p.scanId,
    bindingId: plan.bindingId,
    mime: photo.mime,
    size: photo.bytes.byteLength,
    ...stored,
  })
  if (!fileId) {
    // The binding or scan went away meanwhile (Convex blobs are deleted by the mutation).
    if (stored.r2Key) await ctx.scheduler.runAfter(0, internal.files.deleteR2Object, { key: stored.r2Key })
    return await fail('binding_changed', t(p.locale).bindingInactive)
  }

  // 3. Read it.
  let apiKey = ''
  if (p.source === 'org_key') {
    const key = readEncryptionKey()
    if (key && p.ciphertext && p.iv && p.credentialId) {
      apiKey = (
        await decryptJson<{ apiKey: string }>({ ciphertext: p.ciphertext, iv: p.iv }, llmCredentialAad(p.companyId, p.credentialId), key)
      ).apiKey
    }
  } else {
    apiKey = serverKey(p.providerId)
  }
  const kind = PROVIDERS[p.providerId]?.kind ?? 'openai'
  const baseUrl = kind === 'openai' ? openAiBaseUrl(p.providerId, p.baseUrl) : null
  if (!apiKey || (kind === 'openai' && !baseUrl)) return await fail('no_key', s.unavailable)
  const started = Date.now()
  const reading = await runEffect(
    readLogbookPhoto({
      kind,
      providerId: p.providerId,
      baseUrl: baseUrl ?? undefined,
      apiKey,
      model: p.model,
      image: { bytes: photo.bytes, mime: photo.mime },
      prompt: p.prompt,
    }).pipe(
      Effect.map((r) => ({ ok: true as const, ...r })),
      Effect.catchTags({
        LlmError: (e) => Effect.succeed({ ok: false as const, decode: false, error: e.message, usage: undefined }),
        LogbookDecodeError: (e) => Effect.succeed({ ok: false as const, decode: true, error: e.message, usage: e.usage }),
      }),
      Effect.provide(FetchLive),
    ),
  )
  await ctx.runMutation(internal.bot.logbook.recordScanUsage, {
    companyId: p.companyId,
    userId: p.userId,
    source: p.source,
    providerId: p.providerId,
    model: p.model,
    ok: reading.ok,
    error: reading.ok ? undefined : reading.error.slice(0, 200),
    inputTokens: reading.usage?.inputTokens,
    outputTokens: reading.usage?.outputTokens,
    durationMs: Date.now() - started,
  })
  if (!reading.ok) return await fail(reading.error, reading.decode ? s.unreadable : s.unavailable)

  // 4. Drafts.
  const result = await ctx.runMutation(internal.bot.logbook.createScanDrafts, {
    scanId: p.scanId,
    bindingId: plan.bindingId,
    sentAt: plan.sentAt,
    providerId: p.providerId,
    model: p.model,
    extraction: toExtractionValue(reading.extraction),
  })
  if (!result) return [text(t(p.locale).bindingInactive)]
  return [scanMessage(p.locale, p.scanId, result)]
}

/** Schema output (readonly arrays) → plain values for the mutation args. */
function toExtractionValue(e: LogbookExtraction) {
  return {
    date: e.date ?? null,
    rows: e.rows.map((r) => ({
      unit: r.unit,
      feedType: r.feedType ?? null,
      feedKg: r.feedKg ?? null,
      mortality: r.mortality ?? null,
      temperatureC: r.temperatureC ?? null,
      dissolvedOxygen: r.dissolvedOxygen ?? null,
      notes: r.notes ?? null,
    })),
  }
}

type CommitPlan = Extract<RoutePlan, { type: 'logbook_commit' }>

/** Save all: each open draft through the normal commit (re-checked, once per draft). */
export async function commitLogbook(ctx: ActionCtx, plan: CommitPlan): Promise<ChatMessageValue[]> {
  const s = lt(plan.locale)
  const drafts = await ctx.runQuery(internal.bot.logbook.scanDrafts, { scanId: plan.scanId, bindingId: plan.bindingId })
  if (!drafts.length) return [text(s.noneOpen)]
  let saved = 0
  let already = 0
  let review = 0
  const failed: string[] = []
  for (const d of drafts) {
    try {
      const r = await ctx.runMutation(internal.bot.pending.commit, {
        pendingId: d.pendingId,
        bindingId: plan.bindingId,
        sourceMessageId: plan.sourceMessageId,
        confirmDuplicate: false,
      })
      if (r.status === 'saved') saved++
      else if (r.status === 'already') already++
      else if (r.status === 'needs_confirm') review++
      else failed.push(`- ${d.summary}: ${r.status === 'refused' ? r.message : r.status}`)
    } catch (err) {
      const msg = isUserError(err) ? err.data.message : 'something went wrong'
      await ctx.runMutation(internal.bot.pending.markFailed, { pendingId: d.pendingId, error: msg })
      failed.push(`- ${d.summary}: ${msg}`)
    }
  }
  if (!saved && already === drafts.length) return [text(s.alreadyAll)]
  const lines = [s.savedAll(saved + already, drafts.length)]
  if (review) lines.push(s.needsReview(review))
  if (failed.length) lines.push(s.failedSome(failed.slice(0, 10).join('\n')))
  if (!review) return [text(lines.join('\n').slice(0, 3500))]
  return [
    {
      kind: 'buttons',
      text: lines.join('\n').slice(0, BODY_BUDGET),
      buttons: [{ id: `${SCAN_VERBS.review}:${plan.scanId}`, title: s.review }],
    },
  ]
}
