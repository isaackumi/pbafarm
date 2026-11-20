import { describe, expect, test } from 'vitest'
import { getFunctionName } from 'convex/server'
import { gatewayError, guardedServerChat, streamWithServerKey } from './llmGatewayRoute'
import { createTokenBucket } from './llmProxyGuard'

/**
 * The Next proxy's server-key path with the AI protections (D-023), with
 * scripted fakes: a Convex client, the model chooser and the provider call.
 */
function fakes({ blocked = [], replies = {}, keys = ['gemini'], gateError = null } = {}) {
  const calls = []
  const usage = []
  const released = []
  const client = {
    mutation: async (ref, args) => {
      const name = getFunctionName(ref)
      if (name === 'llmQuota:consumeServerKeyQuota') {
        if (gateError) throw gateError
        return { leaseId: 'lease1', deadlineAt: Date.now() + 45_000, attemptMs: 28_000, blocked }
      }
      if (name === 'llmGateway:recordServerUsage') usage.push(args)
      if (name === 'aiGuard:releaseLease') released.push(args.leaseId)
      return null
    },
  }
  // Models per provider, best first; `exclude` removes ids (open breakers, tried).
  const lists = { gemini: ['g-flash', 'g-lite', 'g-pro'], openai: ['o-mini'] }
  const deps = {
    env: {},
    readKey: (id) => (keys.includes(id) ? 'k' : ''),
    defaultProvider: () => keys[0],
    chooseServerModel: async (target, requested, { exclude = [] } = {}) => {
      const pool = lists[target.providerId].filter((m) => !exclude.includes(m))
      if (requested && pool.includes(requested)) return { choice: { ok: true, model: requested, fallback: false }, price: undefined }
      if (!pool.length) return { choice: { ok: false, error: 'no models' } }
      return { choice: { ok: true, model: pool[0], fallback: !!requested }, price: undefined }
    },
    runChat: async (chat) => {
      calls.push(`${chat.providerId}/${chat.model}`)
      const r = replies[chat.model]
      if (!r) return { text: `answer from ${chat.model}`, usage: { inputTokens: 10, outputTokens: 5 } }
      throw Object.assign(new Error(r.message), { status: r.status })
    },
  }
  return { client, deps, calls, usage, released }
}

const ask = (f, o = {}) => guardedServerChat(f.client, { messages: [{ role: 'user', content: 'hi' }], temperature: 0.3, feature: 'chat', ...o }, f.deps)

describe('guardedServerChat (Next proxy, server key)', () => {
  test('Auto: a 503 retries once on the next best model; both attempts are reported; the lease is released', async () => {
    const f = fakes({ replies: { 'g-flash': { message: 'overloaded', status: 503 } } })
    const r = await ask(f)
    expect(r).toMatchObject({ text: 'answer from g-lite', model: 'g-lite', fallback: true })
    expect(f.calls).toEqual(['gemini/g-flash', 'gemini/g-lite'])
    expect(f.usage.map((u) => [u.model, u.ok, u.status])).toEqual([
      ['g-flash', false, 503],
      ['g-lite', true, undefined],
    ])
    expect(f.released).toEqual(['lease1'])
  })

  test('Auto: then another provider with a server key', async () => {
    const f = fakes({
      keys: ['gemini', 'openai'],
      blocked: ['server|gemini|g-lite', 'server|gemini|g-pro'],
      replies: { 'g-flash': { message: 'overloaded', status: 503 } },
    })
    const r = await ask(f)
    expect(r).toMatchObject({ providerId: 'openai', model: 'o-mini', fallback: true })
  })

  test('Auto skips open breakers up front', async () => {
    const f = fakes({ blocked: ['server|gemini|g-flash'] })
    const r = await ask(f)
    expect(f.calls).toEqual(['gemini/g-lite'])
    expect(r.model).toBe('g-lite')
  })

  test('an explicit model is never switched: its failure is returned, kind + retry hint', async () => {
    const f = fakes({ replies: { 'g-pro': { message: 'Too many requests, retry in 30s', status: 429 } } })
    const err = await ask(f, { model: 'g-pro' }).catch((e) => e)
    expect(f.calls).toEqual(['gemini/g-pro'])
    expect(gatewayError(err, { warn() {} })).toMatchObject({ status: 429, code: 'rate_limited', retryAfterSec: 30 })
    expect(f.released).toEqual(['lease1'])
  })

  test('an explicit model with an open breaker: refused before any call, "pick Auto or another model"', async () => {
    const f = fakes({ blocked: ['server|gemini|g-pro'] })
    const err = await ask(f, { model: 'g-pro' }).catch((e) => e)
    expect(f.calls).toEqual([])
    const out = gatewayError(err, { warn() {} })
    expect(out).toMatchObject({ status: 503, code: 'model_paused' })
    expect(out.error).toMatch(/Pick Auto or another model/)
  })

  test('a busy or over-budget refusal from Convex is passed through; nothing is called or released', async () => {
    const gateError = Object.assign(new Error('busy'), {
      data: { code: 'UPSTREAM', message: 'Anowa is still working on other questions.', details: { kind: 'busy', retryAfterSec: 5 } },
    })
    const f = fakes({ gateError })
    const err = await ask(f).catch((e) => e)
    expect(f.calls).toEqual([])
    expect(f.released).toEqual([])
    expect(gatewayError(err, { warn() {} })).toMatchObject({ status: 429, code: 'busy', retryAfterSec: 5 })
  })

  test('no server key: not configured, no quota spent', async () => {
    const f = fakes({ keys: [] })
    expect(await ask(f)).toMatchObject({ notConfigured: true })
  })
})

describe('streamWithServerKey (Ask Anowa ?stream=1, server key)', () => {
  // Scripted streams per model: text frames, then an error (with status) or the end.
  const streamDeps = (f, script) => ({
    ...f.deps,
    runStream: async ({ model, onText, signal }) => {
      const id = model.modelId
      f.calls.push(id)
      const s = script[id] || {}
      for (const t of s.frames || []) onText(t)
      if (s.stop) return { text: (s.frames || []).at(-1) || '', usage: {}, stopped: true }
      if (s.status) throw Object.assign(new Error(s.message || 'failed'), { status: s.status })
      expect(signal).toBeInstanceOf(AbortSignal)
      return { text: `streamed by ${id}`, usage: { inputTokens: 3, outputTokens: 4 }, stopped: false }
    },
  })
  const stream = (f, deps, o = {}) =>
    streamWithServerKey(f.client, { messages: [{ role: 'user', content: 'hi' }], temperature: 0.3, feature: 'chat', ...o }, { onText: (t) => f.frames.push(t) }, deps)

  test('Auto: a failure before any text falls back once; usage reported per attempt; lease released', async () => {
    const f = { ...fakes(), frames: [] }
    const r = await stream(f, streamDeps(f, { 'g-flash': { status: 503, message: 'overloaded' } }))
    expect(r).toMatchObject({ text: 'streamed by g-lite', model: 'g-lite', fallback: true, stopped: false })
    expect(f.usage.map((u) => [u.model, u.ok, u.leaseId])).toEqual([
      ['g-flash', false, 'lease1'],
      ['g-lite', true, 'lease1'],
    ])
    expect(f.released).toEqual(['lease1'])
  })

  test('once text reached the member, a failure is final (no silent switch mid-answer)', async () => {
    const f = { ...fakes(), frames: [] }
    const err = await stream(f, streamDeps(f, { 'g-flash': { frames: ['Half an'], status: 503, message: 'overloaded' } })).catch((e) => e)
    expect(f.calls).toEqual(['g-flash'])
    expect(f.frames).toEqual(['Half an'])
    expect(gatewayError(err, { warn() {} })).toMatchObject({ code: 'unavailable' })
    expect(f.released).toEqual(['lease1'])
  })

  test("the member's Stop: not a failure for the breaker, reported as stopped", async () => {
    const f = { ...fakes(), frames: [] }
    const r = await stream(f, streamDeps(f, { 'g-flash': { frames: ['Par'], stop: true } }))
    expect(r).toMatchObject({ stopped: true, model: 'g-flash' })
    expect(f.usage).toMatchObject([{ model: 'g-flash', ok: false, error: 'stopped' }])
    expect(f.usage[0].status).toBeUndefined()
  })

  test('an explicit model with an open breaker is refused before streaming', async () => {
    const f = { ...fakes({ blocked: ['server|gemini|g-pro'] }), frames: [] }
    const err = await stream(f, streamDeps(f, {}), { model: 'g-pro' }).catch((e) => e)
    expect(f.calls).toEqual([])
    expect(gatewayError(err, { warn() {} })).toMatchObject({ status: 503, code: 'model_paused' })
  })
})

describe('in-memory token bucket (Next proxy per minute)', () => {
  test('burst, then gradual refill', () => {
    let t = 0
    const b = createTokenBucket({ rate: 10, periodMs: 60_000, capacity: 10, now: () => t })
    for (let i = 0; i < 10; i++) expect(b.check('u').ok).toBe(true)
    expect(b.check('u')).toEqual({ ok: false, retryAfterSec: 6 })
    t = 6_000
    expect(b.check('u').ok).toBe(true)
    expect(b.check('u').ok).toBe(false)
    expect(b.check('other').ok).toBe(true)
  })
})
