/**
 * Ask Anowa replies while they stream (the tool agent, convex/anowa/agent.ts).
 *
 * The browser makes a row (`start`), calls `agent.ask` with its id and reads
 * the row reactively (`get`): the text so far, what the agent is checking,
 * the draft card and the charts as they appear. The action writes the row
 * (`update`, throttled) and closes it (`finish`), which also saves the turn
 * to the member's chat history with its charts and draft card. `cancel` asks
 * the action to stop; it aborts the provider call on its next write or poll.
 *
 * Tenant isolation: a row belongs to one member in one organization. Only
 * that member can read or cancel it (anyone else gets null / NOT_FOUND), and
 * the action can only write a row its own caller started (`claim`).
 *
 * Text in the row is always the display sanitiser's output
 * (lib/llmAnswer.sanitizeStreaming); the saved answer is the full
 * sanitiser's. Rows are transient: pruned STREAM_TTL_MS after they start.
 */
import { v } from 'convex/values'
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { userError } from '../lib/errors'
import { answerChartValidator, MAX_CHARTS, validateChart, type AnswerChart } from '../lib/answerCharts'
import { appendTurns, requireChatOwner } from '../assistantChats'
import { rateLimiter } from '../lib/rateLimits'

export const STREAM_TTL_MS = 60 * 60 * 1000
/** Replies a member may have in flight at once (two tabs, a retry). */
export const MAX_ACTIVE_STREAMS = 3
const MAX_STREAM_TEXT = 8000
const PRUNE_BATCH = 200

const activity = v.object({ tool: v.string(), subject: v.union(v.string(), v.null()) })

const streamView = v.object({
  _id: v.id('assistantStreams'),
  status: v.union(
    v.literal('pending'),
    v.literal('streaming'),
    v.literal('done'),
    v.literal('error'),
    v.literal('cancelled'),
  ),
  text: v.string(),
  activity: v.union(activity, v.null()),
  draftGroup: v.union(v.string(), v.null()),
  charts: v.array(answerChartValidator),
  errorCode: v.union(v.string(), v.null()),
  retryAfterSec: v.union(v.number(), v.null()),
})

/** The caller's own row, or null (never says whether it exists for someone else). */
async function ownStream(
  ctx: QueryCtx | MutationCtx,
  me: { userId: Id<'users'>; companyId: Id<'companies'> },
  streamId: Id<'assistantStreams'>,
): Promise<Doc<'assistantStreams'> | null> {
  const row = await ctx.db.get(streamId)
  if (!row || row.userId !== me.userId || row.companyId !== me.companyId) return null
  return row
}

const checkedCharts = (charts: AnswerChart[] | undefined) =>
  (charts ?? [])
    .map((c) => validateChart(c))
    .filter((c): c is AnswerChart => c !== null)
    .slice(0, MAX_CHARTS)

/** Start a reply: an empty row the browser watches while `agent.ask` fills it. */
export const start = mutation({
  args: {},
  returns: v.id('assistantStreams'),
  handler: async (ctx) => {
    const me = await requireChatOwner(ctx)
    const limit = await rateLimiter.limit(ctx, 'assistantStreamStartPerUser', { key: me.userId })
    if (!limit.ok) throw userError('RATE_LIMITED', 'Too many questions at once. Wait a moment and try again.')
    const now = Date.now()
    // Newest first, so finished rows can't hide active ones from the cap. The
    // start limit (30/min) bounds rows in the 5-minute window to 150.
    const recent = await ctx.db
      .query('assistantStreams')
      .withIndex('by_companyId_and_userId_and_createdAt', (q) =>
        q.eq('companyId', me.companyId).eq('userId', me.userId).gt('createdAt', now - 5 * 60 * 1000),
      )
      .order('desc')
      .take(150)
    const active = recent.filter((r) => r.status === 'pending' || r.status === 'streaming')
    if (active.length >= MAX_ACTIVE_STREAMS) {
      throw userError('RATE_LIMITED', 'Anowa is still answering. Wait for it, or press Stop.')
    }
    return await ctx.db.insert('assistantStreams', {
      companyId: me.companyId,
      userId: me.userId,
      status: 'pending',
      text: '',
      createdAt: now,
      updatedAt: now,
    })
  },
})

/** The caller's reply as it streams; null for anyone else's (or a pruned one). */
export const get = query({
  args: { streamId: v.id('assistantStreams') },
  returns: v.union(streamView, v.null()),
  handler: async (ctx, args) => {
    const me = await requireChatOwner(ctx, true)
    const row = await ownStream(ctx, me, args.streamId)
    if (!row) return null
    return {
      _id: row._id,
      status: row.status,
      text: row.text,
      activity: row.activity ?? null,
      draftGroup: row.draftGroup ?? null,
      charts: row.charts ?? [],
      errorCode: row.errorCode ?? null,
      retryAfterSec: row.retryAfterSec ?? null,
    }
  },
})

/** Stop button: the action aborts the provider call at its next write or poll. */
export const cancel = mutation({
  args: { streamId: v.id('assistantStreams') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const me = await requireChatOwner(ctx)
    const row = await ownStream(ctx, me, args.streamId)
    if (!row) throw userError('NOT_FOUND', 'Reply not found')
    if (row.status === 'pending' || row.status === 'streaming') {
      await ctx.db.patch(row._id, { cancelRequested: true, updatedAt: Date.now() })
    }
    return null
  },
})

/**
 * The action takes the row it was given (as the signed-in member): true when
 * it is the caller's and not started yet. Called from agent.prepare.
 */
export async function claimStream(
  ctx: MutationCtx,
  me: { userId: Id<'users'>; companyId: Id<'companies'> },
  streamId: Id<'assistantStreams'>,
) {
  const row = await ownStream(ctx, me, streamId)
  if (!row || row.status !== 'pending') return false
  if (row.cancelRequested) {
    await ctx.db.patch(row._id, { status: 'cancelled', updatedAt: Date.now() })
    return false
  }
  await ctx.db.patch(row._id, { status: 'streaming', updatedAt: Date.now() })
  return true
}

/** Progress from the action. Returns whether the member pressed Stop. */
export const update = internalMutation({
  args: {
    streamId: v.id('assistantStreams'),
    text: v.string(),
    activity: v.union(activity, v.null()),
    draftGroup: v.union(v.string(), v.null()),
    charts: v.array(answerChartValidator),
  },
  returns: v.object({ cancelRequested: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.streamId)
    if (!row) return { cancelRequested: true }
    if (row.status !== 'streaming') return { cancelRequested: row.cancelRequested === true || row.status === 'cancelled' }
    await ctx.db.patch(row._id, {
      text: args.text.slice(0, MAX_STREAM_TEXT),
      activity: args.activity ?? undefined,
      draftGroup: args.draftGroup ?? undefined,
      charts: checkedCharts(args.charts),
      updatedAt: Date.now(),
    })
    return { cancelRequested: row.cancelRequested === true }
  },
})

/**
 * Close the row and, for an answer (finished or stopped with something to
 * keep), save the question and the answer to the member's history, as the
 * signed-in member. Errors are not saved (as before streaming).
 */
export const finish = internalMutation({
  args: {
    streamId: v.id('assistantStreams'),
    status: v.union(v.literal('done'), v.literal('error'), v.literal('cancelled')),
    text: v.string(),
    draftGroup: v.union(v.string(), v.null()),
    charts: v.array(answerChartValidator),
    errorCode: v.union(v.string(), v.null()),
    retryAfterSec: v.union(v.number(), v.null()),
    save: v.union(
      v.object({ chatId: v.optional(v.id('assistantChats')), question: v.string(), fallback: v.string() }),
      v.null(),
    ),
  },
  returns: v.union(
    v.object({ chatId: v.id('assistantChats'), messageIds: v.array(v.id('assistantMessages')) }),
    v.object({ error: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const me = await requireChatOwner(ctx)
    const row = await ownStream(ctx, me, args.streamId)
    if (!row) return null
    const charts = checkedCharts(args.charts)
    await ctx.db.patch(row._id, {
      status: args.status,
      text: args.text.slice(0, MAX_STREAM_TEXT),
      activity: undefined,
      draftGroup: args.draftGroup ?? undefined,
      charts,
      errorCode: args.errorCode ?? undefined,
      retryAfterSec: args.retryAfterSec,
      updatedAt: Date.now(),
    })
    if (!args.save || args.status === 'error') return null
    const content = args.text.trim() || args.save.fallback
    if (!content.trim()) return null
    try {
      return await appendTurns(ctx, me, args.save.chatId, [
        { role: 'user', content: args.save.question },
        {
          role: 'assistant',
          content,
          charts,
          ...(args.draftGroup ? { draftGroup: args.draftGroup } : {}),
          ...(args.status === 'cancelled' ? { stopped: true } : {}),
        },
      ])
    } catch (err) {
      // History is best effort (full conversation, deleted chat): the answer still shows.
      const reason = (err as { data?: { details?: { reason?: string } } })?.data?.details?.reason
      return { error: reason === 'CHAT_FULL' ? 'CHAT_FULL' : 'HISTORY' }
    }
  },
})

/** Retention: rows older than STREAM_TTL_MS, a batch per run. */
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query('assistantStreams')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', Date.now() - STREAM_TTL_MS))
      .take(PRUNE_BATCH)
    for (const r of old) await ctx.db.delete(r._id)
    if (old.length === PRUNE_BATCH) await ctx.scheduler.runAfter(0, internal.anowa.stream.prune, {})
    return null
  },
})
