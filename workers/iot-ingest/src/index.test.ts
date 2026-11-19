import { describe, expect, test } from 'vitest'
import { signInbound } from '../../../convex/integrations/inboundLogic'
import { handle, type Env } from './index'
import type { DeviceRecord } from './devices'

const NOW = Date.UTC(2026, 0, 15, 12)
const SECRET = 'device-secret-123'
const TOKEN = 'tok_abcdef'

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function env(devices: Record<string, DeviceRecord>): Promise<Env> {
  return {
    DEVICES: { get: async (key: string) => devices[key.replace(/^device:/, '')] ?? null },
    CONVEX_SITE_URL: 'https://demo.convex.site/',
    CONVEX_INGEST_KEY: 'pk_ingest',
  }
}
const devices = async () =>
  env({
    'probe-1': { secret: SECRET },
    'probe-2': { tokenSha256: await sha256Hex(TOKEN), cageId: 'cage_pinned' },
    'probe-off': { secret: SECRET, disabled: true },
  })

type Step = (url: string, init?: RequestInit) => Response | Promise<Response>
function fake(steps: Step[]) {
  const calls: { url: string; headers: any; body: any }[] = []
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers, body: init?.body ? JSON.parse(String(init.body)) : null })
    return steps[Math.min(calls.length - 1, steps.length - 1)](url, init)
  }
  return { impl, calls }
}
const reply = (status: number, body: unknown): Step => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const stored = (accepted: number, rejected: { index: number; reason: string }[] = []) =>
  reply(200, { accepted, duplicates: 0, rejected })

const reading = (o: Record<string, unknown> = {}) => ({ parameter: 'dissolved_oxygen', value: 5.2, measuredAt: NOW - 60_000, ...o })
const POLICY = { timeoutMs: 30, retries: 2, retryBaseDelayMs: 1 }

async function signed(body: unknown, opts: { deviceId?: string; at?: number; secret?: string } = {}) {
  const raw = JSON.stringify(body)
  return new Request('https://iot.example.com/v1/readings', {
    method: 'POST',
    headers: {
      'X-Device-Id': opts.deviceId ?? 'probe-1',
      'X-Device-Signature': await signInbound(opts.secret ?? SECRET, raw, opts.at ?? NOW),
    },
    body: raw,
  })
}
const call = async (req: Request, steps: Step[]) => {
  const f = fake(steps)
  const res = await handle(req, await devices(), { fetch: f.impl, now: () => NOW, policy: POLICY })
  return { res, body: await res.json(), calls: f.calls }
}

describe('device authentication', () => {
  test('HMAC device: readings stamped with the device id and forwarded with the Worker key', async () => {
    const { res, body, calls } = await call(await signed({ readings: [reading({ deviceId: 'spoofed' })] }), [stored(1)])
    expect(res.status).toBe(200)
    expect(body).toEqual({ accepted: 1, duplicates: 0, rejected: [] })
    expect(calls[0].url).toBe('https://demo.convex.site/ingest/v1/readings')
    expect(calls[0].headers.Authorization).toBe('Bearer pk_ingest')
    expect(calls[0].body.readings[0]).toMatchObject({ deviceId: 'probe-1', parameter: 'dissolved_oxygen', value: 5.2 })
  })

  test('token device pinned to a unit', async () => {
    const req = new Request('https://iot.example.com/v1/readings', {
      method: 'POST',
      headers: { 'X-Device-Id': 'probe-2', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ readings: [reading({ cageId: 'someone_else' })] }),
    })
    const { res, calls } = await call(req, [stored(1)])
    expect(res.status).toBe(200)
    expect(calls[0].body.readings[0]).toMatchObject({ deviceId: 'probe-2', cageId: 'cage_pinned' })
  })

  test('bad signature, stale timestamp, wrong token, unknown and disabled devices are refused before any forward', async () => {
    const cases: [Request, number, string][] = [
      [await signed({ readings: [reading()] }, { secret: 'wrong' }), 401, 'does not match'],
      [await signed({ readings: [reading()] }, { at: NOW - 10 * 60_000 }), 401, 'seconds from now'],
      [await signed({ readings: [reading()] }, { deviceId: 'nobody' }), 401, 'Unknown device'],
      [await signed({ readings: [reading()] }, { deviceId: 'probe-off' }), 403, 'disabled'],
      [
        new Request('https://iot.example.com/v1/readings', {
          method: 'POST',
          headers: { 'X-Device-Id': 'probe-2', Authorization: 'Bearer nope' },
          body: '{}',
        }),
        401,
        'Unknown device',
      ],
      [new Request('https://iot.example.com/v1/readings', { method: 'POST', body: '{}' }), 401, 'X-Device-Id'],
    ]
    for (const [req, status, text] of cases) {
      const { res, body, calls } = await call(req, [stored(1)])
      expect(res.status).toBe(status)
      expect(body.error).toContain(text)
      expect(calls).toHaveLength(0)
    }
  })
})

describe('validation and batching', () => {
  test('invalid readings are rejected locally with their index; all invalid is 422 without a forward', async () => {
    const { res, body, calls } = await call(
      await signed({ readings: [reading({ value: 99 }), reading(), reading({ parameter: 'magic' })] }),
      [stored(1)],
    )
    expect(res.status).toBe(200)
    expect(calls[0].body.readings).toHaveLength(1)
    expect(body.rejected.map((r: any) => r.index)).toEqual([0, 2])
    const none = await call(await signed({ readings: [reading({ value: -1 })] }), [stored(1)])
    expect(none.res.status).toBe(422)
    expect(none.calls).toHaveLength(0)
    const empty = await call(await signed({ readings: [] }), [stored(1)])
    expect(empty.res.status).toBe(400)
  })

  test('600 readings go as two chunks; upstream reject indexes map back to the device batch', async () => {
    const readings = Array.from({ length: 600 }, (_, i) => reading({ measuredAt: NOW - (i + 1) * 1000 }))
    readings[1] = reading({ value: 50 }) // rejected locally
    const { res, body, calls } = await call(await signed({ readings }), [
      stored(500),
      stored(98, [{ index: 3, reason: 'cage not found' }]),
    ])
    expect(res.status).toBe(200)
    expect(calls.map((c) => c.body.readings.length)).toEqual([500, 99])
    expect(body.accepted).toBe(598)
    // chunk 2 index 3 = valid reading #503 = device index 504 (index 1 was dropped)
    expect(body.rejected).toEqual([
      { index: 1, reason: expect.stringContaining('between') },
      { index: 504, reason: 'cage not found' },
    ])
  })
})

describe('forwarding failures (scripted Convex)', () => {
  test('5xx is retried, then succeeds', async () => {
    const { res, calls } = await call(await signed({ readings: [reading()] }), [reply(503, {}), stored(1)])
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  test('4xx (bad Worker key) is not retried and is a 502', async () => {
    const { res, body, calls } = await call(await signed({ readings: [reading()] }), [reply(401, { error: 'bad key' })])
    expect(res.status).toBe(502)
    expect(body.error).toContain('refused')
    expect(calls).toHaveLength(1)
  })

  test('422 from Convex passes its result through', async () => {
    const { res, body } = await call(await signed({ readings: [reading()] }), [
      reply(422, { accepted: 0, duplicates: 0, rejected: [{ index: 0, reason: 'cage not found' }] }),
    ])
    expect(res.status).toBe(422)
    expect(body.rejected).toEqual([{ index: 0, reason: 'cage not found' }])
  })

  test('timeouts are retried, then 503 with Retry-After', async () => {
    const hang: Step = (_u, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    const { res, calls } = await call(await signed({ readings: [reading()] }), [hang])
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(calls).toHaveLength(3)
  })

  test('a 2xx body that is not an ingest result is a 502', async () => {
    const { res, body } = await call(await signed({ readings: [reading()] }), [reply(200, { ok: true })])
    expect(res.status).toBe(502)
    expect(body.error).toContain('Unexpected response')
  })
})

describe('routing and limits', () => {
  test('health, 404, 405, 413 and missing configuration', async () => {
    const e = await devices()
    expect((await handle(new Request('https://x/health'), e)).status).toBe(200)
    expect((await handle(new Request('https://x/other'), e)).status).toBe(404)
    expect((await handle(new Request('https://x/v1/readings'), e)).status).toBe(405)
    const big = new Request('https://x/v1/readings', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })
    expect((await handle(big, e)).status).toBe(413)
    const unconfigured = await handle(await signed({ readings: [reading()] }), { ...e, CONVEX_INGEST_KEY: '' })
    expect(unconfigured.status).toBe(503)
  })
})
