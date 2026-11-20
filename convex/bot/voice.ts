/**
 * Voice notes to drafts (BOT-005, plan 2026-11-20 §1, artboard 49).
 *
 * A worker sends a voice note in Twi, Ewe, Ga, English or French. `route`
 * (inbound.ts) calls `voicePlan`, which refuses at once when the note is too
 * big, the role cannot record, the assistant is off, or no speech vendor is
 * configured for the binding's language (a polite reply, nothing else).
 * Otherwise it inserts one `voiceNotes` row per (binding, message) and starts
 * the `pipeline` workflow, so a webhook retry never runs twice:
 *   1. fetchAudio:      download now (Meta URLs expire in ~5 min), at most
 *                       16 MB, OGG/AAC/AMR/MP3/M4A by magic bytes; store in
 *                       R2 (or Convex storage) as a `files` row, deleted
 *                       after 30 days by `purgeOldAudio`;
 *   2. transcribeNote:  Whisper (EN/FR) or Khaya (Twi/Ewe/Ga), lib/speech.ts;
 *   3. draftAndReply:   the transcript is the agent's user turn (agent.ts);
 *                       its propose tools store drafts tagged with the note,
 *                       CHECK on unsure figures, blank for what was not said,
 *                       a cage picker when the cage was unclear. One reply:
 *                       transcript, English line, the drafts, [Save both]
 *                       [Edit] [Cancel].
 * Nothing is saved until a tap. Save both commits each draft through the
 * normal `pending.commit` (re-checked, once per draft, audited with the
 * channel and source message id).
 */
import { v, type Infer } from 'convex/values'
import * as Effect from 'effect/Effect'
import { internalAction, internalMutation, internalQuery } from '../_generated/server'
import type { ActionCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { workflow } from '../workflow'
import { can } from '../lib/permissions'
import { rateLimiter, retryAfterText } from '../lib/rateLimits'
import { isUserError } from '../lib/errors'
import { logAudit } from '../lib/tenancy'
import { todayIn, zoneFor } from '../lib/dates'
import { runEffect } from '../lib/effect'
import { FetchLive } from '../lib/effectHttp'
import { R2Storage, r2ConfigFromEnv, r2Live } from '../lib/r2'
import { filesProvider } from '../lib/r2Files'
import {
  figureIsUnsure,
  lowConfidenceWords,
  markedTranscript,
  speechAvailable,
  speechConfigFromEnv,
  speechLanguage,
  speechLayer,
  transcribe,
  SPEECH_LANGUAGES,
  type SpeechLanguage,
} from '../lib/speech'
import { checkBinding, botCtx, inScope, type BoundMember } from './scope'
import { agentTurn } from './agent'
import { closeDraft, UNDO_WINDOW_MS, UNIT_UNCONFIRMED } from './pending'
import { fetchTelegramAudio, fetchWhatsAppAudio, MAX_AUDIO_BYTES, type Audio } from './media'
import { deliver, telegramBotToken, whatsappBotConfig } from './outbound'
import { botLocale, t, type BotLocale } from './i18n'
import type { ChatMessageValue, RoutePlan, Target } from './validators'

/** Button verbs. Group verbs take `:<voiceNoteId>`; cage picks take `:<pendingId>:<choice index>`. */
export const VOICE_VERBS = {
  saveAll: 'vsa',
  edit: 'vse',
  cancel: 'vsx',
  undo: 'vsu',
  pick: 'vc',
  another: 'vco',
} as const

/** WhatsApp interactive bodies are at most 1024 characters. */
const BODY_BUDGET = 1000
const MAX_TRANSCRIPT_CHARS = 1500
const SHOWN_TRANSCRIPT_CHARS = 300
const MAX_DRAFTS = 10
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const text = (m: string): ChatMessageValue => ({ kind: 'text', text: m })
const isSpeechLanguage = (x: string): x is SpeechLanguage => (SPEECH_LANGUAGES as readonly string[]).includes(x)

// ---------------------------------------------------------------------------
// Routing (inside inbound.route's transaction)

/** The binding's spoken language. */
export function languageOf(bound: BoundMember): SpeechLanguage {
  return speechLanguage(bound.binding.voiceLanguage, bound.account.locale)
}

/** The site a note's audio is filed under: the active site, else a site-limited member's first. */
function noteSite(bound: BoundMember): Id<'farmLocations'> | undefined {
  if (bound.site) return bound.site._id
  const scope = bound.member.siteScope
  return scope === 'all' ? undefined : [...scope][0]
}

/** A voice note from a live binding: refuse what cannot be heard, else start the pipeline once. */
export async function voicePlan(
  ctx: MutationCtx,
  inbound: Doc<'channelInbound'>,
  bound: BoundMember,
  tgt: Target & { bindingId: Id<'channelBindings'> },
): Promise<RoutePlan> {
  const s = t(tgt.locale)
  const reply = (m: string): RoutePlan => ({ type: 'reply', ...tgt, messages: [text(m)] })
  if (!inbound.mediaId) return reply(s.voiceBadType)
  if (inbound.mediaSize !== undefined && inbound.mediaSize > MAX_AUDIO_BYTES) {
    return reply(s.voiceTooLarge(MAX_AUDIO_BYTES / (1024 * 1024)))
  }
  const language = languageOf(bound)
  // No key for this language: say so and do nothing else (no download, no row).
  if (!speechAvailable(language, speechConfigFromEnv())) return reply(s.voiceNotSetUp(s.languageNames[language]))
  if (!can(bound.member, 'production.daily.record')) return reply(s.voiceNoPermission)
  if (bound.company.settings?.aiAssistantEnabled !== true) return reply(s.aiDisabled)
  // Transcription is paid on the platform's key: it spends the SEC-004
  // assistant limits up front (check all, then spend), like an agent turn.
  const limits = [
    ['llmPerUserMinute', bound.binding.userId],
    ['llmPerUserHour', bound.binding.userId],
    ['llmPerCompanyHour', bound.binding.companyId],
  ] as const
  for (const [name, key] of limits) {
    const verdict = await rateLimiter.check(ctx, name, { key })
    if (!verdict.ok) return reply(s.aiQuota(retryAfterText(verdict.retryAfter)))
  }
  for (const [name, key] of limits) await rateLimiter.limit(ctx, name, { key })
  // The pipeline sends its own reply; a repeat of the same message does nothing.
  const voiceNoteId = await createVoiceNote(ctx, bound, {
    sourceMessageId: inbound.externalId,
    mediaId: inbound.mediaId,
    sentAt: inbound.sentAt,
    language,
  })
  return voiceNoteId ? { type: 'voice', ...tgt, voiceNoteId } : { type: 'none' }
}

/**
 * One voiceNotes row per (binding, message), the idempotency key of its
 * workflow run. Returns null when the message was already taken.
 */
export async function createVoiceNote(
  ctx: MutationCtx,
  bound: BoundMember,
  note: { sourceMessageId: string; mediaId: string; sentAt: number; language: SpeechLanguage },
): Promise<Id<'voiceNotes'> | null> {
  const bindingId = bound.binding._id
  const prior = await ctx.db
    .query('voiceNotes')
    .withIndex('by_bindingId_and_sourceMessageId', (q) => q.eq('bindingId', bindingId).eq('sourceMessageId', note.sourceMessageId))
    .first()
  if (prior) return null
  return await ctx.db.insert('voiceNotes', {
    companyId: bound.binding.companyId,
    locationId: noteSite(bound),
    userId: bound.binding.userId,
    bindingId,
    provider: bound.binding.provider,
    sourceMessageId: note.sourceMessageId,
    mediaId: note.mediaId,
    sentAt: note.sentAt,
    language: note.language,
    status: 'queued',
    createdAt: Date.now(),
  })
}

const STARTING = 'starting'

/** Claim a queued note for its single workflow run (false when already started). */
export const claimNote = internalMutation({
  args: { voiceNoteId: v.id('voiceNotes'), workflowId: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, { voiceNoteId, workflowId }) => {
    const note = await ctx.db.get(voiceNoteId)
    if (!note || note.status !== 'queued') return false
    // First call claims the note in its own transaction; the second records the run.
    if (workflowId === undefined) {
      if (note.workflowId) return false
      await ctx.db.patch(voiceNoteId, { workflowId: STARTING })
      return true
    }
    if (note.workflowId !== STARTING) return false
    await ctx.db.patch(voiceNoteId, { workflowId })
    return true
  },
})

/** From the processing action: start the note's workflow once. */
export async function startVoice(ctx: ActionCtx, plan: Extract<RoutePlan, { type: 'voice' }>): Promise<ChatMessageValue[]> {
  if (!(await ctx.runMutation(internal.bot.voice.claimNote, { voiceNoteId: plan.voiceNoteId }))) return []
  const workflowId = await workflow.start(ctx, internal.bot.voice.pipeline, { voiceNoteId: plan.voiceNoteId })
  await ctx.runMutation(internal.bot.voice.claimNote, { voiceNoteId: plan.voiceNoteId, workflowId: String(workflowId) })
  return []
}

/** VOICE <language>: set the spoken language of this chat's voice notes. */
export async function voiceCommand(ctx: MutationCtx, bound: BoundMember, arg: string): Promise<string> {
  const s = t(bound.locale)
  const raw = arg.trim().toLowerCase()
  if (!raw) return `${s.voiceLanguageSet(s.languageNames[languageOf(bound)])}\n${s.voiceLanguageHelp}`
  const language = speechLanguage(raw, null)
  // speechLanguage falls back to English: only accept English when it was asked for.
  if (language === 'en' && !['en', 'english', 'anglais'].includes(raw)) return s.voiceLanguageHelp
  await ctx.db.patch(bound.binding._id, { voiceLanguage: language })
  const available = speechAvailable(language, speechConfigFromEnv())
  return available ? s.voiceLanguageSet(s.languageNames[language]) : s.voiceNotSetUp(s.languageNames[language])
}

async function noteDrafts(ctx: MutationCtx | { db: MutationCtx['db'] }, voiceNoteId: Id<'voiceNotes'>) {
  return await ctx.db
    .query('pendingBotActions')
    .withIndex('by_voiceNoteId', (q) => q.eq('voiceNoteId', voiceNoteId))
    .take(MAX_DRAFTS + 5)
}

/** Voice-note buttons; null when the button is not ours. */
export async function voiceButton(
  ctx: MutationCtx,
  bound: BoundMember,
  verb: string,
  arg: string,
  tgt: Target & { bindingId: Id<'channelBindings'> },
  sourceMessageId: string,
): Promise<RoutePlan | null> {
  const verbs = Object.values(VOICE_VERBS) as string[]
  if (!verbs.includes(verb)) return null
  const s = t(tgt.locale)
  const reply = (...messages: ChatMessageValue[]): RoutePlan => ({ type: 'reply', ...tgt, messages })
  const notOpen = reply(text(s.notPending))

  if (verb === VOICE_VERBS.pick || verb === VOICE_VERBS.another) {
    const cut = arg.lastIndexOf(':')
    const pendingId = ctx.db.normalizeId('pendingBotActions', verb === VOICE_VERBS.pick ? arg.slice(0, Math.max(0, cut)) : arg)
    const draft = pendingId ? await ctx.db.get(pendingId) : null
    if (!draft || draft.bindingId !== bound.binding._id || draft.status !== 'pending' || !draft.voiceNoteId || !draft.unitChoices) {
      return notOpen
    }
    if (verb === VOICE_VERBS.another) {
      const rows = draft.unitChoices
        .map((c, i) => ({ id: `${VOICE_VERBS.pick}:${draft._id}:${i}`, title: c.name.slice(0, 24) }))
        .slice(0, 10)
      return reply({ kind: 'list', text: s.pickFromList, button: s.pick, rows })
    }
    const index = Number(arg.slice(cut + 1))
    const choice = Number.isInteger(index) ? draft.unitChoices[index] : undefined
    if (!choice) return notOpen
    const problem = await pickCage(ctx, bound, draft, choice.cageId)
    if (problem) return reply(text(s.commitFailed(problem)))
    const note = await ctx.db.get(draft.voiceNoteId)
    if (!note) return notOpen
    return reply(text(s.cagePicked(choice.name)), ...(await groupMessages(ctx, bound, note)))
  }

  const voiceNoteId = ctx.db.normalizeId('voiceNotes', arg)
  const note = voiceNoteId ? await ctx.db.get(voiceNoteId) : null
  // Another chat's note is just "not open".
  if (!note || note.bindingId !== bound.binding._id || note.companyId !== bound.binding.companyId) return notOpen
  if (verb === VOICE_VERBS.saveAll) return { type: 'voice_commit', ...tgt, voiceNoteId: note._id, sourceMessageId }
  if (verb === VOICE_VERBS.undo) return { type: 'voice_undo', ...tgt, voiceNoteId: note._id, sourceMessageId }
  const open = (await noteDrafts(ctx, note._id)).filter((d) => d.status === 'pending')
  if (!open.length) return notOpen
  for (const d of open) await closeDraft(ctx, bound.binding._id, d._id)
  return reply(text(verb === VOICE_VERBS.edit ? s.editPrompt : s.cancelled))
}

/** Point a draft at the cage the worker picked, re-checking scope like a new proposal. Returns a problem or null. */
async function pickCage(
  ctx: MutationCtx,
  bound: BoundMember,
  draft: Doc<'pendingBotActions'>,
  cageId: Id<'cages'>,
): Promise<string | null> {
  const cage = await ctx.db.get(cageId)
  if (!cage || cage.companyId !== bound.binding.companyId || cage.archivedAt || !inScope(bound, cage.locationId)) {
    return 'unit not found'
  }
  const p = draft.payload
  const oldName = p.cageName ?? ''
  const oldId = p.cageId ? String(p.cageId) : '-'
  if (p.kind === 'daily_entry') {
    const existing = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) => q.eq('cageId', cage._id).eq('date', draft.date))
      .first()
    if (existing) return `${cage.name} already has an entry for ${draft.date}. Correct it in the app.`
  }
  const needsCheck = (draft.needsCheck ?? []).filter((f) => f !== 'unit')
  await ctx.db.patch(draft._id, {
    payload: { ...p, cageId: cage._id, cageName: cage.name },
    siteId: p.kind === 'daily_entry' ? cage.locationId : (draft.siteId ?? cage.locationId),
    summary: oldName ? draft.summary.replace(oldName, cage.name) : draft.summary,
    fingerprint: draft.fingerprint.replace(oldId, String(cage._id)),
    needsCheck: needsCheck.length ? needsCheck : undefined,
    unitChoices: undefined,
  })
  return null
}

// ---------------------------------------------------------------------------
// The reply (pure)

export type VoiceView = {
  transcript: string
  english: string | null
  language: SpeechLanguage
  today: string
  drafts: Array<
    Pick<Doc<'pendingBotActions'>, '_id' | 'payload' | 'date' | 'needsCheck' | 'checkHeard' | 'notSaid' | 'unitChoices' | 'duplicateOf'>
  >
}

function fmtKg(kg: number) {
  return `${Math.round(kg * 100) / 100} kg`
}

/** Transcript, English line, numbered drafts with CHECK / blank marks, [Save both] [Edit] [Cancel], then cage pickers. */
export function voiceMessages(locale: BotLocale, voiceNoteId: Id<'voiceNotes'>, view: VoiceView): ChatMessageValue[] {
  const s = t(locale)
  const shown = view.transcript.length > SHOWN_TRANSCRIPT_CHARS ? `${view.transcript.slice(0, SHOWN_TRANSCRIPT_CHARS)}...` : view.transcript
  const header = [`"${shown}"`]
  const translated = view.language !== 'en' && !!view.english
  header.push(s.heardIn(s.languageNames[view.language], translated))
  if (translated && view.english) header.push(view.english.slice(0, SHOWN_TRANSCRIPT_CHARS))
  if (!view.drafts.length) return [text(header.join('\n'))]

  const check = (d: VoiceView['drafts'][number], field: string, value: string) =>
    d.needsCheck?.includes(field) ? `${s.check} ${value}` : value
  const blank = (d: VoiceView['drafts'][number], field: string) => !!d.notSaid?.includes(field)
  const lines: string[] = []
  const notes: string[] = []
  const allCages = view.drafts.every((d) => d.payload.kind === 'daily_entry')
  lines.push(s.heardCount(view.drafts.length, allCages))
  view.drafts.forEach((d, i) => {
    const p = d.payload
    const unit = p.cageName ?? ''
    if (p.kind === 'daily_entry') {
      lines.push(`${i + 1}. ${s.fieldUnit}: ${check(d, 'unit', unit)}`)
      const feed = blank(d, 'feedKg') ? s.notSaid : check(d, 'feedKg', `${fmtKg(p.feedKg)}${p.feedTypeName ? ` ${p.feedTypeName}` : ''}`)
      const dead = blank(d, 'mortality') ? s.notSaid : check(d, 'mortality', s.fish(p.mortality))
      lines.push(`${s.fieldFeed}: ${feed}`, `${s.fieldMortality}: ${dead}`)
      if (p.notes) lines.push(p.notes.slice(0, 120))
      const field = d.needsCheck?.find((f) => f === 'feedKg' || f === 'mortality')
      if (field) notes.push(s.checkNote(d.checkHeard, field === 'feedKg' ? fmtKg(p.feedKg) : String(p.mortality), unit))
    } else {
      const to = unit ? ` > ${check(d, 'unit', unit)}` : ''
      lines.push(`${i + 1}. ${s.fieldIssue}: ${check(d, 'quantityKg', `${fmtKg(p.quantityKg)} ${p.feedTypeName}`)}${to}`)
      if (d.needsCheck?.includes('quantityKg')) notes.push(s.checkNote(d.checkHeard, fmtKg(p.quantityKg), unit || p.feedTypeName))
    }
    if (d.duplicateOf) lines.push(s.duplicateWarning)
  })
  const date = view.drafts[0].date
  notes.push(s.savingFor(date, date === view.today))

  // Every draft line must be visible before Save: never cut one off. When
  // the whole reply does not fit WhatsApp's button body, the transcript goes
  // first as its own message, then (if still too long) the drafts too.
  const draftText = [...lines, '', ...notes].join('\n')
  const full = [...header, '', draftText].join('\n')
  const out: ChatMessageValue[] = []
  let buttonText = full
  if (full.length > BODY_BUDGET) {
    out.push(text(header.join('\n')))
    buttonText = draftText
    if (draftText.length > BODY_BUDGET) {
      out.push(text(draftText))
      buttonText = s.heardCount(view.drafts.length, allCages)
    }
  }
  out.push(
    {
      kind: 'buttons',
      text: buttonText,
      buttons: [
        { id: `${VOICE_VERBS.saveAll}:${voiceNoteId}`, title: s.saveGroup(view.drafts.length).slice(0, 20) },
        { id: `${VOICE_VERBS.edit}:${voiceNoteId}`, title: s.edit.slice(0, 20) },
        { id: `${VOICE_VERBS.cancel}:${voiceNoteId}`, title: s.cancel.slice(0, 20) },
      ],
    },
  )
  // "Which cage?" with the 2 closest matches + Another (artboard 49).
  for (const d of view.drafts) {
    if (!d.needsCheck?.includes('unit') || !d.unitChoices?.length) continue
    const p = d.payload
    const what =
      p.kind === 'daily_entry'
        ? !blank(d, 'mortality') && p.mortality > 0
          ? s.whatDead(p.mortality)
          : !blank(d, 'feedKg') && p.feedKg > 0
            ? s.whatFeed(fmtKg(p.feedKg))
            : null
        : s.whatFeed(fmtKg(p.quantityKg))
    const buttons = d.unitChoices.slice(0, 2).map((c, i) => ({ id: `${VOICE_VERBS.pick}:${d._id}:${i}`, title: c.name.slice(0, 20) }))
    if (d.unitChoices.length > 2) buttons.push({ id: `${VOICE_VERBS.another}:${d._id}`, title: s.another.slice(0, 20) })
    out.push({ kind: 'buttons', text: s.whichCage(what), buttons })
  }
  return out
}

/** The model's "English: ..." first line, and the rest of its reply. */
export function splitEnglish(reply: string): { english: string | null; rest: string } {
  const lines = reply.split('\n')
  const first = lines[0]?.trim() ?? ''
  const m = /^\**\s*english\s*\**\s*:\s*(.+)$/i.exec(first)
  if (!m) return { english: null, rest: reply.trim() }
  return { english: m[1].replace(/\*+$/, '').trim().slice(0, 500) || null, rest: lines.slice(1).join('\n').trim() }
}

async function groupMessages(ctx: MutationCtx, bound: BoundMember, note: Doc<'voiceNotes'>): Promise<ChatMessageValue[]> {
  const drafts = (await noteDrafts(ctx, note._id)).filter((d) => d.status === 'pending')
  if (!drafts.length) return []
  return voiceMessages(bound.locale, note._id, {
    transcript: note.transcript ?? '',
    english: note.english ?? null,
    language: isSpeechLanguage(note.language) ? note.language : 'en',
    today: todayIn(zoneFor(bound.site, bound.company)),
    drafts,
  })
}

// ---------------------------------------------------------------------------
// Workflow

const stepResult = v.union(v.object({ ok: v.literal(true) }), v.object({ ok: v.literal(false), reply: v.string() }))
type StepResult = Infer<typeof stepResult>

export const pipeline = workflow
  .define({ args: { voiceNoteId: v.id('voiceNotes') }, returns: v.null() })
  .handler(async (step, { voiceNoteId }): Promise<null> => {
    const fetched = await step.runAction(internal.bot.voice.fetchAudio, { voiceNoteId })
    if (!fetched.ok) {
      await step.runAction(internal.bot.voice.sendReply, { voiceNoteId, text: fetched.reply })
      return null
    }
    const heard = await step.runAction(internal.bot.voice.transcribeNote, { voiceNoteId })
    if (!heard.ok) {
      await step.runAction(internal.bot.voice.sendReply, { voiceNoteId, text: heard.reply })
      return null
    }
    await step.runAction(internal.bot.voice.draftAndReply, { voiceNoteId })
    return null
  })

const noteContext = v.union(
  v.null(),
  v.object({
    note: v.object({
      _id: v.id('voiceNotes'),
      companyId: v.id('companies'),
      bindingId: v.id('channelBindings'),
      provider: v.union(v.literal('whatsapp'), v.literal('telegram')),
      mediaId: v.string(),
      sourceMessageId: v.string(),
      sentAt: v.number(),
      language: v.string(),
      status: v.string(),
      fileId: v.optional(v.id('files')),
      transcript: v.optional(v.string()),
      lowConfidence: v.optional(v.array(v.string())),
    }),
    address: v.string(),
    locale: v.union(v.literal('en'), v.literal('fr')),
    file: v.union(
      v.null(),
      v.object({ mime: v.string(), r2Key: v.optional(v.string()), storageId: v.optional(v.id('_storage')) }),
    ),
  }),
)

type NoteContext = Infer<typeof noteContext>

/** The note with its live binding's address and locale (null when the binding is gone). */
export const noteForStep = internalQuery({
  args: { voiceNoteId: v.id('voiceNotes') },
  returns: noteContext,
  handler: async (ctx, { voiceNoteId }) => {
    const note = await ctx.db.get(voiceNoteId)
    const binding = note ? await ctx.db.get(note.bindingId) : null
    if (!note || !binding || binding.revokedAt) return null
    const account = await ctx.db.get(binding.userId)
    const file = note.fileId ? await ctx.db.get(note.fileId) : null
    return {
      note: {
        _id: note._id,
        companyId: note.companyId,
        bindingId: note.bindingId,
        provider: note.provider,
        mediaId: note.mediaId,
        sourceMessageId: note.sourceMessageId,
        sentAt: note.sentAt,
        language: note.language,
        status: note.status,
        fileId: note.fileId,
        transcript: note.transcript,
        lowConfidence: note.lowConfidence,
      },
      address: binding.address,
      locale: botLocale(account?.locale),
      file: file ? { mime: file.mime, r2Key: file.r2Key, storageId: file.storageId } : null,
    }
  },
})

export const failNote = internalMutation({
  args: { voiceNoteId: v.id('voiceNotes'), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { voiceNoteId, error }) => {
    const note = await ctx.db.get(voiceNoteId)
    if (note && note.status !== 'ready' && note.status !== 'failed') {
      await ctx.db.patch(voiceNoteId, { status: 'failed', error: error.slice(0, 300) })
    }
    return null
  },
})

/** Register the stored audio in the files register under the note's organization. */
export const attachAudio = internalMutation({
  args: {
    voiceNoteId: v.id('voiceNotes'),
    mime: v.string(),
    size: v.number(),
    storageId: v.optional(v.id('_storage')),
    r2Key: v.optional(v.string()),
  },
  returns: v.union(v.id('files'), v.null()),
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.voiceNoteId)
    const binding = note ? await ctx.db.get(note.bindingId) : null
    const checked = binding ? await checkBinding(ctx, binding) : null
    if (!note || !checked?.ok || note.status !== 'queued' || note.fileId) {
      if (args.storageId) await ctx.storage.delete(args.storageId)
      return null
    }
    const ext = { 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a' }[args.mime] ?? 'audio'
    const name = `voice-${note.sourceMessageId.replace(/[^A-Za-z0-9._-]/g, '').slice(-40) || 'note'}.${ext}`
    const fileId = await ctx.db.insert('files', {
      companyId: note.companyId,
      locationId: note.locationId,
      entityType: 'voiceNotes',
      entityId: note._id,
      provider: args.r2Key ? 'r2' : 'convex',
      storageId: args.storageId,
      r2Key: args.r2Key,
      name,
      mime: args.mime,
      size: args.size,
      uploadedBy: note.userId,
      createdAt: Date.now(),
    })
    await ctx.db.patch(note._id, { fileId, mime: args.mime, size: args.size, status: 'stored' })
    await logAudit(botCtx(ctx, checked.bound, note.sourceMessageId), {
      actionType: 'file_attached',
      tableName: 'files',
      recordId: fileId,
      newValues: { entityType: 'voiceNotes', entityId: note._id, name, mime: args.mime, size: args.size },
      locationId: note.locationId,
    })
    return fileId
  },
})

async function storeAudio(ctx: ActionCtx, companyId: Id<'companies'>, voiceNoteId: Id<'voiceNotes'>, audio: Audio) {
  if (filesProvider() === 'r2' && r2ConfigFromEnv()) {
    const key = `files/${companyId}/voice/${voiceNoteId}`
    await runEffect(
      Effect.gen(function* () {
        const r2 = yield* R2Storage
        yield* r2.put(key, audio.bytes, { contentType: audio.mime })
      }).pipe(Effect.provide(r2Live())),
    )
    return { r2Key: key }
  }
  const storageId = await ctx.storage.store(new Blob([audio.bytes as BlobPart], { type: audio.mime }))
  return { storageId }
}

/** Step 1: download the note now and file it. */
export const fetchAudio = internalAction({
  args: { voiceNoteId: v.id('voiceNotes') },
  returns: stepResult,
  handler: async (ctx, { voiceNoteId }): Promise<StepResult> => {
    const c: NoteContext = await ctx.runQuery(internal.bot.voice.noteForStep, { voiceNoteId })
    if (!c) return { ok: false as const, reply: '' }
    if (c.note.status !== 'queued') return c.note.fileId ? { ok: true as const } : { ok: false as const, reply: '' }
    const s = t(c.locale)
    const fail = async (error: string, reply: string) => {
      await ctx.runMutation(internal.bot.voice.failNote, { voiceNoteId, error })
      return { ok: false as const, reply }
    }
    let program
    if (c.note.provider === 'whatsapp') {
      const config = whatsappBotConfig()
      if (!config) return await fail('whatsapp_not_configured', s.voiceDownloadFailed)
      program = fetchWhatsAppAudio(c.note.mediaId, config.accessToken)
    } else {
      const token = telegramBotToken()
      if (!token) return await fail('telegram_not_configured', s.voiceDownloadFailed)
      program = fetchTelegramAudio(c.note.mediaId, token)
    }
    const fetched = await runEffect(
      program.pipe(
        Effect.map((audio) => ({ ok: true as const, audio })),
        Effect.catchTag('MediaError', (e) => Effect.succeed({ ok: false as const, reason: e.reason })),
        Effect.provide(FetchLive),
      ),
    )
    if (!fetched.ok) {
      const reply =
        fetched.reason === 'too_large'
          ? s.voiceTooLarge(MAX_AUDIO_BYTES / (1024 * 1024))
          : fetched.reason === 'bad_type'
            ? s.voiceBadType
            : s.voiceDownloadFailed
      return await fail(`media_${fetched.reason}`, reply)
    }
    const stored = await storeAudio(ctx, c.note.companyId, voiceNoteId, fetched.audio)
    const fileId = await ctx.runMutation(internal.bot.voice.attachAudio, {
      voiceNoteId,
      mime: fetched.audio.mime,
      size: fetched.audio.bytes.byteLength,
      ...stored,
    })
    if (!fileId) {
      if (stored.r2Key) await ctx.scheduler.runAfter(0, internal.files.deleteR2Object, { key: stored.r2Key })
      return await fail('binding_changed', t(c.locale).bindingInactive)
    }
    return { ok: true as const }
  },
})

export const saveTranscript = internalMutation({
  args: {
    voiceNoteId: v.id('voiceNotes'),
    transcript: v.string(),
    lowConfidence: v.array(v.string()),
    vendor: v.string(),
    model: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.voiceNoteId)
    if (!note || note.status !== 'stored') return null
    await ctx.db.patch(note._id, {
      status: 'transcribed',
      transcript: args.transcript.slice(0, MAX_TRANSCRIPT_CHARS),
      lowConfidence: args.lowConfidence.slice(0, 30).map((w) => w.slice(0, 40)),
      vendor: args.vendor.slice(0, 40),
      model: args.model.slice(0, 80),
    })
    return null
  },
})

async function readAudio(ctx: ActionCtx, file: { mime: string; r2Key?: string; storageId?: Id<'_storage'> }): Promise<Uint8Array | null> {
  if (file.r2Key) {
    const key = file.r2Key
    const blob = await runEffect(
      Effect.gen(function* () {
        const r2 = yield* R2Storage
        return yield* r2.get(key)
      }).pipe(Effect.provide(r2Live())),
    )
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  }
  if (file.storageId) {
    const blob = await ctx.storage.get(file.storageId)
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  }
  return null
}

/** Step 2: speech to text with the vendor for the note's language. */
export const transcribeNote = internalAction({
  args: { voiceNoteId: v.id('voiceNotes') },
  returns: stepResult,
  handler: async (ctx, { voiceNoteId }): Promise<StepResult> => {
    const c: NoteContext = await ctx.runQuery(internal.bot.voice.noteForStep, { voiceNoteId })
    if (!c) return { ok: false as const, reply: '' }
    if (c.note.status === 'transcribed') return { ok: true as const }
    if (c.note.status !== 'stored' || !c.file) return { ok: false as const, reply: '' }
    const s = t(c.locale)
    const fail = async (error: string, reply: string) => {
      await ctx.runMutation(internal.bot.voice.failNote, { voiceNoteId, error })
      return { ok: false as const, reply }
    }
    const language: SpeechLanguage = isSpeechLanguage(c.note.language) ? c.note.language : 'en'
    const layer = speechLayer(language, speechConfigFromEnv())
    if (!layer) return await fail('speech_not_configured', s.voiceNotSetUp(s.languageNames[language]))
    const bytes = await readAudio(ctx, c.file)
    if (!bytes) return await fail('audio_missing', s.voiceUnavailable)
    const heard = await runEffect(
      transcribe({ bytes, mime: c.file.mime }, language).pipe(
        Effect.map((r) => ({ ok: true as const, r })),
        Effect.catchTag('SpeechError', (e) => Effect.succeed({ ok: false as const, reason: e.reason, status: e.status })),
        Effect.provide(layer),
        Effect.provide(FetchLive),
      ),
    )
    if (!heard.ok) return await fail(`speech_${heard.reason}${heard.status ? `_${heard.status}` : ''}`, s.voiceUnavailable)
    if (!heard.r.text.trim()) return await fail('speech_empty', s.voiceEmpty)
    await ctx.runMutation(internal.bot.voice.saveTranscript, {
      voiceNoteId,
      transcript: heard.r.text,
      lowConfidence: lowConfidenceWords(heard.r.words),
      vendor: heard.r.vendor,
      model: heard.r.model,
    })
    return { ok: true as const }
  },
})

/**
 * After the agent: mark figures heard only as low-confidence words, store
 * the English line, close the note, and build the reply.
 */
export const finishNote = internalMutation({
  args: { voiceNoteId: v.id('voiceNotes'), english: v.union(v.string(), v.null()), rest: v.string() },
  returns: v.array(
    v.union(
      v.object({ kind: v.literal('text'), text: v.string() }),
      v.object({ kind: v.literal('buttons'), text: v.string(), buttons: v.array(v.object({ id: v.string(), title: v.string() })) }),
    ),
  ),
  handler: async (ctx, { voiceNoteId, english, rest }) => {
    const note = await ctx.db.get(voiceNoteId)
    const binding = note ? await ctx.db.get(note.bindingId) : null
    const checked = binding ? await checkBinding(ctx, binding) : null
    if (!note || !checked?.ok || note.status !== 'transcribed') return []
    const bound = checked.bound
    const low = note.lowConfidence ?? []
    const drafts = (await noteDrafts(ctx, note._id)).filter((d) => d.status === 'pending')
    for (const d of drafts) {
      const p = d.payload
      const needs = new Set(d.needsCheck ?? [])
      if (p.kind === 'daily_entry') {
        if (!d.notSaid?.includes('feedKg') && figureIsUnsure(low, p.feedKg)) needs.add('feedKg')
        if (!d.notSaid?.includes('mortality') && figureIsUnsure(low, p.mortality)) needs.add('mortality')
      } else if (figureIsUnsure(low, p.quantityKg)) {
        needs.add('quantityKg')
      }
      if (needs.size !== (d.needsCheck?.length ?? 0)) await ctx.db.patch(d._id, { needsCheck: [...needs] })
    }
    await ctx.db.patch(note._id, { status: 'ready', english: english ?? undefined, draftCount: drafts.length })
    const fresh = await ctx.db.get(note._id)
    const messages = fresh ? await groupMessages(ctx, bound, fresh) : []
    if (messages.length) return messages as Array<Extract<ChatMessageValue, { kind: 'text' | 'buttons' }>>
    // No draft (a question, or nothing to record): transcript + the model's answer.
    const header = voiceMessages(bound.locale, note._id, {
      transcript: note.transcript ?? '',
      english,
      language: isSpeechLanguage(note.language) ? note.language : 'en',
      today: '',
      drafts: [],
    })
    const s = t(bound.locale)
    return [...header, text(rest.slice(0, 1500) || s.help)] as Array<Extract<ChatMessageValue, { kind: 'text' | 'buttons' }>>
  },
})

/** Step 3: the transcript as the agent's user turn, then one reply. Runs once (no retry: it sends). */
export const draftAndReply = internalAction({
  args: { voiceNoteId: v.id('voiceNotes') },
  returns: v.null(),
  handler: async (ctx, { voiceNoteId }): Promise<null> => {
    const c: NoteContext = await ctx.runQuery(internal.bot.voice.noteForStep, { voiceNoteId })
    if (!c || c.note.status !== 'transcribed' || !c.note.transcript) return null
    const language: SpeechLanguage = isSpeechLanguage(c.note.language) ? c.note.language : 'en'
    const target = { provider: c.note.provider, address: c.address, companyId: c.note.companyId, bindingId: c.note.bindingId }
    const r = await agentTurn(ctx, {
      bindingId: c.note.bindingId,
      text: markedTranscript(c.note.transcript, c.note.lowConfidence ?? []),
      sourceMessageId: c.note.sourceMessageId,
      sentAt: c.note.sentAt,
      voice: { voiceNoteId, language },
    })
    if (!r.ok) {
      await ctx.runMutation(internal.bot.voice.failNote, { voiceNoteId, error: 'agent_refused' })
      await deliver(ctx, target, [text(r.message)])
      return null
    }
    const { english, rest } = language === 'en' ? { english: null, rest: r.reply } : splitEnglish(r.reply)
    const messages = await ctx.runMutation(internal.bot.voice.finishNote, { voiceNoteId, english, rest })
    if (messages.length) await deliver(ctx, target, messages)
    return null
  },
})

/** A failure reply (empty text: nothing to say, e.g. the binding is gone). */
export const sendReply = internalAction({
  args: { voiceNoteId: v.id('voiceNotes'), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (!args.text) return null
    const c: NoteContext = await ctx.runQuery(internal.bot.voice.noteForStep, { voiceNoteId: args.voiceNoteId })
    if (!c) return null
    await deliver(ctx, { provider: c.note.provider, address: c.address, companyId: c.note.companyId, bindingId: c.note.bindingId }, [
      text(args.text),
    ])
    return null
  },
})

// ---------------------------------------------------------------------------
// Save both / Undo (process.ts)

/** Open (or, for undo, committed) drafts of a note, for this binding only. */
export const groupDrafts = internalQuery({
  args: { voiceNoteId: v.id('voiceNotes'), bindingId: v.id('channelBindings'), status: v.union(v.literal('pending'), v.literal('committed')) },
  returns: v.array(
    v.object({ pendingId: v.id('pendingBotActions'), name: v.string(), unitUnconfirmed: v.boolean(), duplicate: v.boolean() }),
  ),
  handler: async (ctx, { voiceNoteId, bindingId, status }) => {
    const note = await ctx.db.get(voiceNoteId)
    if (!note || note.bindingId !== bindingId) return []
    const rows = await ctx.db
      .query('pendingBotActions')
      .withIndex('by_voiceNoteId', (q) => q.eq('voiceNoteId', voiceNoteId))
      .take(MAX_DRAFTS + 5)
    return rows
      .filter((d) => d.bindingId === bindingId && d.status === status)
      .map((d) => ({
        pendingId: d._id,
        name: d.payload.cageName ?? d.payload.feedTypeName ?? '',
        unitUnconfirmed: !!d.needsCheck?.includes('unit'),
        duplicate: !!d.duplicateOf,
      }))
  },
})

type GroupDraft = { pendingId: Id<'pendingBotActions'>; name: string; unitUnconfirmed: boolean; duplicate: boolean }
type CommitPlan = Extract<RoutePlan, { type: 'voice_commit' }>
type UndoPlan = Extract<RoutePlan, { type: 'voice_undo' }>

function joinNames(names: string[], locale: BotLocale): string {
  if (names.length <= 1) return names.join('')
  const and = locale === 'fr' ? ' et ' : ' and '
  return `${names.slice(0, -1).join(', ')}${and}${names[names.length - 1]}`
}

/**
 * Save both: every open draft of the note through the normal commit (each
 * once, re-checked). A draft whose cage was not picked blocks the save. The
 * duplicate warning was shown in the group message, so the tap confirms it.
 */
export async function commitVoice(ctx: ActionCtx, plan: CommitPlan): Promise<ChatMessageValue[]> {
  const s = t(plan.locale)
  const drafts: GroupDraft[] = await ctx.runQuery(internal.bot.voice.groupDrafts, {
    voiceNoteId: plan.voiceNoteId,
    bindingId: plan.bindingId,
    status: 'pending',
  })
  if (!drafts.length) {
    const done: GroupDraft[] = await ctx.runQuery(internal.bot.voice.groupDrafts, {
      voiceNoteId: plan.voiceNoteId,
      bindingId: plan.bindingId,
      status: 'committed',
    })
    return [text(done.length ? s.alreadySaved : s.notPending)]
  }
  if (drafts.some((d) => d.unitUnconfirmed)) return [text(s.pickCageFirst)]
  const saved: string[] = []
  const failed: string[] = []
  for (const d of drafts) {
    try {
      const r = await ctx.runMutation(internal.bot.pending.commit, {
        pendingId: d.pendingId,
        bindingId: plan.bindingId,
        sourceMessageId: plan.sourceMessageId,
        confirmDuplicate: true,
      })
      if (r.status === 'saved' || r.status === 'already') saved.push(d.name)
      else if (r.status === 'refused' && r.message === UNIT_UNCONFIRMED) failed.push(`- ${d.name}: ${s.pickCageFirst}`)
      else if (r.status === 'refused') failed.push(`- ${d.name}: ${r.message}`)
      else if (r.status === 'expired') failed.push(`- ${d.name}: ${s.expired}`)
      else failed.push(`- ${d.name}: ${s.notPending}`)
    } catch (err) {
      const msg = isUserError(err) ? err.data.message : 'something went wrong'
      await ctx.runMutation(internal.bot.pending.markFailed, { pendingId: d.pendingId, error: msg })
      failed.push(`- ${d.name}: ${msg}`)
    }
  }
  const out: ChatMessageValue[] = []
  if (saved.length) {
    out.push({
      kind: 'buttons',
      text: s.voiceSaved(joinNames(saved, plan.locale), Math.round(UNDO_WINDOW_MS / 60_000)),
      buttons: [{ id: `${VOICE_VERBS.undo}:${plan.voiceNoteId}`, title: s.undo }],
    })
  }
  if (failed.length) out.push(text(failed.slice(0, 10).map((f) => s.commitFailed(f.replace(/^- /, ''))).join('\n')))
  return out
}

/** Undo every saved draft of the note within 10 minutes. */
export async function undoVoice(ctx: ActionCtx, plan: UndoPlan): Promise<ChatMessageValue[]> {
  const s = t(plan.locale)
  const drafts: GroupDraft[] = await ctx.runQuery(internal.bot.voice.groupDrafts, {
    voiceNoteId: plan.voiceNoteId,
    bindingId: plan.bindingId,
    status: 'committed',
  })
  let undone = 0
  let late = 0
  for (const d of drafts) {
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
  if (!undone) return [text(drafts.length ? s.undoTooLate : s.notPending)]
  return [text(late ? `${s.voiceUndoAll(undone)}\n${s.undoTooLate}` : s.voiceUndoAll(undone))]
}

// ---------------------------------------------------------------------------
// Retention

/** Daily: delete voice-note audio older than 30 days (the transcript stays). */
export const purgeOldAudio = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS
    // Rows older than the window were purged by earlier runs.
    const rows = await ctx.db
      .query('voiceNotes')
      .withIndex('by_createdAt', (q) => q.gt('createdAt', cutoff - 30 * DAY_MS).lt('createdAt', cutoff))
      .take(500)
    let n = 0
    for (const note of rows) {
      if (note.audioDeletedAt || !note.fileId) continue
      const file = await ctx.db.get(note.fileId)
      if (file) {
        if (file.r2Key) await ctx.scheduler.runAfter(0, internal.files.deleteR2Object, { key: file.r2Key })
        if (file.storageId) await ctx.storage.delete(file.storageId)
        await ctx.db.delete(file._id)
      }
      await ctx.db.patch(note._id, { fileId: undefined, audioDeletedAt: Date.now() })
      n++
    }
    return n
  },
})
