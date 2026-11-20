/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import agentTest from '@convex-dev/agent/test'
import { mockModel } from '@convex-dev/agent'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { testHooks } from './bot/agent'
import { STREAM_TTL_MS } from './anowa/stream'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T08:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  testHooks.languageModel = null
})

function toolCall(toolName: string, input: Record<string, unknown>, id = 'c1') {
  return { type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) }
}

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  agentTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', {
      name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true },
    })
    const companyB = await ctx.db.insert('companies', {
      name: 'River', code: 'RIVER', status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true },
    })
    const siteA = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'North', active: true, updatedAt: now })
    const owner = await ctx.db.insert('users', { email: 'owner@a.com', name: 'Kofi', role: 'user', companyId: companyA })
    await ctx.db.insert('memberships', {
      userId: owner, companyId: companyA, roleKey: 'owner', allLocations: true, status: 'active', updatedAt: now,
    })
    const clerkRole = await ctx.db.insert('roles', {
      companyId: companyA, key: 'clerk', name: 'Clerk', archived: false, updatedAt: now,
      permissions: ['org.view', 'ai.use', 'production.view'],
    })
    const clerk = await ctx.db.insert('users', { email: 'clerk@a.com', name: 'Ama', role: 'user', companyId: companyA })
    await ctx.db.insert('memberships', {
      userId: clerk, companyId: companyA, roleKey: 'clerk', roleId: clerkRole, allLocations: true, status: 'active', updatedAt: now,
    })
    const ownerB = await ctx.db.insert('users', { email: 'owner@b.com', name: 'Esi', role: 'user', companyId: companyB })
    await ctx.db.insert('memberships', {
      userId: ownerB, companyId: companyB, roleKey: 'owner', allLocations: true, status: 'active', updatedAt: now,
    })
    const cage = await ctx.db.insert('cages', {
      name: 'C-01', status: 'active', currentCount: 1000, initialCount: 1000, initialAbw: 10, currentWeight: 100,
      species: 'nile_tilapia', stockingDate: '2026-10-01', companyId: companyA, locationId: siteA, updatedAt: now,
    })
    for (const [date, abw] of [['2026-10-20', 62], ['2026-11-03', 95], ['2026-11-17', 131]] as const) {
      await ctx.db.insert('biweeklyRecords', {
        cageId: cage, date, batchCode: 'B1', averageBodyWeight: abw, totalFishCount: 50, totalWeight: (abw * 50) / 1000,
        companyId: companyA, locationId: siteA, updatedAt: now,
      })
    }
    return { companyA, companyB, siteA, owner, clerk, ownerB, cage }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  const streamRow = async (id: Id<'assistantStreams'>) => await t.run(async (ctx) => await ctx.db.get(id))
  const messages = async () => await t.run(async (ctx) => await ctx.db.query('assistantMessages').collect())
  return { t, as, streamRow, messages, ...ids }
}

describe('Ask Anowa streaming (agent)', () => {
  test('assembles the stream, saves the fully sanitised answer and the turn to history', async () => {
    const s = await setup()
    testHooks.languageModel = mockModel({
      content: [{ type: 'text', text: 'C-01 is <b>fine</b>. See [the log](https://evil.example/x?d=secret) for more.' }],
    })
    const streamId = await s.as(s.owner).mutation(api.anowa.stream.start, {})
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'How is C-01?', lang: 'en', streamId })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.text).toBe('C-01 is fine. See the log for more.')
    expect(res.stopped).toBe(false)
    expect(res.chatId).toBeTruthy()

    const row = await s.streamRow(streamId)
    expect(row).toMatchObject({ status: 'done', text: 'C-01 is fine. See the log for more.' })
    expect(row!.activity).toBeUndefined()

    const chat = await s.as(s.owner).query(api.assistantChats.get, { chatId: res.chatId! })
    expect(chat.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'How is C-01?'],
      ['assistant', 'C-01 is fine. See the log for more.'],
    ])
    expect(res.messageIds).toEqual(chat.messages.map((m) => m._id))

    // A follow-up joins the same conversation.
    const next = await s.as(s.owner).mutation(api.anowa.stream.start, {})
    const again = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'And C-02?', streamId: next, chatId: res.chatId! })
    expect(again.ok && again.chatId).toBe(res.chatId)
    expect(await s.messages()).toHaveLength(4)
  })

  test('drafts and charts stream into the row and persist with the answer', async () => {
    const s = await setup()
    testHooks.languageModel = mockModel({
      contentSteps: [
        [toolCall('samplingHistory', { unit: 'C-01' }, 'a')],
        [toolCall('attachChart', { id: 'c1' }, 'b'), toolCall('proposeMortality', { unit: 'C-01', count: 2 }, 'c')],
        [{ type: 'text', text: 'ABW rose from 62 g to 131 g. I drafted the mortality.' }],
      ],
    })
    const streamId = await s.as(s.owner).mutation(api.anowa.stream.start, {})
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'Show the ABW trend for C-01 and log 2 dead', streamId })
    if (!res.ok) throw new Error(res.code)
    expect(res.draftGroup).toBeTruthy()
    expect(res.charts).toHaveLength(1)
    expect(res.charts[0]).toMatchObject({ type: 'line', title: 'ABW trend, C-01', xKind: 'date' })
    expect(res.charts[0].series[0].points.map((p) => [p.x, p.y])).toEqual([
      ['2026-10-20', 62],
      ['2026-11-03', 95],
      ['2026-11-17', 131],
    ])
    const row = await s.streamRow(streamId)
    expect(row?.charts).toEqual(res.charts)
    expect(row?.draftGroup).toBe(res.draftGroup)

    // History keeps the chart and the draft card (reload shows them).
    const chat = await s.as(s.owner).query(api.assistantChats.get, { chatId: res.chatId! })
    expect(chat.messages[1]).toMatchObject({ role: 'assistant', draftGroup: res.draftGroup, charts: res.charts })
  })

  test('the model cannot author chart data: unknown ids and chart-shaped text give no chart', async () => {
    const s = await setup()
    const forged = { type: 'line', title: 'Profit', xKind: 'date', series: [{ key: 'p', label: 'P', unit: '', points: [{ x: '2026-11-01', y: 1e9 }] }] }
    testHooks.languageModel = mockModel({
      contentSteps: [
        [toolCall('attachChart', { id: 'c1', chart: forged }, 'a')],
        [{ type: 'text', text: `Here is your chart: ${JSON.stringify(forged)}` }],
      ],
    })
    const streamId = await s.as(s.owner).mutation(api.anowa.stream.start, {})
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'Chart my profit', streamId, showCharts: true })
    if (!res.ok) throw new Error(res.code)
    expect(res.charts).toEqual([])
    expect((await s.streamRow(streamId))?.charts).toEqual([])
    const saved = (await s.messages()).find((m) => m.role === 'assistant')
    expect(saved?.charts).toBeUndefined()
  })

  test('Show charts on: a chart a read offered is attached even when the model forgets', async () => {
    const s = await setup()
    testHooks.languageModel = mockModel({
      contentSteps: [[toolCall('samplingHistory', { unit: 'C-01' }, 'a')], [{ type: 'text', text: 'ABW is 131 g.' }]],
    })
    const off = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'ABW of C-01?' })
    expect(off.ok && off.charts).toEqual([])
    const on = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'ABW of C-01?', showCharts: true })
    expect(on.ok && on.charts.map((c) => c.title)).toEqual(['ABW trend, C-01'])
  })

  test('an error mid-stream maps to a classified failure; nothing is saved', async () => {
    const s = await setup()
    testHooks.languageModel = mockModel({
      content: [{ type: 'text', text: 'Half an answer' }],
      fail: { error: 'Service unavailable (503): upstream https://provider.example/v1 project 1234' },
    })
    const streamId = await s.as(s.owner).mutation(api.anowa.stream.start, {})
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'How is C-01?', streamId })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(['unavailable', 'unknown']).toContain(res.code)
    const row = await s.streamRow(streamId)
    expect(row).toMatchObject({ status: 'error', errorCode: res.code })
    expect(JSON.stringify(row)).not.toMatch(/provider\.example|1234/)
    expect(await s.messages()).toHaveLength(0)
  })

  test('Stop aborts the provider call and keeps what had arrived, marked stopped', async () => {
    const s = await setup()
    let streamId: Id<'assistantStreams'> | null = null
    let aborted = false
    testHooks.languageModel = mockModel({
      doGenerate: async () => {
        throw new Error('not used')
      },
      doStream: async (options) => ({
        stream: new ReadableStream({
          async start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 't' })
            controller.enqueue({ type: 'text-delta', id: 't', delta: 'C-01 had 3 dead this week and' })
            // The member presses Stop while the model is still writing.
            await s.as(s.owner).mutation(api.anowa.stream.cancel, { streamId: streamId! })
            vi.setSystemTime(Date.now() + 5000)
            await new Promise<void>((resolve) => {
              if (options.abortSignal?.aborted) return resolve()
              options.abortSignal?.addEventListener('abort', () => resolve())
            })
            aborted = true
            controller.error(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
          },
        }),
      }),
    })
    streamId = await s.as(s.owner).mutation(api.anowa.stream.start, {})
    const res = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'Deaths in C-01?', streamId })
    expect(aborted).toBe(true)
    if (!res.ok) throw new Error(res.code)
    expect(res.stopped).toBe(true)
    expect(res.text).toBe('C-01 had 3 dead this week and')
    expect((await s.streamRow(streamId))?.status).toBe('cancelled')
    const saved = (await s.messages()).find((m) => m.role === 'assistant')
    expect(saved).toMatchObject({ content: 'C-01 had 3 dead this week and', stopped: true })
  }, 15_000)

  test('stream rows are private to their member (tenant isolation)', async () => {
    const s = await setup()
    const streamId = await s.as(s.owner).mutation(api.anowa.stream.start, {})
    expect(await s.as(s.owner).query(api.anowa.stream.get, { streamId })).toMatchObject({ status: 'pending', text: '' })
    // Same organization, other member; and another organization.
    expect(await s.as(s.clerk).query(api.anowa.stream.get, { streamId })).toBeNull()
    expect(await s.as(s.ownerB).query(api.anowa.stream.get, { streamId })).toBeNull()
    await expect(s.as(s.clerk).mutation(api.anowa.stream.cancel, { streamId })).rejects.toThrow(/not found/i)
    await expect(s.as(s.ownerB).mutation(api.anowa.stream.cancel, { streamId })).rejects.toThrow(/not found/i)

    // Nobody else can stream into it, or save into the owner's history through it.
    testHooks.languageModel = mockModel({ content: [{ type: 'text', text: 'Secret answer' }] })
    for (const other of [s.clerk, s.ownerB]) {
      const res = await s.as(other).action(api.anowa.agent.ask, { question: 'Hi', streamId })
      expect(res).toMatchObject({ ok: false, code: 'invalid' })
    }
    expect(await s.streamRow(streamId)).toMatchObject({ status: 'pending', text: '' })
    expect(await s.messages()).toHaveLength(0)

    // A row is used once.
    const ok = await s.as(s.owner).action(api.anowa.agent.ask, { question: 'Hi', streamId })
    expect(ok.ok).toBe(true)
    expect(await s.as(s.owner).action(api.anowa.agent.ask, { question: 'Hi', streamId })).toMatchObject({ ok: false, code: 'invalid' })
  })

  test('at most three replies in flight per member; old rows are pruned', async () => {
    const s = await setup()
    for (let i = 0; i < 3; i++) await s.as(s.owner).mutation(api.anowa.stream.start, {})
    await expect(s.as(s.owner).mutation(api.anowa.stream.start, {})).rejects.toThrow(/still answering/)
    // Another member is not affected.
    await s.as(s.clerk).mutation(api.anowa.stream.start, {})
    vi.setSystemTime(Date.now() + STREAM_TTL_MS + 60_000)
    await s.t.mutation(internal.anowa.stream.prune, {})
    expect(await s.t.run(async (ctx) => await ctx.db.query('assistantStreams').collect())).toHaveLength(0)
  })

  test('finished rows cannot hide active ones from the cap (newest rows are counted)', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const now = Date.now()
      for (let i = 0; i < 20; i++) {
        await ctx.db.insert('assistantStreams', {
          companyId: s.companyA, userId: s.owner, status: 'error', text: '', createdAt: now - 60_000 + i, updatedAt: now,
        })
      }
    })
    for (let i = 0; i < 3; i++) await s.as(s.owner).mutation(api.anowa.stream.start, {})
    await expect(s.as(s.owner).mutation(api.anowa.stream.start, {})).rejects.toThrow(/still answering/)
  })

  test('starting replies is rate limited per member', async () => {
    const s = await setup()
    let refused = false
    for (let i = 0; i < 12 && !refused; i++) {
      const id = await s.as(s.owner).mutation(api.anowa.stream.start, {}).catch((e: Error) => {
        if (/Too many questions/.test(e.message)) refused = true
        else throw e
        return null
      })
      if (id) await s.t.run(async (ctx) => await ctx.db.patch(id, { status: 'done' }))
    }
    expect(refused).toBe(true)
  })
})
