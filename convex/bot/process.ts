/**
 * Processing one inbound chat message (doc 23 §2): `route` decides in a
 * mutation, then this action runs the slow parts (LLM, sends) outside any
 * transaction. Commits and undos are their own mutations: a failing write
 * throws and rolls back, then the draft is marked failed here.
 */
import { v } from 'convex/values'
import { internalAction } from '../_generated/server'
import type { ActionCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { isUserError } from '../lib/errors'
import { t } from './i18n'
import { runAgent } from './agent'
import { commitLogbook, runLogbook } from './logbook'
import { deliver, telegramBotToken } from './outbound'
import { answerTelegramCallback } from '../messaging/providers/telegramBot'
import { UNDO_WINDOW_MS } from './pending'
import { decideFromChat } from './approvals'
import { commitVoice, startVoice, undoVoice } from './voice'
import { pushCard } from './rounds'
import { commitGroup, undoGroup } from './groups'
import type { ChatMessageValue, RoutePlan } from './validators'

function errorText(err: unknown): string {
  if (isUserError(err)) return err.data.message
  return 'something went wrong'
}

const BINDING_PROBLEMS = new Set(['not_found', 'revoked', 'user_inactive', 'phone_unverified', 'company_inactive', 'not_member'])

async function messagesFor(ctx: ActionCtx, plan: Exclude<RoutePlan, { type: 'none' }>): Promise<ChatMessageValue[]> {
  const s = t(plan.locale)
  const text = (m: string): ChatMessageValue => ({ kind: 'text', text: m })
  switch (plan.type) {
    case 'reply':
      return plan.messages
    case 'logbook':
      return await runLogbook(ctx, plan)
    case 'logbook_commit':
      return await commitLogbook(ctx, plan)
    case 'voice':
      return await startVoice(ctx, plan)
    case 'voice_commit':
      return await commitVoice(ctx, plan)
    case 'voice_undo':
      return await undoVoice(ctx, plan)
    case 'round': {
      // The card first (edited in place, or sent anew), then any reply.
      const r = await pushCard(ctx, plan.roundId, plan.fresh)
      if (!r.ok && plan.fresh) return [text(r.error ?? 'not sent')]
      return plan.messages
    }
    case 'group_commit':
    case 'group_undo': {
      const r = plan.type === 'group_commit' ? await commitGroup(ctx, plan) : await undoGroup(ctx, plan)
      if (r.roundId) await pushCard(ctx, r.roundId, false, true)
      return r.messages
    }
    case 'agent':
      return await runAgent(ctx, {
        bindingId: plan.bindingId,
        text: plan.text,
        sourceMessageId: plan.sourceMessageId,
        sentAt: plan.sentAt,
      })
    case 'commit': {
      let r
      try {
        r = await ctx.runMutation(internal.bot.pending.commit, {
          pendingId: plan.pendingId,
          bindingId: plan.bindingId,
          sourceMessageId: plan.sourceMessageId,
          confirmDuplicate: plan.confirmDuplicate,
        })
      } catch (err) {
        const msg = errorText(err)
        await ctx.runMutation(internal.bot.pending.markFailed, { pendingId: plan.pendingId, error: msg })
        return [text(s.commitFailed(msg))]
      }
      switch (r.status) {
        case 'saved':
          return [
            {
              kind: 'buttons',
              // "Saved to C-07. 31 of 38 cages logged today. Still missing: A-03, B-12 +5." [Undo (10 min)] (artboard 41)
              text: [
                r.unit ? s.savedTo(r.unit) : s.saved,
                ...(r.progress ? [s.progress(r.progress.logged, r.progress.total, r.progress.missing, r.progress.more)] : []),
              ].join(' '),
              buttons: [{ id: `un:${plan.pendingId}`, title: s.undoFor(Math.round(UNDO_WINDOW_MS / 60_000)).slice(0, 20) }],
            },
          ]
        case 'already':
          return [text(s.alreadySaved)]
        case 'expired':
          return [text(s.expired)]
        case 'not_pending':
          return [text(s.notPending)]
        case 'needs_confirm':
          return [
            {
              kind: 'buttons',
              text: s.duplicateWarning,
              buttons: [
                { id: `dup:${plan.pendingId}`, title: s.saveAnyway },
                { id: `no:${plan.pendingId}`, title: s.cancel },
              ],
            },
          ]
        case 'refused':
          return [text(BINDING_PROBLEMS.has(r.message) ? s.bindingInactive : s.commitFailed(r.message))]
      }
      return []
    }
    case 'approval':
      return [
        text(
          await decideFromChat(ctx, {
            promptId: plan.promptId,
            bindingId: plan.bindingId,
            sourceMessageId: plan.sourceMessageId,
            decision: plan.decision,
            reason: plan.reason,
            locale: plan.locale,
          }),
        ),
      ]
    case 'undo': {
      try {
        const r = await ctx.runMutation(internal.bot.pending.undo, {
          pendingId: plan.pendingId,
          bindingId: plan.bindingId,
          sourceMessageId: plan.sourceMessageId,
        })
        if (r.status === 'undone') return [text(s.undone)]
        if (r.status === 'too_late') return [text(s.undoTooLate)]
        return [text(BINDING_PROBLEMS.has(r.message) ? s.bindingInactive : s.commitFailed(r.message))]
      } catch (err) {
        return [text(s.commitFailed(errorText(err)))]
      }
    }
  }
}

export const handle = internalAction({
  args: { inboundId: v.id('channelInbound') },
  returns: v.null(),
  handler: async (ctx, { inboundId }) => {
    const plan = await ctx.runMutation(internal.bot.inbound.route, { inboundId })
    if (plan.type === 'none') return null
    let error: string | undefined
    try {
      // Stop the Telegram button spinner first: the work below can edit a card or save several entries.
      const token = plan.provider === 'telegram' && plan.callbackQueryId ? telegramBotToken() : null
      if (token && plan.callbackQueryId) await answerTelegramCallback(token, plan.callbackQueryId)
      const messages = await messagesFor(ctx, plan)
      const r = await deliver(ctx, token ? { ...plan, callbackQueryId: undefined } : plan, messages)
      if (r.error) error = r.error
    } catch (err) {
      error = err instanceof Error ? err.message : 'processing failed'
    }
    if (error) await ctx.runMutation(internal.bot.inbound.finish, { inboundId, error })
    return null
  },
})
