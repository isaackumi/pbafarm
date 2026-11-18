import { describe, expect, it } from 'vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import {
  type FetchFn,
  type HttpError,
  fetchLayer,
  redactUrl,
  requestJson,
  requestJsonAs,
} from './effectHttp'

type Step = { status: number; body?: unknown } | { throws: unknown } | { hang: true }

/** Fake fetch that plays `steps` in order and records calls. */
function scripted(steps: Step[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetch: FetchFn = (url, init) => {
    calls.push({ url, init })
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]
    if ('throws' in step) return Promise.reject(step.throws)
    if ('hang' in step) {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }
    const text = step.body === undefined ? '' : typeof step.body === 'string' ? step.body : JSON.stringify(step.body)
    return Promise.resolve(new Response(text, { status: step.status }))
  }
  return { fetch, calls }
}

const fast = { retryBaseDelayMs: 1 }

function run<A>(effect: Effect.Effect<A, HttpError, never>) {
  return Effect.runPromise(Effect.result(effect))
}

describe('requestJson', () => {
  it('returns parsed JSON on 2xx and sends JSON bodies', async () => {
    const { fetch, calls } = scripted([{ status: 200, body: { ok: 1 } }])
    const result = await run(
      requestJson({ url: 'https://api.test/x', body: { a: 1 } }, fast).pipe(Effect.provide(fetchLayer(fetch))),
    )
    expect(result._tag).toBe('Success')
    if (result._tag === 'Success') expect(result.success.body).toEqual({ ok: 1 })
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.body).toBe('{"a":1}')
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('retries 5xx with backoff and succeeds', async () => {
    const { fetch, calls } = scripted([{ status: 503 }, { status: 502 }, { status: 200, body: { ok: true } }])
    const result = await run(requestJson({ url: 'https://api.test/x' }, fast).pipe(Effect.provide(fetchLayer(fetch))))
    expect(result._tag).toBe('Success')
    expect(calls).toHaveLength(3)
  })

  it('never retries 4xx and exposes status and body', async () => {
    const { fetch, calls } = scripted([{ status: 400, body: { error: { message: 'bad model' } } }])
    const result = await run(requestJson({ url: 'https://api.test/x' }, fast).pipe(Effect.provide(fetchLayer(fetch))))
    expect(calls).toHaveLength(1)
    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') {
      expect(result.failure._tag).toBe('HttpStatusError')
      if (result.failure._tag === 'HttpStatusError') {
        expect(result.failure.status).toBe(400)
        expect(result.failure.body).toEqual({ error: { message: 'bad model' } })
        expect(result.failure.text).toBe('{"error":{"message":"bad model"}}')
      }
    }
  })

  it('does not retry 429 (4xx) by default', async () => {
    const { fetch, calls } = scripted([{ status: 429 }])
    await run(requestJson({ url: 'https://api.test/x' }, fast).pipe(Effect.provide(fetchLayer(fetch))))
    expect(calls).toHaveLength(1)
  })

  it('returns the last failure after retries run out', async () => {
    const { fetch, calls } = scripted([{ status: 500 }])
    const result = await run(
      requestJson({ url: 'https://api.test/x' }, { ...fast, retries: 2 }).pipe(Effect.provide(fetchLayer(fetch))),
    )
    expect(calls).toHaveLength(3)
    expect(result._tag === 'Failure' && result.failure._tag).toBe('HttpStatusError')
  })

  it('retries network errors', async () => {
    const { fetch, calls } = scripted([{ throws: new TypeError('fetch failed') }, { status: 200, body: {} }])
    const result = await run(requestJson({ url: 'https://api.test/x' }, fast).pipe(Effect.provide(fetchLayer(fetch))))
    expect(result._tag).toBe('Success')
    expect(calls).toHaveLength(2)
  })

  it('times out, aborts the fetch, and retries', async () => {
    const { fetch, calls } = scripted([{ hang: true }, { status: 200, body: { ok: 1 } }])
    const result = await run(
      requestJson({ url: 'https://api.test/x' }, { ...fast, timeoutMs: 20 }).pipe(Effect.provide(fetchLayer(fetch))),
    )
    expect(result._tag).toBe('Success')
    expect(calls).toHaveLength(2)
    expect(calls[0].init?.signal?.aborted).toBe(true)
  })

  it('reports HttpTimeoutError when every attempt hangs', async () => {
    const { fetch } = scripted([{ hang: true }])
    const result = await run(
      requestJson({ url: 'https://api.test/x?key=secret' }, { ...fast, timeoutMs: 10, retries: 1 }).pipe(
        Effect.provide(fetchLayer(fetch)),
      ),
    )
    expect(result._tag === 'Failure' && result.failure._tag).toBe('HttpTimeoutError')
    if (result._tag === 'Failure') expect(result.failure.message).not.toContain('secret')
  })

  it('retries: 0 makes a single attempt', async () => {
    const { fetch, calls } = scripted([{ status: 500 }])
    await run(requestJson({ url: 'https://api.test/x' }, { retries: 0 }).pipe(Effect.provide(fetchLayer(fetch))))
    expect(calls).toHaveLength(1)
  })
})

describe('requestJsonAs', () => {
  const Body = Schema.Struct({ id: Schema.String })

  it('decodes a valid body', async () => {
    const { fetch } = scripted([{ status: 200, body: { id: 'm1', extra: true } }])
    const result = await run(requestJsonAs(Body, { url: 'https://api.test/x' }).pipe(Effect.provide(fetchLayer(fetch))))
    expect(result._tag === 'Success' && result.success).toEqual({ id: 'm1' })
  })

  it('fails with HttpDecodeError on an unexpected shape, without retrying', async () => {
    const { fetch, calls } = scripted([{ status: 200, body: { id: 7 } }])
    const result = await run(
      requestJsonAs(Body, { url: 'https://api.test/x' }, fast).pipe(Effect.provide(fetchLayer(fetch))),
    )
    expect(calls).toHaveLength(1)
    expect(result._tag === 'Failure' && result.failure._tag).toBe('HttpDecodeError')
  })
})

describe('redactUrl', () => {
  it('drops query strings', () => {
    expect(redactUrl('https://g.example/v1/models/x:generateContent?key=AIza123')).toBe(
      'https://g.example/v1/models/x:generateContent',
    )
  })
})
