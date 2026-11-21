/**
 * Approvals over chat (BOT-007, research report §5).
 *
 *   onApprovalRequested (stocking, top-up, transfer)
 *     └─ queueApprovalPrompts: one `botApprovalPrompts` row per approver chat
 *        bound to the request's organization; WhatsApp chats only when the
 *        person's WhatsApp notifications are on; held until their quiet
 *        hours end; `send` scheduled
 *   send: re-check binding, permission and that the request is still pending,
 *        then Approve / Reject buttons (WhatsApp reply buttons inside the 24 h
 *        window, the `farm_approval_request` template outside it; Telegram
 *        inline keyboard)
 *   tap Approve → `decide` (approve)
 *   tap Reject  → reasons list, or the next text message → `decide` (reject)
 *
 * `decide` re-checks the binding (membership, verified phone, organization),
 * the approve permission and the member's sites, then calls the same helper
 * as the web approval (`approveStockingAs`, …), so segregation of duties
 * (`assertDifferentApprover`), farm rules and the audit row (with the chat
 * channel and message id) are exactly those of the web. A prompt decides
 * once: a double tap or a webhook retry gets "already decided".
 */
import { v, type Infer } from 'convex/values'
import { internalAction, internalMutation } from '../_generated/server'
import type { ActionCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { can, type Permission } from '../lib/permissions'
import { isUserError } from '../lib/errors'
import { companyZone, prefsFor } from '../automation/engine'
import { inQuietHours, localParts, parseHhmm } from '../automation/schedule'
import { loadApproval } from '../approvalAlerts'
import { approveStockingAs, approveTopupAs, rejectStockingAs, rejectTopupAs } from '../stocking'
import { approveFishTransferAs, rejectFishTransferAs } from '../fishTransfers'
import { botCtx, checkBinding, inScope } from './scope'
import { APPROVAL_TEMPLATES, t, type BotLocale } from './i18n'
import { chatMessage, targetValidator, type ChatMessageValue } from './validators'
import { deliver, logProactive } from './outbound'

export const PROMPT_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** A text message counts as the rejection reason for this long after tapping Reject. */
export const REASON_WINDOW_MS = 30 * 60 * 1000
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_PROMPTS_PER_REQUEST = 25
export const MAX_REASON_CHARS = 500

export type BotApprovalKind = 'stocking' | 'topup' | 'transfer'
export const botApprovalKind = v.union(v.literal('stocking'), v.literal('topup'), v.literal('transfer'))

const PERMISSION: Record<BotApprovalKind, Permission> = {
  stocking: 'production.stocking.approve',
  topup: 'production.stocking.approve',
  transfer: 'production.transfer.approve',
}

export const REJECT_REASON_CODES = ['count', 'unit', 'date', 'weight', 'plan'] as const
export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number]

/** Milliseconds until the quiet hours that contain `now` end (0 when outside them). */
export function quietHoursDelay(quiet: { start: string; end: string } | undefined, now: number, tz: string): number {
  if (!quiet || !inQuietHours(quiet, now, tz)) return 0
  const e = parseHhmm(quiet.end)
  if (!e) return 0
  const p = localParts(now, tz)
  const end = e.hh * 60 + e.mm
  const minutes = (end - p.minutes + 24 * 60) % (24 * 60)
  return (minutes * 60 - p.second) * 1000
}

/**
 * Called by onApprovalRequested with the approvers it notified. Queues a chat
 * prompt for each live binding of theirs in the request's organization.
 */
export async function queueApprovalPrompts(
  ctx: MutationCtx,
  args: {
    kind: BotApprovalKind
    recordId: string
    companyId: Id<'companies'>
    subject: string
    approvers: Doc<'users'>[]
  },
): Promise<number> {
  const now = Date.now()
  const existing = await ctx.db
    .query('botApprovalPrompts')
    .withIndex('by_kind_and_recordId', (q) => q.eq('kind', args.kind).eq('recordId', args.recordId))
    .take(MAX_PROMPTS_PER_REQUEST)
  const seen = new Set(existing.map((p) => String(p.bindingId)))
  const { tz } = await companyZone(ctx, args.companyId)
  let queued = existing.length
  for (const user of args.approvers) {
    if (queued >= MAX_PROMPTS_PER_REQUEST) break
    const bindings = await ctx.db
      .query('channelBindings')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .take(10)
    const live = bindings.filter((b) => !b.revokedAt && b.companyId === args.companyId && !seen.has(String(b._id)))
    if (!live.length) continue
    const prefs = await prefsFor(ctx, user._id)
    const delay = quietHoursDelay(prefs.quietHours, now, tz)
    for (const b of live) {
      seen.add(String(b._id))
      const base = {
        bindingId: b._id,
        userId: user._id,
        companyId: args.companyId,
        provider: b.provider,
        kind: args.kind,
        recordId: args.recordId,
        subject: args.subject,
        createdAt: now,
        sendAt: now + delay,
        expiresAt: now + delay + PROMPT_TTL_MS,
      }
      // WhatsApp follows the person's WhatsApp notification switch; Telegram has none.
      if (b.provider === 'whatsapp' && !prefs.whatsapp) {
        await ctx.db.insert('botApprovalPrompts', { ...base, status: 'skipped', note: 'whatsapp_notifications_off' })
        continue
      }
      const promptId = await ctx.db.insert('botApprovalPrompts', { ...base, status: 'queued' })
      await ctx.scheduler.runAfter(delay, internal.bot.approvals.send, { promptId })
      queued++
    }
  }
  return queued
}

/** Called by onApprovalDecided: buttons on other chats now answer "already decided". */
export async function closeApprovalPrompts(ctx: MutationCtx, kind: string, recordId: string) {
  if (kind !== 'stocking' && kind !== 'topup' && kind !== 'transfer') return
  const rows = await ctx.db
    .query('botApprovalPrompts')
    .withIndex('by_kind_and_recordId', (q) => q.eq('kind', kind).eq('recordId', recordId))
    .take(MAX_PROMPTS_PER_REQUEST * 2)
  for (const p of rows) {
    if (p.status === 'queued' || p.status === 'sent' || p.status === 'awaiting_reason') {
      await ctx.db.patch(p._id, { status: 'closed', note: 'decided' })
    }
  }
}

function approvalMessage(
  prompt: Doc<'botApprovalPrompts'>,
  binding: Doc<'channelBindings'>,
  locale: BotLocale,
  requesterName: string,
  now: number,
): ChatMessageValue {
  const s = t(locale)
  const label = s.approvalKinds[prompt.kind]
  const body = s.approvalNeeded(label, requesterName, prompt.subject)
  const buttons = [
    { id: `apr:${prompt._id}`, title: s.approve },
    { id: `rej:${prompt._id}`, title: s.reject },
  ]
  const inWindow = (binding.lastInboundAt ?? 0) > now - WHATSAPP_WINDOW_MS
  if (binding.provider === 'telegram' || inWindow) return { kind: 'buttons', text: body, buttons }
  const tpl = APPROVAL_TEMPLATES[locale]
  return {
    kind: 'template',
    name: tpl.name,
    language: tpl.language,
    bodyParams: [label, requesterName, prompt.subject],
    quickReplies: buttons.map((b) => b.id),
    fallbackText: body,
    fallbackButtons: buttons,
  }
}

/** Mark a queued prompt sent and build its message, or close it when it no longer applies. */
export const prepare = internalMutation({
  args: { promptId: v.id('botApprovalPrompts') },
  returns: v.union(v.null(), v.object({ target: targetValidator, messages: v.array(chatMessage) })),
  handler: async (ctx, { promptId }) => {
    const prompt = await ctx.db.get(promptId)
    if (!prompt || prompt.status !== 'queued') return null
    const close = async (note: string) => {
      await ctx.db.patch(promptId, { status: 'closed', note })
      return null
    }
    const binding = await ctx.db.get(prompt.bindingId)
    if (!binding) return await close('binding_gone')
    const checked = await checkBinding(ctx, binding)
    if (!checked.ok) return await close(checked.problem)
    const bound = checked.bound
    if (binding.companyId !== prompt.companyId) return await close('other_organization')
    const a = await loadApproval(ctx, prompt.kind, prompt.recordId)
    if (!a || !a.pending) return await close('not_pending')
    if (!can(bound.member, PERMISSION[prompt.kind]) || !inScope(bound, a.locationId)) return await close('not_allowed')
    const requester = a.requesterId ? await ctx.db.get(a.requesterId) : null
    const now = Date.now()
    await ctx.db.patch(promptId, { status: 'sent', sentAt: now })
    return {
      target: {
        provider: binding.provider,
        address: binding.address,
        companyId: binding.companyId,
        bindingId: binding._id,
        locale: bound.locale,
      },
      messages: [approvalMessage(prompt, binding, bound.locale, requester?.name || requester?.email || '—', now)],
    }
  },
})

export const markPrompt = internalMutation({
  args: {
    promptId: v.id('botApprovalPrompts'),
    status: v.optional(v.literal('failed')),
    note: v.string(),
    sourceMessageId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { promptId, status, note, sourceMessageId }) => {
    const p = await ctx.db.get(promptId)
    if (!p) return null
    await ctx.db.patch(promptId, {
      note: note.slice(0, 300),
      ...(status ? { status } : {}),
      ...(sourceMessageId ? { sourceMessageId } : {}),
    })
    return null
  },
})

export const send = internalAction({
  args: { promptId: v.id('botApprovalPrompts') },
  returns: v.null(),
  handler: async (ctx, { promptId }) => {
    const r = await ctx.runMutation(internal.bot.approvals.prepare, { promptId })
    if (!r) return null
    const out = await deliver(ctx, r.target, r.messages)
    await logProactive(ctx, r.target, r.messages, out, 'bot_approval')
    if (out.error) await ctx.runMutation(internal.bot.approvals.markPrompt, { promptId, status: 'failed', note: out.error })
    return null
  },
})

type PromptCheck =
  | { ok: true; prompt: Doc<'botApprovalPrompts'>; subject: string }
  | { ok: false; reply: string }

/**
 * Whether a tap on this prompt may still act: it belongs to this chat, has
 * not been decided, has not expired, and the request is still pending.
 * Patches the prompt when it turns out closed or expired.
 */
export async function checkPrompt(
  ctx: MutationCtx,
  promptId: Id<'botApprovalPrompts'>,
  bindingId: Id<'channelBindings'>,
  locale: BotLocale,
): Promise<PromptCheck> {
  const s = t(locale)
  const prompt = await ctx.db.get(promptId)
  // Another chat's prompt is answered exactly like a missing one.
  if (!prompt || prompt.bindingId !== bindingId) return { ok: false, reply: s.approvalGone }
  if (prompt.status === 'approved' || prompt.status === 'rejected') {
    return { ok: false, reply: s.approvalYouDecided(prompt.status) }
  }
  const a = await loadApproval(ctx, prompt.kind, prompt.recordId)
  if (!a) return { ok: false, reply: s.approvalGone }
  if (!a.pending) {
    if (prompt.status !== 'closed') await ctx.db.patch(prompt._id, { status: 'closed', note: 'decided' })
    return { ok: false, reply: s.approvalAlready(...(await decidedBy(ctx, prompt))) }
  }
  if (prompt.status === 'expired' || prompt.expiresAt <= Date.now()) {
    if (prompt.status !== 'expired') await ctx.db.patch(prompt._id, { status: 'expired' })
    return { ok: false, reply: s.approvalExpired }
  }
  if (prompt.status !== 'sent' && prompt.status !== 'awaiting_reason') return { ok: false, reply: s.approvalGone }
  return { ok: true, prompt, subject: a.subject }
}

async function decidedBy(
  ctx: MutationCtx,
  prompt: Doc<'botApprovalPrompts'>,
): Promise<['approved' | 'rejected' | 'closed', string]> {
  const table = prompt.kind === 'stocking' ? 'stockingHistory' : prompt.kind === 'topup' ? 'topupHistory' : 'fishTransfers'
  const id = ctx.db.normalizeId(table, prompt.recordId)
  const row = id ? await ctx.db.get(id) : null
  if (!row || (row.status !== 'approved' && row.status !== 'rejected')) return ['closed', '']
  const by = row.approvedBy ? await ctx.db.get(row.approvedBy) : null
  return [row.status, by?.name || '']
}

/** Reject tapped: ask for the reason (a short list, or the next text message). */
export async function askRejectReason(
  ctx: MutationCtx,
  promptId: Id<'botApprovalPrompts'>,
  bindingId: Id<'channelBindings'>,
  locale: BotLocale,
): Promise<ChatMessageValue[]> {
  const c = await checkPrompt(ctx, promptId, bindingId, locale)
  if (!c.ok) return [{ kind: 'text', text: c.reply }]
  // Only one rejection waits for a reason per chat: the latest tap wins.
  const waiting = await ctx.db
    .query('botApprovalPrompts')
    .withIndex('by_bindingId_and_status', (q) => q.eq('bindingId', bindingId).eq('status', 'awaiting_reason'))
    .take(20)
  for (const w of waiting) if (w._id !== promptId) await ctx.db.patch(w._id, { status: 'sent' })
  await ctx.db.patch(promptId, { status: 'awaiting_reason', reasonAskedAt: Date.now() })
  const s = t(locale)
  return [
    {
      kind: 'list',
      text: s.rejectReasonPrompt,
      button: s.rejectReasonPick,
      rows: REJECT_REASON_CODES.map((code) => ({ id: `rr:${promptId}:${code}`, title: s.rejectReasons[code] })),
    },
  ]
}

/** The rejection waiting for a typed reason in this chat, if any. */
export async function awaitingReason(ctx: MutationCtx, bindingId: Id<'channelBindings'>) {
  const rows = await ctx.db
    .query('botApprovalPrompts')
    .withIndex('by_bindingId_and_status', (q) => q.eq('bindingId', bindingId).eq('status', 'awaiting_reason'))
    .take(20)
  const now = Date.now()
  const fresh = rows.filter((r) => (r.reasonAskedAt ?? 0) > now - REASON_WINDOW_MS)
  fresh.sort((a, b) => (b.reasonAskedAt ?? 0) - (a.reasonAskedAt ?? 0))
  return fresh[0] ?? null
}

/** CANCEL while a reason is awaited: back to Approve / Reject. */
export async function keepPending(ctx: MutationCtx, promptId: Id<'botApprovalPrompts'>) {
  await ctx.db.patch(promptId, { status: 'sent', reasonAskedAt: undefined })
}

const decideResult = v.union(
  v.object({ status: v.literal('approved'), subject: v.string() }),
  v.object({ status: v.literal('rejected'), subject: v.string() }),
  v.object({ status: v.literal('refused'), message: v.string() }),
)
export type DecideResult = Infer<typeof decideResult>

/**
 * Approve or reject from a chat. Never trusts the button: the prompt must
 * belong to this binding, and the binding's member must still hold the
 * permission for the request's site. Throws (and rolls back) when the shared
 * approval helper refuses, e.g. segregation of duties.
 */
export const decide = internalMutation({
  args: {
    promptId: v.id('botApprovalPrompts'),
    bindingId: v.id('channelBindings'),
    sourceMessageId: v.string(),
    decision: v.union(v.literal('approve'), v.literal('reject')),
    reason: v.optional(v.string()),
  },
  returns: decideResult,
  handler: async (ctx, args): Promise<DecideResult> => {
    const binding = await ctx.db.get(args.bindingId)
    if (!binding) return { status: 'refused', message: 'binding' }
    const checked = await checkBinding(ctx, binding)
    if (!checked.ok) return { status: 'refused', message: t(checked.locale).bindingInactive }
    const bound = checked.bound
    const s = t(bound.locale)
    const c = await checkPrompt(ctx, args.promptId, binding._id, bound.locale)
    if (!c.ok) return { status: 'refused', message: c.reply }
    const prompt = c.prompt
    const a = (await loadApproval(ctx, prompt.kind, prompt.recordId))!
    // Same organization, the approve permission, and the request's site in scope.
    if (
      prompt.companyId !== binding.companyId ||
      a.companyId !== binding.companyId ||
      !can(bound.member, PERMISSION[prompt.kind]) ||
      !inScope(bound, a.locationId)
    ) {
      await ctx.db.patch(prompt._id, { note: 'not_allowed', sourceMessageId: args.sourceMessageId })
      return { status: 'refused', message: s.approvalNotAllowed }
    }
    const reason = args.reason?.trim().slice(0, MAX_REASON_CHARS) || undefined
    const wctx = botCtx(ctx, bound, args.sourceMessageId)
    const actor = bound.actor
    if (prompt.kind === 'stocking') {
      const id = ctx.db.normalizeId('stockingHistory', prompt.recordId)!
      if (args.decision === 'approve') await approveStockingAs(wctx, actor, id)
      else await rejectStockingAs(wctx, actor, id, reason)
    } else if (prompt.kind === 'topup') {
      const id = ctx.db.normalizeId('topupHistory', prompt.recordId)!
      if (args.decision === 'approve') await approveTopupAs(wctx, actor, id)
      else await rejectTopupAs(wctx, actor, id, reason)
    } else {
      const id = ctx.db.normalizeId('fishTransfers', prompt.recordId)!
      if (args.decision === 'approve') await approveFishTransferAs(wctx, actor, id)
      else await rejectFishTransferAs(wctx, actor, id, reason)
    }
    const status = args.decision === 'approve' ? 'approved' : 'rejected'
    await ctx.db.patch(prompt._id, {
      status,
      decidedAt: Date.now(),
      sourceMessageId: args.sourceMessageId,
      note: undefined,
    })
    return { status, subject: c.subject }
  },
})

/** The user-facing message of a `userError`, also when it crossed a function boundary as JSON. */
function userMessage(err: unknown): string | null {
  if (isUserError(err)) return err.data.message
  let data = (err as { data?: unknown } | null)?.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  const d = data as { code?: unknown; message?: unknown } | null | undefined
  return d && typeof d.code === 'string' && typeof d.message === 'string' ? d.message : null
}

/** Run a decision from the processing action and turn the outcome into a reply. */
export async function decideFromChat(
  ctx: ActionCtx,
  args: {
    promptId: Id<'botApprovalPrompts'>
    bindingId: Id<'channelBindings'>
    sourceMessageId: string
    decision: 'approve' | 'reject'
    reason?: string
    locale: BotLocale
  },
): Promise<string> {
  const s = t(args.locale)
  try {
    const r = await ctx.runMutation(internal.bot.approvals.decide, {
      promptId: args.promptId,
      bindingId: args.bindingId,
      sourceMessageId: args.sourceMessageId,
      decision: args.decision,
      reason: args.reason,
    })
    if (r.status === 'approved') return s.approvedDone(r.subject)
    if (r.status === 'rejected') return s.rejectedDone(r.subject)
    return r.message
  } catch (err) {
    // The shared helper refused (segregation of duties, farm rules): nothing
    // was written. Keep the reason on the prompt for the record.
    const msg = userMessage(err) ?? 'this request cannot be decided here; open Approvals in the app'
    await ctx.runMutation(internal.bot.approvals.markPrompt, {
      promptId: args.promptId,
      note: `refused: ${msg}`,
      sourceMessageId: args.sourceMessageId,
    })
    return s.approvalFailed(msg)
  }
}
