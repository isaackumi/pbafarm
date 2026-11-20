import { describe, expect, test } from 'vitest'
import { decodeChatBody, runChat, runChatWithUsage, type ChatOptions } from './llmProviders'

/** Scripted fetch: one response (or thrower) per call, recording requests. */
function fake(steps: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>) {
  const calls: Array<{ url: string; body: any; headers: any }> = []
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, headers: init?.headers })
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]
    return step(url, init)
  }
  return { impl, calls }
}
const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const base = (o: Partial<ChatOptions> = {}): ChatOptions => ({
  kind: 'openai',
  providerId: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'Be brief' },
    { role: 'user', content: 'FCR?' },
  ],
  policy: { timeoutMs: 200, retries: 2, retryBaseDelayMs: 1 },
  ...o,
})

const failure = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as Error & { status?: number }
  }
  throw new Error('expected a failure')
}

describe('llm providers (PLAT-006)', () => {
  test('OpenAI-compatible: text from the first choice, bearer key, body as before', async () => {
    const f = fake([json(200, { choices: [{ message: { content: ' 1.4 ' } }] })])
    expect(await runChat(base(), f.impl)).toBe('1.4')
    expect(f.calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect(f.calls[0].headers.Authorization).toBe('Bearer sk-test')
    expect(f.calls[0].body).toEqual({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: base().messages,
    })
  })

  test('Gemini: system instruction, model role, joined parts', async () => {
    const f = fake([json(200, { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] })])
    const text = await runChat(
      base({
        kind: 'gemini',
        providerId: 'gemini',
        model: 'gemini-2.0-flash',
        messages: [
          { role: 'system', content: 'S' },
          { role: 'assistant', content: 'hi' },
          { role: 'user', content: 'q' },
        ],
      }),
      f.impl,
    )
    expect(text).toBe('ab')
    expect(f.calls[0].body.systemInstruction).toEqual({ parts: [{ text: 'S' }] })
    expect(f.calls[0].body.contents.map((c: any) => c.role)).toEqual(['model', 'user'])
  })

  test('Anthropic: text blocks only', async () => {
    const f = fake([
      json(200, { content: [{ type: 'thinking', text: 'x' }, { type: 'text', text: 'Answer' }] }),
    ])
    expect(await runChat(base({ kind: 'anthropic', providerId: 'anthropic' }), f.impl)).toBe('Answer')
    expect(f.calls[0].headers['x-api-key']).toBe('sk-test')
  })

  test('Anthropic: no temperature (current models 400 on it) and room for thinking', async () => {
    const f = fake([json(200, { content: [{ type: 'text', text: 'ok' }] })])
    await runChat(base({ kind: 'anthropic', providerId: 'anthropic', model: 'claude-haiku-5-5', temperature: 0.3 }), f.impl)
    expect(f.calls[0].body).not.toHaveProperty('temperature')
    expect(f.calls[0].body.max_tokens).toBeGreaterThanOrEqual(16000)
    expect(f.calls[0].body.system).toBe('Be brief')
  })

  test('4xx: provider message, no retry', async () => {
    const f = fake([json(401, { error: { message: 'Incorrect API key provided' } })])
    const e = await failure(runChat(base(), f.impl))
    expect(e.message).toBe('Incorrect API key provided')
    expect(e.status).toBe(401)
    expect(f.calls).toHaveLength(1)
  })

  test('Gemini 4xx without a message keeps the old text, and the key never shows', async () => {
    const f = fake([json(400, {})])
    const e = await failure(runChat(base({ kind: 'gemini', providerId: 'gemini', apiKey: 'AIzaSECRET' }), f.impl))
    expect(e.message).toBe('Gemini request failed (400)')
    expect(e.message).not.toContain('AIzaSECRET')
  })

  test('5xx and network errors are retried', async () => {
    const f = fake([
      json(503, { error: { message: 'overloaded' } }),
      () => {
        throw new TypeError('fetch failed')
      },
      json(200, { choices: [{ message: { content: 'ok' } }] }),
    ])
    expect(await runChat(base(), f.impl)).toBe('ok')
    expect(f.calls).toHaveLength(3)
  })

  test('a timeout is retried, then reported', async () => {
    const never = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
      )
    const f = fake([never])
    const e = await failure(runChat(base({ policy: { timeoutMs: 20, retries: 1, retryBaseDelayMs: 1 } }), f.impl))
    expect(e.message).toBe('The model did not answer within 0.02 seconds')
    expect(f.calls).toHaveLength(2)
  })

  test('a 2xx body without text is an empty response (Schema-checked)', async () => {
    const f = fake([json(200, { choices: 'nope' })])
    expect((await failure(runChat(base(), f.impl))).message).toBe('Empty response from model')
    const g = fake([json(200, { candidates: [] })])
    expect((await failure(runChat(base({ kind: 'gemini', providerId: 'gemini' }), g.impl))).message).toBe(
      'Empty response from Gemini',
    )
  })

  test('missing key or base URL fail before any request', async () => {
    const f = fake([json(200, {})])
    expect((await failure(runChat(base({ apiKey: ' ' }), f.impl))).message).toBe('API key is required')
    expect((await failure(runChat(base({ baseUrl: '' }), f.impl))).message).toMatch(/needs a base URL/)
    expect(f.calls).toHaveLength(0)
  })

  test('request body envelope', () => {
    expect(decodeChatBody({ messages: [], provider: 'gemini', temperature: 0.2 }).ok).toBe(true)
    expect(decodeChatBody(undefined).ok).toBe(true)
    expect(decodeChatBody({ messages: [], provider: 42 })).toEqual({
      ok: false,
      error: 'Invalid request: provider, model, asOf and locationId must be text, temperature and days numbers, deep true or false',
    })
    expect(decodeChatBody({ messages: [], temperature: 'hot' }).ok).toBe(false)
    // Ask Anowa scope (artboard 47).
    expect(decodeChatBody({ messages: [], locationId: 'k57abc', days: 30, deep: true }).ok).toBe(true)
    expect(decodeChatBody({ messages: [], deep: 'yes' }).ok).toBe(false)
  })

  test('token usage from each provider (INT-009); absent counts stay undefined', async () => {
    const openai = fake([json(200, { usage: { prompt_tokens: 120, completion_tokens: 30 }, choices: [{ message: { content: 'ok' } }] })])
    expect(await runChatWithUsage(base(), openai.impl)).toEqual({ text: 'ok', usage: { inputTokens: 120, outputTokens: 30 } })
    const gemini = fake([
      json(200, { usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 7 }, candidates: [{ content: { parts: [{ text: 'g' }] } }] }),
    ])
    expect((await runChatWithUsage(base({ kind: 'gemini', providerId: 'gemini', model: 'gemini-2.0-flash' }), gemini.impl)).usage).toEqual({
      inputTokens: 50,
      outputTokens: 7,
    })
    const claude = fake([json(200, { usage: { input_tokens: 9, output_tokens: 3 }, content: [{ type: 'text', text: 'c' }] })])
    expect((await runChatWithUsage(base({ kind: 'anthropic', providerId: 'anthropic', model: 'claude-3-5-haiku-latest' }), claude.impl)).usage).toEqual({
      inputTokens: 9,
      outputTokens: 3,
    })
    const none = fake([json(200, { choices: [{ message: { content: 'x' } }] })])
    expect((await runChatWithUsage(base(), none.impl)).usage).toEqual({ inputTokens: undefined, outputTokens: undefined })
  })
})
