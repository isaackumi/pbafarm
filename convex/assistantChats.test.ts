/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { MAX_MESSAGES, RETENTION_DAYS, chatTitle } from './assistantChats'

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const now = Date.now()
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm',
      code: 'LAKE',
      status: 'approved',
      createdAt: now,
      settings: { aiAssistantEnabled: true },
    })
    const otherCompany = await ctx.db.insert('companies', {
      name: 'Other',
      code: 'OTH',
      status: 'approved',
      createdAt: now,
      settings: { aiAssistantEnabled: true },
    })
    const mk = async (email: string, company: typeof companyId, roleKey: 'owner' | 'manager' | 'viewer') => {
      const userId = await ctx.db.insert('users', { email, role: roleKey === 'owner' ? 'admin' : 'user', companyId: company })
      await ctx.db.insert('memberships', { userId, companyId: company, roleKey, allLocations: true, status: 'active', updatedAt: now })
      return userId
    }
    return {
      me: await mk('me@x.com', companyId, 'manager'),
      admin: await mk('admin@x.com', companyId, 'owner'),
      viewer: await mk('viewer@x.com', companyId, 'viewer'),
      stranger: await mk('s@x.com', otherCompany, 'owner'),
    }
  })
  const as = (id: typeof ids.me) => t.withIdentity({ subject: `${id}|s` })
  return { t, ids, me: as(ids.me), admin: as(ids.admin), viewer: as(ids.viewer), stranger: as(ids.stranger) }
}

describe('Ask Anowa history (artboard 47)', () => {
  test('a conversation is titled from the first question and only its owner can read it', async () => {
    const { me, admin, stranger } = await setup()
    const { chatId, messageIds } = await me.mutation(api.assistantChats.append, {
      messages: [
        { role: 'user', content: '  Why is   FCR on Row C worse? ' },
        { role: 'assistant', content: 'Row C ate 12% more feed for the same growth.' },
      ],
    })
    expect(messageIds).toHaveLength(2)
    const list = await me.query(api.assistantChats.list, {})
    expect(list.map((c) => [c.title, c.messageCount])).toEqual([['Why is FCR on Row C worse?', 2]])
    const opened = await me.query(api.assistantChats.get, { chatId })
    expect(opened.messages.map((m) => m.role)).toEqual(['user', 'assistant'])

    // Same company admin, and another company: not found, not listed, cannot write or delete.
    for (const other of [admin, stranger]) {
      expect(await other.query(api.assistantChats.list, {})).toEqual([])
      await expect(other.query(api.assistantChats.get, { chatId })).rejects.toThrow(/not found/i)
      await expect(
        other.mutation(api.assistantChats.append, { chatId, messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(/not found/i)
      await expect(other.mutation(api.assistantChats.remove, { chatId })).rejects.toThrow(/not found/i)
      await expect(
        other.mutation(api.assistantChats.setPinned, { messageId: messageIds[1], pinned: true }),
      ).rejects.toThrow(/not found/i)
      expect(await other.query(api.assistantChats.saved, {})).toEqual([])
    }
  })

  test('members without ai.use are refused', async () => {
    const { viewer } = await setup()
    await expect(viewer.query(api.assistantChats.list, {})).rejects.toThrow(/ai\.use/)
  })

  test('saved answers: only answers, listed newest first, unpinned on request', async () => {
    const { me } = await setup()
    const a = await me.mutation(api.assistantChats.append, {
      messages: [
        { role: 'user', content: 'Biomass today?' },
        { role: 'assistant', content: '12.4 t across 18 cages.' },
      ],
    })
    await expect(
      me.mutation(api.assistantChats.setPinned, { messageId: a.messageIds[0], pinned: true }),
    ).rejects.toThrow(/Only answers/)
    await me.mutation(api.assistantChats.setPinned, { messageId: a.messageIds[1], pinned: true })
    const saved = await me.query(api.assistantChats.saved, {})
    expect(saved).toMatchObject([{ chatTitle: 'Biomass today?', content: '12.4 t across 18 cages.' }])
    expect((await me.query(api.assistantChats.get, { chatId: a.chatId })).messages[1].pinned).toBe(true)
    await me.mutation(api.assistantChats.setPinned, { messageId: a.messageIds[1], pinned: false })
    expect(await me.query(api.assistantChats.saved, {})).toEqual([])
  })

  test('delete removes the conversation and its turns; full conversations are refused', async () => {
    const { t, me } = await setup()
    const a = await me.mutation(api.assistantChats.append, { messages: [{ role: 'user', content: 'q' }] })
    await me.mutation(api.assistantChats.remove, { chatId: a.chatId })
    expect(await me.query(api.assistantChats.list, {})).toEqual([])
    expect(await t.run((ctx) => ctx.db.query('assistantMessages').collect())).toEqual([])

    const b = await me.mutation(api.assistantChats.append, { messages: [{ role: 'user', content: 'q' }] })
    await t.run((ctx) => ctx.db.patch(b.chatId, { messageCount: MAX_MESSAGES }))
    await expect(
      me.mutation(api.assistantChats.append, { chatId: b.chatId, messages: [{ role: 'user', content: 'more' }] }),
    ).rejects.toThrow(/full/)
    await expect(
      me.mutation(api.assistantChats.append, { messages: [{ role: 'user', content: 'x'.repeat(20_001) }] }),
    ).rejects.toThrow(/too long/)
  })

  test('retention: idle conversations are pruned; account deletion purges them', async () => {
    vi.useFakeTimers()
    try {
      const { t, ids, me } = await setup()
      await me.mutation(api.assistantChats.append, { messages: [{ role: 'user', content: 'old' }] })
      vi.setSystemTime(Date.now() + (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000)
      await me.mutation(api.assistantChats.append, { messages: [{ role: 'user', content: 'new' }] })
      await t.mutation(internal.assistantChats.prune, {})
      expect((await me.query(api.assistantChats.list, {})).map((c) => c.title)).toEqual(['new'])

      await t.mutation(internal.assistantChats.purgeForUser, { userId: ids.me })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      expect(await t.run((ctx) => ctx.db.query('assistantChats').collect())).toEqual([])
      expect(await t.run((ctx) => ctx.db.query('assistantMessages').collect())).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  test('titles are one line, at most 80 characters', () => {
    expect(chatTitle('a\nb')).toBe('a b')
    expect(chatTitle('x'.repeat(100))).toHaveLength(80)
    expect(chatTitle('   ')).toBe('New chat')
  })
})
