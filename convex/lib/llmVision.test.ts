import { describe, expect, it } from 'vitest'
import * as Effect from 'effect/Effect'
import { type FetchFn, fetchLayer } from './effectHttp'
import { parseExtraction, readLogbookPhoto, toBase64, type VisionOptions } from './llmVision'

type Step = { status: number; body?: unknown } | { hang: true }

function scripted(steps: Step[]) {
  const calls: { url: string; body: unknown }[] = []
  const fetch: FetchFn = (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]
    if ('hang' in step) {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    return Promise.resolve(new Response(JSON.stringify(step.body ?? {}), { status: step.status }))
  }
  return { fetch, calls }
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

const opts = (kind: VisionOptions['kind'], extra: Partial<VisionOptions> = {}): VisionOptions => ({
  kind,
  providerId: kind === 'openai' ? 'openai' : kind,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'k',
  model: 'm',
  image: { bytes: JPEG, mime: 'image/jpeg' },
  prompt: 'read',
  policy: { timeoutMs: 50, retries: 2, retryBaseDelayMs: 1 },
  ...extra,
})

const rowsJson = JSON.stringify({ date: '2026-11-20', rows: [{ unit: 'A1', feedKg: 25, mortality: 2, feedType: 'Grower' }] })
const gemini = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40 },
})

function run(o: VisionOptions, fetch: FetchFn) {
  return Effect.runPromise(Effect.result(readLogbookPhoto(o).pipe(Effect.provide(fetchLayer(fetch)))))
}

describe('BOT-006 logbook extraction', () => {
  it('parses rows, tolerating code fences, and caps them', async () => {
    const ok = await Effect.runPromise(Effect.result(parseExtraction('```json\n' + rowsJson + '\n```')))
    expect(ok._tag).toBe('Success')
    if (ok._tag === 'Success') expect(ok.success.rows[0]).toMatchObject({ unit: 'A1', feedKg: 25 })
    const many = JSON.stringify({ rows: Array.from({ length: 60 }, (_, i) => ({ unit: `U${i}` })) })
    const capped = await Effect.runPromise(parseExtraction(many))
    expect(capped.rows).toHaveLength(40)
  })

  it('schema decode failure is a LogbookDecodeError, with usage kept for metering', async () => {
    const { fetch } = scripted([{ status: 200, body: gemini('{"rows":[{"unit":5,"feedKg":"lots"}]}') }])
    const r = await run(opts('gemini'), fetch)
    expect(r._tag).toBe('Failure')
    if (r._tag === 'Failure') {
      expect(r.failure._tag).toBe('LogbookDecodeError')
      if (r.failure._tag === 'LogbookDecodeError') expect(r.failure.usage?.inputTokens).toBe(900)
    }
    const prose = scripted([{ status: 200, body: gemini('Sorry, I cannot read that.') }])
    const r2 = await run(opts('gemini'), prose.fetch)
    expect(r2._tag === 'Failure' && r2.failure._tag).toBe('LogbookDecodeError')
  })

  it('Gemini: inline image, JSON mode, usage', async () => {
    const { fetch, calls } = scripted([{ status: 200, body: gemini(rowsJson) }])
    const r = await run(opts('gemini'), fetch)
    expect(r._tag).toBe('Success')
    if (r._tag === 'Success') expect(r.success.usage).toEqual({ inputTokens: 900, outputTokens: 40 })
    const body = calls[0].body as { contents: { parts: { inline_data?: { data: string } }[] }[]; generationConfig: Record<string, unknown> }
    expect(body.contents[0].parts[0].inline_data?.data).toBe(toBase64(JPEG))
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })

  it('OpenAI-compatible: data URL image and json_object', async () => {
    const { fetch, calls } = scripted([
      { status: 200, body: { choices: [{ message: { content: rowsJson } }], usage: { prompt_tokens: 5, completion_tokens: 6 } } },
    ])
    const r = await run(opts('openai'), fetch)
    expect(r._tag).toBe('Success')
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    const body = calls[0].body as { response_format: unknown; messages: { content: unknown }[] }
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(JSON.stringify(body.messages[1].content)).toContain('data:image/jpeg;base64,')
  })

  it('Anthropic: base64 image block', async () => {
    const { fetch, calls } = scripted([{ status: 200, body: { content: [{ type: 'text', text: rowsJson }] } }])
    const r = await run(opts('anthropic'), fetch)
    expect(r._tag).toBe('Success')
    expect(JSON.stringify(calls[0].body)).toContain('"type":"base64"')
  })

  it('4xx is not retried; 5xx is; timeouts fail as LlmError', async () => {
    const four = scripted([{ status: 400, body: { error: { message: 'bad image' } } }])
    const r4 = await run(opts('gemini'), four.fetch)
    expect(four.calls).toHaveLength(1)
    expect(r4._tag === 'Failure' && r4.failure.message).toBe('bad image')

    const five = scripted([{ status: 503 }, { status: 200, body: gemini(rowsJson) }])
    const r5 = await run(opts('gemini'), five.fetch)
    expect(five.calls).toHaveLength(2)
    expect(r5._tag).toBe('Success')

    const slow = scripted([{ hang: true }])
    const rt = await run(opts('gemini', { policy: { timeoutMs: 20, retries: 0 } }), slow.fetch)
    expect(rt._tag === 'Failure' && rt.failure._tag).toBe('LlmError')
  })
})
