import { describe, expect, it } from 'vitest'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import { type FetchFn, fetchLayer } from './effectHttp'
import { SITEVERIFY_URL, siteverify, type SiteverifyInput } from './turnstile'

type Step = { status: number; body?: unknown } | { throws: unknown } | { hang: true }

function scripted(steps: Step[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetch: FetchFn = (url, init) => {
    calls.push({ url, init })
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]
    if ('throws' in step) return Promise.reject(step.throws)
    if ('hang' in step) {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    const text = step.body === undefined ? '' : typeof step.body === 'string' ? step.body : JSON.stringify(step.body)
    return Promise.resolve(new Response(text, { status: step.status }))
  }
  return { fetch, calls }
}

const input: SiteverifyInput = {
  secret: 'sk',
  token: 'tok',
  expectedAction: 'signup',
  idempotencyKey: 'idem-1',
}
const fast = { timeoutMs: 50, retries: 2, retryBaseDelayMs: 1 }

async function run(steps: Step[], over: Partial<SiteverifyInput> = {}) {
  const fake = scripted(steps)
  const result = await Effect.runPromise(
    Effect.result(siteverify({ ...input, ...over }, fast).pipe(Effect.provide(fetchLayer(fake.fetch)))),
  )
  return { result, calls: fake.calls }
}

const failure = (r: Result.Result<void, unknown>) =>
  Result.isFailure(r) ? (r.failure as { _tag: string; details?: { reason?: string } }) : null

describe('siteverify (CF-003)', () => {
  it('passes a successful check and posts secret, token and idempotency key', async () => {
    const { result, calls } = await run([{ status: 200, body: { success: true, action: 'signup', hostname: 'app.example' } }])
    expect(Result.isSuccess(result)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(SITEVERIFY_URL)
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ secret: 'sk', response: 'tok', idempotency_key: 'idem-1' })
  })

  it('refuses a failed challenge without retrying', async () => {
    const { result, calls } = await run([{ status: 200, body: { success: false, 'error-codes': ['invalid-input-response'] } }])
    expect(failure(result)).toMatchObject({ _tag: 'UserFacingError', details: { reason: 'TURNSTILE_FAILED' } })
    expect(calls).toHaveLength(1)
  })

  it('refuses a token minted for another action or hostname', async () => {
    const action = await run([{ status: 200, body: { success: true, action: 'password_reset' } }])
    expect(failure(action.result)?.details?.reason).toBe('TURNSTILE_ACTION_MISMATCH')
    const host = await run([{ status: 200, body: { success: true, action: 'signup', hostname: 'evil.example' } }], {
      allowedHostnames: ['app.example'],
    })
    expect(failure(host.result)?.details?.reason).toBe('TURNSTILE_HOSTNAME_MISMATCH')
  })

  it('retries 5xx (same idempotency key), not 4xx', async () => {
    const retried = await run([{ status: 503 }, { status: 200, body: { success: true } }])
    expect(Result.isSuccess(retried.result)).toBe(true)
    expect(retried.calls.map((c) => JSON.parse(String(c.init?.body)).idempotency_key)).toEqual(['idem-1', 'idem-1'])
    const bad = await run([{ status: 400, body: { success: false } }])
    expect(failure(bad.result)?._tag).toBe('TurnstileUnavailable')
    expect(bad.calls).toHaveLength(1)
  })

  it('times out, then reports unavailable', async () => {
    const { result, calls } = await run([{ hang: true }])
    expect(failure(result)?._tag).toBe('TurnstileUnavailable')
    expect(calls).toHaveLength(3)
  })

  it('reports an unexpected body as unavailable', async () => {
    const { result } = await run([{ status: 200, body: { ok: 'yes' } }])
    expect(failure(result)?._tag).toBe('TurnstileUnavailable')
  })

  it('refuses an empty token without calling Cloudflare', async () => {
    const { result, calls } = await run([{ status: 200, body: { success: true } }], { token: '' })
    expect(failure(result)?.details?.reason).toBe('TURNSTILE_TOKEN_INVALID')
    expect(calls).toHaveLength(0)
  })
})
