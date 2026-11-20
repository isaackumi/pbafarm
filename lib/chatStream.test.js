import { describe, expect, test } from 'vitest'
import { mockModel } from '@convex-dev/agent'
import { ndjson, streamChatReply } from './chatStream'
import { readAnswerStream } from './llmClient'
import { isActionRequest, isChartRequest } from './anowaIntent'

const messages = [{ role: 'user', content: 'How is C-07?' }]

function bytes(chunks) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
}

describe('plain chat streaming (server)', () => {
  test('frames are display-sanitised; the result is the full sanitised answer', async () => {
    const model = mockModel({ content: [{ type: 'text', text: 'C-07 is <b>fine</b>. See [log](https://evil.example/x) ok.' }] })
    const frames = []
    const reply = await streamChatReply({ model, messages, onText: (t) => frames.push(t), flushMs: 0 })
    expect(reply.stopped).toBe(false)
    expect(reply.text).toBe('C-07 is fine. See log ok.')
    expect(frames.length).toBeGreaterThan(2)
    expect(frames[frames.length - 1]).toBe(reply.text)
    for (const f of frames) expect(f).not.toMatch(/[<>]|evil\.example|\]\(/)
    // Each frame is the text so far: it only grows.
    for (let i = 1; i < frames.length; i++) expect(frames[i].length).toBeGreaterThanOrEqual(frames[i - 1].length)
  })

  test('frames are throttled', async () => {
    const model = mockModel({ content: [{ type: 'text', text: 'one two three four five six' }] })
    const frames = []
    await streamChatReply({ model, messages, onText: (t) => frames.push(t), flushMs: 1e9, now: () => 1e10 })
    // The first frame, then the final one.
    expect(frames).toEqual(['One', 'One two three four five six'])
  })

  test('an error mid-stream throws (the route classifies it)', async () => {
    const model = mockModel({ content: [{ type: 'text', text: 'Half an answer' }], fail: { error: 'upstream 503' } })
    await expect(streamChatReply({ model, messages, onText: () => {} })).rejects.toBeTruthy()
  })

  test('Stop aborts the provider call and resolves stopped', async () => {
    const abort = new AbortController()
    let providerSawAbort = false
    const model = mockModel({
      doGenerate: async () => {
        throw new Error('unused')
      },
      doStream: async (options) => ({
        stream: new ReadableStream({
          async start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] })
            c.enqueue({ type: 'text-start', id: 't' })
            c.enqueue({ type: 'text-delta', id: 't', delta: 'Partial' })
            await new Promise((r) => setTimeout(r, 5))
            abort.abort()
            await new Promise((r) => (options.abortSignal?.aborted ? r() : options.abortSignal?.addEventListener('abort', r)))
            providerSawAbort = true
            c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          },
        }),
      }),
    })
    const frames = []
    const reply = await streamChatReply({ model, messages, signal: abort.signal, onText: (t) => frames.push(t), flushMs: 0 })
    expect(providerSawAbort).toBe(true)
    expect(reply.stopped).toBe(true)
    expect(frames).toEqual(['Partial'])
  })
})

describe('plain chat streaming (browser reader)', () => {
  test('reassembles frames split across chunks and returns the final answer', async () => {
    const body = ndjson({ type: 'text', text: 'Hel' }) + ndjson({ type: 'text', text: 'Hello C-07' }) + ndjson({ type: 'done', text: 'Hello C-07.', model: 'm', provider: 'p' })
    const seen = []
    const out = await readAnswerStream(bytes([body.slice(0, 7), body.slice(7, 40), body.slice(40)]), (t) => seen.push(t))
    expect(seen).toEqual(['Hel', 'Hello C-07'])
    expect(out).toMatchObject({ text: 'Hello C-07.', model: 'm', provider: 'p', fallback: false })
  })

  test('an error frame throws the classified kind, never provider text', async () => {
    const body = ndjson({ type: 'text', text: 'Half' }) + ndjson({ type: 'error', error: 'The assistant is busy', code: 'unavailable', retryAfterSec: 30 })
    await expect(readAnswerStream(bytes([body]), () => {})).rejects.toMatchObject({ code: 'unavailable', retryAfterSec: 30 })
  })

  test('a stream cut before the final frame is an error', async () => {
    await expect(readAnswerStream(bytes([ndjson({ type: 'text', text: 'Half' })]), () => {})).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('routing chart requests to the agent', () => {
  test.each([
    ['Show me the ABW trend for C-07', true],
    ['Graph DO in C-03 this week', true],
    ['Montre-moi la courbe de croissance de C-07', true],
    ['How much feed is left?', false],
  ])('%s', (q, want) => {
    expect(isChartRequest(q)).toBe(want)
  })

  test('chart requests do not change the action routing', () => {
    expect(isActionRequest('Record 3 dead in C-02')).toBe(true)
  })
})
