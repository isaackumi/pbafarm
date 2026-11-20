/**
 * Write proposals (BOT-003, doc 23 §5): the bot never writes from a chat
 * message directly. A tool call stores a validated draft; the user taps Save;
 * `commit` re-checks the binding, permission and site, then calls the same
 * helper the web mutation uses, once per draft.
 */
import { v, type Infer } from 'convex/values'
import { internalMutation } from '../_generated/server'
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { can } from '../lib/permissions'
import { addDays } from '../lib/dates'
import { saveDailyBatch, removeDailyRecordAs } from '../dailyRecords'
import { recordOutboundUsageAs } from '../feed'
import { reverseTransactionAs } from '../inventory'
import { botCtx, checkBinding, farmDate, inScope, matchUnit, unitsInScope, type BoundMember, type MemberScope } from './scope'
import { t, type BotLocale } from './i18n'
import { CHECK_CONFIDENCE, fuzzyMatchUnit, rankUnits } from './unitMatch'
import type { ChatMessageValue } from './validators'

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000
export const UNDO_WINDOW_MS = 10 * 60 * 1000
const MAX_KG = 100_000
const MAX_FISH = 10_000_000
const MAX_DAYS_AGO = 7

export const proposalInput = v.union(
  v.object({
    kind: v.literal('daily_entry'),
    unit: v.string(),
    feedKg: v.optional(v.number()),
    feedType: v.optional(v.string()),
    mortality: v.optional(v.number()),
    mortalityCause: v.optional(v.string()),
    notes: v.optional(v.string()),
    daysAgo: v.optional(v.number()),
    /** Water readings (logbook photos, BOT-006). */
    dissolvedOxygen: v.optional(v.number()),
    temperatureC: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal('feed_issue'),
    feedType: v.string(),
    quantityKg: v.number(),
    unit: v.optional(v.string()),
    notes: v.optional(v.string()),
    daysAgo: v.optional(v.number()),
  }),
)
export type ProposalInput = Infer<typeof proposalInput>

const MORTALITY_CAUSES = ['disease', 'do_crash', 'predator', 'theft', 'cull', 'unknown', 'other'] as const

function nameKey(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export async function feedTypesOf(ctx: MutationCtx, companyId: Id<'companies'>) {
  const rows = await ctx.db
    .query('feedTypes')
    .withIndex('by_company', (q) => q.eq('companyId', companyId))
    .take(200)
  return rows.filter((f) => !f.deletedAt)
}

export function matchFeedType(types: Doc<'feedTypes'>[], typed: string) {
  const key = nameKey(typed)
  if (!key) return null
  const exact = types.filter((f) => nameKey(f.name) === key)
  if (exact.length === 1) return exact[0]
  const partial = types.filter((f) => nameKey(f.name).includes(key))
  return partial.length === 1 ? partial[0] : null
}

function fmtKg(kg: number) {
  return `${Math.round(kg * 100) / 100} kg`
}

export function draftButtons(locale: BotLocale, pendingId: Id<'pendingBotActions'>, duplicate: boolean): ChatMessageValue {
  const s = t(locale)
  return {
    kind: 'buttons',
    text: '',
    buttons: [
      { id: `${duplicate ? 'dup' : 'ok'}:${pendingId}`, title: duplicate ? s.saveAnyway : s.save },
      { id: `ed:${pendingId}`, title: s.edit },
      { id: `no:${pendingId}`, title: s.cancel },
    ],
  }
}

/** The confirm message for a draft: summary, duplicate warning, [Save] [Edit] [Cancel]. */
export function draftMessage(locale: BotLocale, draft: Doc<'pendingBotActions'>): ChatMessageValue {
  const s = t(locale)
  const lines = [draft.summary]
  if (draft.duplicateOf) lines.push(s.duplicateWarning)
  lines.push(s.confirmPrompt)
  const b = draftButtons(locale, draft._id, !!draft.duplicateOf)
  return b.kind === 'buttons' ? { ...b, text: lines.join('\n') } : b
}

type ProposeResult = { ok: true; pendingId: Id<'pendingBotActions'>; summary: string } | { ok: false; error: string }

export type ProposeOptions = {
  /**
   * Voice notes (BOT-005): a cage heard unclearly does not fail the draft.
   * The closest unit is used, the draft is marked CHECK on 'unit' and keeps
   * the closest matches for a picker; it cannot be saved until one is picked.
   */
  pickUnit?: boolean
}

/** Max cage choices kept on a draft (a WhatsApp list holds 10 rows). */
export const MAX_UNIT_CHOICES = 10
/** Commit refusal for a draft whose cage was not picked yet. */
export const UNIT_UNCONFIRMED = 'unit_unconfirmed'

type UnitPick =
  | { unit: Doc<'cages'>; choices: Doc<'cages'>[] | null }
  | { error: string }

/** The unit for typed or heard text; with `pick`, a weak match keeps its closest alternatives. */
function resolveUnit(units: Doc<'cages'>[], typed: string, pick: boolean): UnitPick {
  if (pick) {
    const m = fuzzyMatchUnit(units, typed)
    if (m.unit && m.confidence >= CHECK_CONFIDENCE) return { unit: m.unit, choices: null }
    const ranked = rankUnits(units, typed, MAX_UNIT_CHOICES).map((r) => r.unit)
    const first = m.unit ?? ranked[0]
    if (!first) return { error: `No unit called "${typed.slice(0, 40)}" at your site.` }
    return { unit: first, choices: [first, ...ranked.filter((u) => u._id !== first._id)].slice(0, MAX_UNIT_CHOICES) }
  }
  const { unit, candidates } = matchUnit(units, typed)
  if (unit) return { unit, choices: null }
  return {
    error: candidates.length ? `Which unit? Matches: ${candidates.join(', ')}` : `No unit called "${typed.slice(0, 40)}" at your site.`,
  }
}

/** A validated daily-entry or feed-issue draft, not stored yet. */
export type BuiltProposal = {
  ok: true
  payload: Doc<'pendingBotActions'>['payload']
  siteId: Id<'farmLocations'> | undefined
  date: string
  summary: string
  fingerprint: string
  /** Set when the unit was picked from a weak match (ProposeOptions.pickUnit). */
  unitChoices: Doc<'cages'>[] | null
}

/**
 * Validate a daily entry or feed issue against the member's scope and
 * permissions. Shared by the chat bot (binding) and Ask Anowa (web member).
 */
export async function buildProposal(
  ctx: MutationCtx,
  bound: MemberScope,
  input: ProposalInput,
  eventTime: number,
  opts: ProposeOptions = {},
): Promise<BuiltProposal | { ok: false; error: string }> {
  const s = t(bound.locale)
  const daysAgo = input.daysAgo ?? 0
  if (!Number.isInteger(daysAgo) || daysAgo < 0 || daysAgo > MAX_DAYS_AGO) {
    return { ok: false, error: `daysAgo must be a whole number from 0 to ${MAX_DAYS_AGO}` }
  }
  const units = await unitsInScope(ctx, bound)
  const companyId = bound.binding.companyId
  const source = { eventTime }

  let payload: Doc<'pendingBotActions'>['payload']
  let siteId: Id<'farmLocations'> | undefined
  let date: string
  let summary: string
  let fingerprint: string
  let unitChoices: Doc<'cages'>[] | null = null

  if (input.kind === 'daily_entry') {
    if (!can(bound.member, 'production.daily.record')) return { ok: false, error: 'You do not have permission to record daily entries.' }
    const picked = resolveUnit(units, input.unit, !!opts.pickUnit)
    if ('error' in picked) return { ok: false, error: picked.error }
    const unit = picked.unit
    unitChoices = picked.choices
    const feedKg = input.feedKg ?? 0
    const mortality = input.mortality ?? 0
    if (!(feedKg >= 0 && feedKg <= MAX_KG)) return { ok: false, error: 'Feed must be between 0 and 100000 kg.' }
    if (!(Number.isInteger(mortality) && mortality >= 0 && mortality <= MAX_FISH)) {
      return { ok: false, error: 'Mortality must be a whole number of fish.' }
    }
    const notes = input.notes?.trim().slice(0, 500) || undefined
    const { dissolvedOxygen, temperatureC } = input
    if (dissolvedOxygen !== undefined && !(dissolvedOxygen >= 0 && dissolvedOxygen <= 30)) {
      return { ok: false, error: 'Dissolved oxygen must be between 0 and 30 mg/L.' }
    }
    if (temperatureC !== undefined && !(temperatureC >= 0 && temperatureC <= 45)) {
      return { ok: false, error: 'Water temperature must be between 0 and 45 °C.' }
    }
    const water = dissolvedOxygen !== undefined || temperatureC !== undefined
    if (feedKg === 0 && mortality === 0 && !notes && !water) {
      return { ok: false, error: 'Nothing to record: give feed, mortality or notes.' }
    }
    let feedType: Doc<'feedTypes'> | null = null
    if (feedKg > 0) {
      const types = await feedTypesOf(ctx, companyId)
      if (input.feedType) {
        feedType = matchFeedType(types, input.feedType)
        if (!feedType) return { ok: false, error: `Which feed type? Options: ${types.slice(0, 10).map((f) => f.name).join(', ')}` }
      } else {
        const last = await ctx.db
          .query('dailyRecords')
          .withIndex('by_cage_date', (q) => q.eq('cageId', unit._id))
          .order('desc')
          .take(10)
        const lastType = last.find((r) => r.feedTypeId)?.feedTypeId
        feedType = (lastType && types.find((f) => f._id === lastType)) || (types.length === 1 ? types[0] : null)
        if (!feedType) return { ok: false, error: `Which feed type? Options: ${types.slice(0, 10).map((f) => f.name).join(', ')}` }
      }
    }
    const cause =
      mortality > 0
        ? (MORTALITY_CAUSES as readonly string[]).includes(input.mortalityCause ?? '')
          ? input.mortalityCause
          : 'unknown'
        : undefined
    siteId = unit.locationId
    date = addDays(await farmDate(ctx, bound, unit.locationId, source.eventTime), -daysAgo)
    const existing = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) => q.eq('cageId', unit._id).eq('date', date))
      .first()
    if (existing) return { ok: false, error: `${unit.name} already has an entry for ${date}. Correct it in the app.` }
    payload = {
      kind: 'daily_entry',
      cageId: unit._id,
      cageName: unit.name,
      feedKg,
      feedTypeId: feedType?._id,
      feedTypeName: feedType?.name,
      mortality,
      mortalityCause: cause,
      notes,
      ...(dissolvedOxygen !== undefined ? { dissolvedOxygen } : {}),
      ...(temperatureC !== undefined ? { temperatureC } : {}),
      ...(typeof unit.currentCount === 'number' ? { fishBefore: unit.currentCount } : {}),
    }
    summary = s.summaryDaily({
      unit: unit.name,
      date,
      feed: feedKg > 0 ? `${fmtKg(feedKg)} ${feedType?.name ?? ''}`.trim() : '0 kg',
      mortality,
      notes,
    })
    if (dissolvedOxygen !== undefined) summary += `, DO ${dissolvedOxygen} mg/L`
    if (temperatureC !== undefined) summary += `, ${temperatureC} °C`
    fingerprint = `daily|${unit._id}|${date}|${feedKg}|${mortality}`
  } else {
    if (!can(bound.member, 'inventory.issue')) return { ok: false, error: 'You do not have permission to issue feed.' }
    const types = await feedTypesOf(ctx, companyId)
    const feedType = matchFeedType(types, input.feedType)
    if (!feedType) return { ok: false, error: `Which feed type? Options: ${types.slice(0, 10).map((f) => f.name).join(', ')}` }
    if (!(input.quantityKg > 0 && input.quantityKg <= MAX_KG)) return { ok: false, error: 'Quantity must be between 0 and 100000 kg.' }
    let unit: Doc<'cages'> | null = null
    if (input.unit) {
      const picked = resolveUnit(units, input.unit, !!opts.pickUnit)
      if ('error' in picked) return { ok: false, error: picked.error }
      unit = picked.unit
      unitChoices = picked.choices
    }
    siteId = unit?.locationId ?? bound.site?._id
    date = addDays(await farmDate(ctx, bound, siteId, source.eventTime), -daysAgo)
    payload = {
      kind: 'feed_issue',
      feedTypeId: feedType._id,
      feedTypeName: feedType.name,
      quantityKg: input.quantityKg,
      cageId: unit?._id,
      cageName: unit?.name,
      notes: input.notes?.trim().slice(0, 500) || undefined,
    }
    summary = s.summaryIssue({ qty: input.quantityKg, feedType: feedType.name, unit: unit?.name, date })
    fingerprint = `issue|${feedType._id}|${unit?._id ?? '-'}|${date}|${input.quantityKg}`
  }
  return { ok: true, payload, siteId, date, summary, fingerprint, unitChoices }
}

/** Validate and store a draft for the binding. Company and site come from the binding only. */
export async function proposeFor(
  ctx: MutationCtx,
  bound: BoundMember,
  input: ProposalInput,
  source: { sourceMessageId: string; eventTime: number },
  opts: ProposeOptions = {},
): Promise<ProposeResult> {
  const built = await buildProposal(ctx, bound, input, source.eventTime, opts)
  if (!built.ok) return built
  const { payload, siteId, date, summary, fingerprint, unitChoices } = built
  const now = Date.now()
  const companyId = bound.binding.companyId

  const recent = await ctx.db
    .query('pendingBotActions')
    .withIndex('by_bindingId_and_fingerprint', (q) => q.eq('bindingId', bound.binding._id).eq('fingerprint', fingerprint))
    .order('desc')
    .take(5)
  const dup = recent.find(
    (r) => r.createdAt > now - DUPLICATE_WINDOW_MS && (r.status === 'pending' || r.status === 'committed'),
  )

  const pendingId = await ctx.db.insert('pendingBotActions', {
    bindingId: bound.binding._id,
    userId: bound.binding.userId,
    companyId,
    siteId,
    provider: bound.binding.provider,
    payload,
    date,
    eventTime: source.eventTime,
    sourceMessageId: source.sourceMessageId,
    summary,
    fingerprint,
    duplicateOf: dup?._id,
    status: 'pending',
    createdAt: now,
    expiresAt: now + DRAFT_TTL_MS,
    ...(unitChoices
      ? { needsCheck: ['unit'], unitChoices: unitChoices.map((u) => ({ cageId: u._id, name: u.name })) }
      : {}),
  })
  return { ok: true, pendingId, summary }
}

const commitResult = v.union(
  v.object({ status: v.literal('saved'), undoUntil: v.number() }),
  v.object({ status: v.literal('already') }),
  v.object({ status: v.literal('expired') }),
  v.object({ status: v.literal('not_pending') }),
  v.object({ status: v.literal('needs_confirm') }),
  v.object({ status: v.literal('refused'), message: v.string() }),
)
type CommitResult = Infer<typeof commitResult>

async function loadDraft(
  ctx: MutationCtx,
  pendingId: Id<'pendingBotActions'>,
  bindingId: Id<'channelBindings'>,
): Promise<{ draft: Doc<'pendingBotActions'>; bound: BoundMember } | { refused: string }> {
  const draft = await ctx.db.get(pendingId)
  const binding = await ctx.db.get(bindingId)
  // A button id from another chat or user is just "not found".
  if (!draft || !binding || draft.bindingId !== binding._id || draft.userId !== binding.userId || draft.companyId !== binding.companyId) {
    return { refused: 'not_found' }
  }
  const checked = await checkBinding(ctx, binding)
  if (!checked.ok) return { refused: checked.problem }
  return { draft, bound: checked.bound }
}

/** Whether the bound member may still write this draft: permission and site/unit scope. */
async function writeProblem(ctx: MutationCtx, bound: BoundMember, draft: Doc<'pendingBotActions'>): Promise<string | null> {
  const p = draft.payload
  // Purchase orders and tasks are web (Ask Anowa) drafts: never committed from a chat.
  if (p.kind !== 'daily_entry' && p.kind !== 'feed_issue') return 'not a chat draft'
  const permission = p.kind === 'daily_entry' ? 'production.daily.record' : 'inventory.issue'
  if (!can(bound.member, permission)) return `missing permission ${permission}`
  if (draft.siteId && !inScope(bound, draft.siteId)) return 'site not in your scope'
  if (p.cageId) {
    const cage = await ctx.db.get(p.cageId)
    if (!cage || cage.companyId !== bound.binding.companyId || cage.archivedAt || !inScope(bound, cage.locationId)) {
      return 'unit not found'
    }
  }
  return null
}

/**
 * Save a draft (button tap). Exactly once: the draft's status and an
 * idempotencyKeys row keyed by the draft id are written in the same
 * transaction as the record. A write error throws and rolls everything back;
 * the caller then marks the draft failed.
 */
export const commit = internalMutation({
  args: {
    pendingId: v.id('pendingBotActions'),
    bindingId: v.id('channelBindings'),
    sourceMessageId: v.string(),
    confirmDuplicate: v.boolean(),
  },
  returns: commitResult,
  handler: async (ctx, args): Promise<CommitResult> => {
    const loaded = await loadDraft(ctx, args.pendingId, args.bindingId)
    if ('refused' in loaded) return { status: 'refused', message: loaded.refused }
    const { draft, bound } = loaded
    const idemKey = `bot:${draft._id}`
    const prior = await ctx.db
      .query('idempotencyKeys')
      .withIndex('by_user_and_key', (q) => q.eq('userId', draft.userId).eq('key', idemKey))
      .first()
    if (prior || draft.status === 'committed') return { status: 'already' }
    if (draft.status !== 'pending') return { status: 'not_pending' }
    const now = Date.now()
    if (draft.expiresAt <= now) {
      await ctx.db.patch(draft._id, { status: 'expired' })
      return { status: 'expired' }
    }
    if (draft.duplicateOf && !args.confirmDuplicate) return { status: 'needs_confirm' }
    // A cage heard unclearly (BOT-005) is saved only after the worker picks it.
    if (draft.needsCheck?.includes('unit')) return { status: 'refused', message: UNIT_UNCONFIRMED }
    const problem = await writeProblem(ctx, bound, draft)
    if (problem) return { status: 'refused', message: problem }

    // Audit rows carry the channel and the message that carried the entry.
    const wctx = botCtx(ctx, bound, draft.sourceMessageId)
    const p = draft.payload
    if (p.kind !== 'daily_entry' && p.kind !== 'feed_issue') return { status: 'refused', message: 'not a chat draft' }
    let dailyRecordId: Id<'dailyRecords'> | undefined
    let feedUsageId: Id<'feedUsage'> | undefined
    if (p.kind === 'daily_entry') {
      const [id] = await saveDailyBatch(wctx, bound.actor, {
        date: draft.date,
        records: [
          {
            cageId: p.cageId,
            feedAmount: p.feedKg,
            feedTypeId: p.feedTypeId,
            mortality: p.mortality,
            mortalityCause: p.mortalityCause,
            notes: p.notes,
            dissolvedOxygen: p.dissolvedOxygen,
            temperatureC: p.temperatureC,
          },
        ],
      })
      dailyRecordId = id
    } else {
      feedUsageId = await recordOutboundUsageAs(wctx, bound.actor, {
        feedTypeId: p.feedTypeId,
        cageId: p.cageId,
        quantity: p.quantityKg,
        usageDate: draft.date,
        notes: p.notes,
        source: 'issue',
        transactionType: 'issue',
        locationId: draft.siteId,
      })
    }
    const undoUntil = now + UNDO_WINDOW_MS
    await ctx.db.patch(draft._id, { status: 'committed', committedAt: now, undoUntil, dailyRecordId, feedUsageId })
    await ctx.db.insert('idempotencyKeys', {
      userId: draft.userId,
      key: idemKey,
      mutation: 'bot.commit',
      result: { dailyRecordId: dailyRecordId ?? null, feedUsageId: feedUsageId ?? null },
      createdAt: now,
    })
    return { status: 'saved', undoUntil }
  },
})

/** Record why a commit failed (after its transaction rolled back). */
export const markFailed = internalMutation({
  args: { pendingId: v.id('pendingBotActions'), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { pendingId, error }) => {
    const draft = await ctx.db.get(pendingId)
    if (draft && draft.status === 'pending') await ctx.db.patch(pendingId, { status: 'failed', error: error.slice(0, 300) })
    return null
  },
})

/** Cancel / Edit: the draft closes without writing. */
export async function closeDraft(
  ctx: MutationCtx,
  bindingId: Id<'channelBindings'>,
  pendingId: Id<'pendingBotActions'>,
): Promise<'closed' | 'not_pending' | 'not_found'> {
  const draft = await ctx.db.get(pendingId)
  if (!draft || draft.bindingId !== bindingId) return 'not_found'
  if (draft.status !== 'pending') return 'not_pending'
  await ctx.db.patch(pendingId, { status: 'cancelled' })
  return 'closed'
}

const undoResult = v.union(
  v.object({ status: v.literal('undone') }),
  v.object({ status: v.literal('too_late') }),
  v.object({ status: v.literal('refused'), message: v.string() }),
)

/** Undo a saved draft within 10 minutes: the same delete/reversal the web app does. */
export const undo = internalMutation({
  args: { pendingId: v.id('pendingBotActions'), bindingId: v.id('channelBindings'), sourceMessageId: v.string() },
  returns: undoResult,
  handler: async (ctx, args) => {
    const loaded = await loadDraft(ctx, args.pendingId, args.bindingId)
    if ('refused' in loaded) return { status: 'refused' as const, message: loaded.refused }
    const { draft, bound } = loaded
    if (draft.status !== 'committed' || !draft.undoUntil || draft.undoUntil < Date.now()) {
      return { status: 'too_late' as const }
    }
    const problem = await writeProblem(ctx, bound, draft)
    if (problem) return { status: 'refused' as const, message: problem }
    const wctx = botCtx(ctx, bound, args.sourceMessageId)
    if (draft.dailyRecordId) {
      const rec = await ctx.db.get(draft.dailyRecordId)
      // Edited in the app since: leave it to the app.
      const p = draft.payload
      if (!rec || p.kind !== 'daily_entry' || rec.feedAmount !== p.feedKg || rec.mortality !== p.mortality) {
        return { status: 'too_late' as const }
      }
      await removeDailyRecordAs(wctx, bound.actor, draft.dailyRecordId)
    } else if (draft.feedUsageId) {
      const txn = await ctx.db
        .query('feedInventoryTransactions')
        .withIndex('by_reference', (q) => q.eq('referenceId', String(draft.feedUsageId)))
        .first()
      if (!txn || txn.transactionType !== 'issue') return { status: 'too_late' as const }
      // Throws (and rolls back) when the feed has been fed from the bin since.
      await reverseTransactionAs(wctx, bound.actor, { transactionId: txn._id, reason: 'Undone from chat' })
    }
    await ctx.db.patch(draft._id, { status: 'undone' })
    return { status: 'undone' as const }
  },
})

/** Hourly: close drafts past their 24 h. */
export const expireDrafts = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const stale = await ctx.db
      .query('pendingBotActions')
      .withIndex('by_status_and_expiresAt', (q) => q.eq('status', 'pending').lt('expiresAt', Date.now()))
      .take(200)
    for (const d of stale) await ctx.db.patch(d._id, { status: 'expired' })
    return stale.length
  },
})

