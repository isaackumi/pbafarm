import { v } from 'convex/values'
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember } from './lib/permissions'
import { userError } from './lib/errors'

/**
 * Ask Anowa chat history and saved answers (Paper artboard 47). Every
 * conversation belongs to one member in one organization: only that member
 * can list, open, pin or delete it (another member, admin or organization
 * gets NOT_FOUND). Needs `ai.use`, like the assistant itself.
 *
 * Bounded: at most MAX_MESSAGES turns per conversation (the client starts a
 * new one after that), lists read at most LIST_LIMIT rows. Retention
 * (ENT-005): conversations are pruned RETENTION_DAYS after their last
 * message, deleted with the account (purgeForUser, from
 * governance.anonymizeUser) and with the organization (TENANT_TABLES).
 */

export const MAX_MESSAGES = 200
export const MAX_CONTENT_CHARS = 20_000
export const LIST_LIMIT = 30
export const RETENTION_DAYS = 365
const DAY = 24 * 60 * 60 * 1000
const PURGE_BATCH = 100

const chatSummary = v.object({
  _id: v.id('assistantChats'),
  title: v.string(),
  messageCount: v.number(),
  lastMessageAt: v.number(),
})

const messageView = v.object({
  _id: v.id('assistantMessages'),
  role: v.union(v.literal('user'), v.literal('assistant')),
  content: v.string(),
  pinned: v.boolean(),
  createdAt: v.number(),
})

async function requireChatOwner(ctx: QueryCtx | MutationCtx, allowActAsReadOnly = false) {
  const m = await requireMember(ctx, { permission: 'ai.use', allowActAsReadOnly })
  if (!m.companyId) throw userError('FORBIDDEN', 'Chat history needs an organization')
  return { userId: m.user._id, companyId: m.companyId }
}

/** The caller's own chat, or NOT_FOUND (never says whether it exists for someone else). */
async function ownChat(
  ctx: QueryCtx | MutationCtx,
  me: { userId: Id<'users'>; companyId: Id<'companies'> },
  chatId: Id<'assistantChats'>,
): Promise<Doc<'assistantChats'>> {
  const chat = await ctx.db.get(chatId)
  if (!chat || chat.userId !== me.userId || chat.companyId !== me.companyId) {
    throw userError('NOT_FOUND', 'Conversation not found')
  }
  return chat
}

export function chatTitle(question: string) {
  const line = question.replace(/\s+/g, ' ').trim()
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || 'New chat'
}

/** The caller's most recent conversations in the active organization. */
export const list = query({
  args: {},
  returns: v.array(chatSummary),
  handler: async (ctx) => {
    const me = await requireChatOwner(ctx, true)
    const rows = await ctx.db
      .query('assistantChats')
      .withIndex('by_companyId_and_userId_and_lastMessageAt', (q) =>
        q.eq('companyId', me.companyId).eq('userId', me.userId),
      )
      .order('desc')
      .take(LIST_LIMIT)
    return rows.map((c) => ({
      _id: c._id,
      title: c.title,
      messageCount: c.messageCount,
      lastMessageAt: c.lastMessageAt,
    }))
  },
})

/** One of the caller's conversations with its turns, oldest first. */
export const get = query({
  args: { chatId: v.id('assistantChats') },
  returns: v.object({ chat: chatSummary, messages: v.array(messageView) }),
  handler: async (ctx, args) => {
    const me = await requireChatOwner(ctx, true)
    const chat = await ownChat(ctx, me, args.chatId)
    const rows = await ctx.db
      .query('assistantMessages')
      .withIndex('by_companyId_and_chatId', (q) => q.eq('companyId', me.companyId).eq('chatId', chat._id))
      .take(MAX_MESSAGES)
    return {
      chat: {
        _id: chat._id,
        title: chat.title,
        messageCount: chat.messageCount,
        lastMessageAt: chat.lastMessageAt,
      },
      messages: rows.map((m) => ({
        _id: m._id,
        role: m.role,
        content: m.content,
        pinned: m.pinnedAt !== undefined,
        createdAt: m.createdAt,
      })),
    }
  },
})

/**
 * Append turns (a question and its answer) to a conversation; without
 * `chatId` a new one is started, titled from the first question. Returns the
 * conversation and the new message ids.
 */
export const append = mutation({
  args: {
    chatId: v.optional(v.id('assistantChats')),
    messages: v.array(
      v.object({ role: v.union(v.literal('user'), v.literal('assistant')), content: v.string() }),
    ),
  },
  returns: v.object({ chatId: v.id('assistantChats'), messageIds: v.array(v.id('assistantMessages')) }),
  handler: async (ctx, args) => {
    const me = await requireChatOwner(ctx)
    if (args.messages.length === 0 || args.messages.length > 4) {
      throw userError('VALIDATION', 'Send one to four messages at a time')
    }
    for (const m of args.messages) {
      if (!m.content.trim()) throw userError('VALIDATION', 'A message is empty')
      if (m.content.length > MAX_CONTENT_CHARS) {
        throw userError('VALIDATION', `A message is too long (max ${MAX_CONTENT_CHARS} characters)`)
      }
    }
    const now = Date.now()
    let chat: Doc<'assistantChats'>
    if (args.chatId) {
      chat = await ownChat(ctx, me, args.chatId)
      if (chat.messageCount + args.messages.length > MAX_MESSAGES) {
        throw userError('VALIDATION', 'This conversation is full. Start a new chat.', { reason: 'CHAT_FULL' })
      }
    } else {
      const first = args.messages.find((m) => m.role === 'user') ?? args.messages[0]
      const id = await ctx.db.insert('assistantChats', {
        companyId: me.companyId,
        userId: me.userId,
        title: chatTitle(first.content),
        messageCount: 0,
        lastMessageAt: now,
        createdAt: now,
      })
      chat = (await ctx.db.get(id))!
    }
    const messageIds: Id<'assistantMessages'>[] = []
    for (const [i, m] of args.messages.entries()) {
      messageIds.push(
        await ctx.db.insert('assistantMessages', {
          companyId: me.companyId,
          userId: me.userId,
          chatId: chat._id,
          role: m.role,
          content: m.content,
          createdAt: now + i,
        }),
      )
    }
    await ctx.db.patch(chat._id, {
      messageCount: chat.messageCount + args.messages.length,
      lastMessageAt: now,
    })
    return { chatId: chat._id, messageIds }
  },
})

/** Delete one of the caller's conversations and its turns. */
export const remove = mutation({
  args: { chatId: v.id('assistantChats') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const me = await requireChatOwner(ctx)
    const chat = await ownChat(ctx, me, args.chatId)
    await deleteChat(ctx, chat._id)
    return null
  },
})

async function deleteChat(ctx: MutationCtx, chatId: Id<'assistantChats'>) {
  // MAX_MESSAGES bounds a conversation, so one read covers it.
  const rows = await ctx.db
    .query('assistantMessages')
    .withIndex('by_chatId', (q) => q.eq('chatId', chatId))
    .take(MAX_MESSAGES + 10)
  for (const r of rows) await ctx.db.delete(r._id)
  await ctx.db.delete(chatId)
}

/** Save (pin) or unsave one of the caller's answers. */
export const setPinned = mutation({
  args: { messageId: v.id('assistantMessages'), pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const me = await requireChatOwner(ctx)
    const msg = await ctx.db.get(args.messageId)
    if (!msg || msg.userId !== me.userId || msg.companyId !== me.companyId) {
      throw userError('NOT_FOUND', 'Answer not found')
    }
    if (msg.role !== 'assistant') throw userError('VALIDATION', 'Only answers can be saved')
    await ctx.db.patch(msg._id, { pinnedAt: args.pinned ? Date.now() : undefined })
    return null
  },
})

/** The caller's saved answers, most recently saved first. */
export const saved = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('assistantMessages'),
      chatId: v.id('assistantChats'),
      chatTitle: v.string(),
      content: v.string(),
      pinnedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const me = await requireChatOwner(ctx, true)
    const rows = await ctx.db
      .query('assistantMessages')
      .withIndex('by_companyId_and_userId_and_pinnedAt', (q) =>
        q.eq('companyId', me.companyId).eq('userId', me.userId).gt('pinnedAt', 0),
      )
      .order('desc')
      .take(LIST_LIMIT)
    const titles = new Map<string, string>()
    const out = []
    for (const r of rows) {
      const key = String(r.chatId)
      if (!titles.has(key)) titles.set(key, (await ctx.db.get(r.chatId))?.title ?? '')
      out.push({
        _id: r._id,
        chatId: r.chatId,
        chatTitle: titles.get(key)!,
        content: r.content,
        pinnedAt: r.pinnedAt!,
      })
    }
    return out
  },
})

/** Retention (ENT-005): conversations idle for RETENTION_DAYS, a batch per run. */
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_DAYS * DAY
    const old = await ctx.db
      .query('assistantChats')
      .withIndex('by_lastMessageAt', (q) => q.lt('lastMessageAt', cutoff))
      .take(20)
    for (const c of old) await deleteChat(ctx, c._id)
    if (old.length === 20) await ctx.scheduler.runAfter(0, internal.assistantChats.prune, {})
    return null
  },
})

/** Account deletion (governance.anonymizeUser): every conversation of the user, in batches. */
export const purgeForUser = internalMutation({
  args: { userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const chats = await ctx.db
      .query('assistantChats')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(Math.max(1, Math.floor(PURGE_BATCH / 20)))
    for (const c of chats) await deleteChat(ctx, c._id)
    if (chats.length > 0) {
      await ctx.scheduler.runAfter(0, internal.assistantChats.purgeForUser, { userId: args.userId })
    }
    return null
  },
})
