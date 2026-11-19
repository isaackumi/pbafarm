/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import schema from '../schema'
import { internal } from '../_generated/api'
import { fetchLayer, type FetchFn } from './effectHttp'
import { R2Storage, presignS3Url, r2ConfigFromEnv, r2Layer, type R2Config } from './r2'
import { base64ToHex, copyObjects, reconcileObjects } from '../r2Sync'

const modules = import.meta.glob('../**/*.ts')

const config: R2Config = { accountId: 'acct', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'anowa-files' }
const fixedNow = () => new Date('2026-11-18T00:00:00Z')

type Stored = { bytes: Uint8Array; sha256?: string; contentType?: string }

/** In-memory S3 with scripted failures: `failures` is consumed one per request. */
function fakeR2(script: Array<'5xx' | '403' | 'hang' | 'network'> = []) {
  const objects = new Map<string, Stored>()
  const calls: Array<{ method: string; path: string; signed: string | null }> = []
  const fetchFn: FetchFn = async (input, init) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, path: url.pathname, signed: url.searchParams.get('X-Amz-SignedHeaders') })
    const step = script.shift()
    if (step === 'network') throw new TypeError('fetch failed')
    if (step === '5xx') return new Response('oops', { status: 503 })
    if (step === '403') return new Response('denied', { status: 403 })
    if (step === 'hang') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    if (!url.searchParams.get('X-Amz-Signature')) return new Response('unsigned', { status: 403 })
    const key = url.pathname
    const headers = new Headers(init?.headers)
    if (method === 'PUT') {
      const bytes = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer())
      objects.set(key, { bytes, sha256: headers.get('x-amz-meta-sha256') ?? undefined, contentType: headers.get('content-type') ?? undefined })
      return new Response(null, { status: 200, headers: { etag: '"e1"' } })
    }
    const obj = objects.get(key)
    if (!obj) return new Response(null, { status: 404 })
    const h: Record<string, string> = { 'content-length': String(obj.bytes.length), etag: '"e1"' }
    if (obj.sha256) h['x-amz-meta-sha256'] = obj.sha256
    if (method === 'HEAD') return new Response(null, { status: 200, headers: h })
    return new Response(obj.bytes as BodyInit, { status: 200, headers: h })
  }
  return { objects, calls, fetchFn }
}

const run = <A, E>(program: Effect.Effect<A, E, R2Storage>, fetchFn: FetchFn, cfg: R2Config | null = config) =>
  Effect.runPromise(
    Effect.result(
      program.pipe(
        Effect.provide(
          r2Layer(cfg, { now: fixedNow, policy: { timeoutMs: 50, retries: 2, retryBaseDelayMs: 1 } }).pipe(
            Layer.provide(fetchLayer(fetchFn)),
          ),
        ),
      ),
    ),
  )

describe('SigV4 presigning', () => {
  test('matches the AWS documented presigned GET example', async () => {
    const url = await presignS3Url({
      method: 'GET',
      origin: 'https://examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresSec: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    })
    expect(url).toContain('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request')
    expect(url).toContain('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
  })

  test('env config is all-or-nothing', () => {
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' })).toBeNull()
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' })).toMatchObject({
      bucket: 'b',
    })
  })
})

describe('R2 storage service', () => {
  test('put, head and get round-trip; sha256 metadata is signed', async () => {
    const r2 = fakeR2()
    const r = await run(
      Effect.gen(function* () {
        const s = yield* R2Storage
        yield* s.put('files/a', new Blob(['hello']), { contentType: 'text/plain', sha256: 'ab' })
        const head = yield* s.head('files/a')
        const body = yield* s.get('files/a')
        const missing = yield* s.head('files/none')
        return { head, body, missing }
      }),
      r2.fetchFn,
    )
    expect(r._tag).toBe('Success')
    const v = (r as any).success
    expect(v.head).toMatchObject({ size: 5, sha256: 'ab' })
    expect(await v.body.text()).toBe('hello')
    expect(v.missing).toBeNull()
    expect(r2.calls[0]).toMatchObject({ method: 'PUT', path: '/anowa-files/files/a', signed: 'host;x-amz-meta-sha256' })
    expect(r2.calls[0].path.startsWith('/anowa-files/')).toBe(true)
  })

  test('5xx and network errors are retried; 4xx is not', async () => {
    const flaky = fakeR2(['5xx', 'network'])
    const ok = await run(Effect.gen(function* () { return yield* (yield* R2Storage).head('k') }), flaky.fetchFn)
    expect(ok._tag).toBe('Success')
    expect(flaky.calls).toHaveLength(3)

    const denied = fakeR2(['403'])
    const r = await run(Effect.gen(function* () { return yield* (yield* R2Storage).head('k') }), denied.fetchFn)
    expect(r._tag).toBe('Failure')
    expect((r as any).failure).toMatchObject({ _tag: 'R2Error', status: 403, retryable: false })
    expect(denied.calls).toHaveLength(1)
  })

  test('a hung request times out and is retried', async () => {
    const r2 = fakeR2(['hang', 'hang', 'hang'])
    const r = await run(Effect.gen(function* () { return yield* (yield* R2Storage).head('k') }), r2.fetchFn)
    expect(r._tag).toBe('Failure')
    expect((r as any).failure.message).toMatch(/timed out/)
    expect(r2.calls).toHaveLength(3)
  })

  test('not configured: no request is made', async () => {
    const r2 = fakeR2()
    const r = await run(Effect.gen(function* () { return yield* (yield* R2Storage).head('k') }), r2.fetchFn, null)
    expect((r as any).failure?._tag).toBe('R2NotConfigured')
    expect(r2.calls).toHaveLength(0)
  })
})

describe('copy and reconciliation (CF-006)', () => {
  const sha = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)))
  const meta = (id: string, size: number) => ({ storageId: id as any, size, sha256: sha, contentType: 'text/plain' })

  test('dry run copies nothing; real run copies once; reconcile finds gaps', async () => {
    const r2 = fakeR2()
    const items = [
      { storageId: 'a', meta: meta('a', 5) },
      { storageId: 'gone', meta: null },
    ]
    const load = async () => new Blob(['hello'])
    const dry = await run(copyObjects(items, load, { dryRun: true }), r2.fetchFn)
    expect((dry as any).success.map((x: any) => x.status)).toEqual(['would_copy', 'missing_in_convex'])
    expect(r2.objects.size).toBe(0)

    await run(copyObjects(items, load, { dryRun: false }), r2.fetchFn)
    expect(r2.objects.get('/anowa-files/files/a')?.sha256).toBe(base64ToHex(sha))
    const again = await run(copyObjects(items, load, { dryRun: false }), r2.fetchFn)
    expect((again as any).success[0].status).toBe('exists')

    const rec = await run(
      reconcileObjects([...items, { storageId: 'b', meta: meta('b', 3) }, { storageId: 'c', meta: meta('a', 9) }], {}),
      r2.fetchFn,
    )
    expect((rec as any).success.map((x: any) => x.status)).toEqual(['ok', 'missing_in_convex', 'missing_in_r2', 'missing_in_r2'])
  })

  test('one failing file is reported, the batch continues', async () => {
    const r2 = fakeR2(['403'])
    const items = [
      { storageId: 'a', meta: meta('a', 5) },
      { storageId: 'b', meta: meta('b', 5) },
    ]
    const r = await run(copyObjects(items, async () => new Blob(['hello']), { dryRun: false }), r2.fetchFn)
    expect((r as any).success.map((x: any) => x.status)).toEqual(['error', 'copied'])
  })

  test('the actions are a no-op without R2 env vars', async () => {
    const t = convexTest(schema, modules)
    const id = await t.run((ctx) => ctx.storage.store(new Blob(['x'])))
    expect(await t.action(internal.r2Sync.copyToR2, { storageIds: [id], dryRun: false })).toMatchObject({
      configured: false,
      results: [],
    })
    expect(await t.action(internal.r2Sync.reconcileR2, { storageIds: [id] })).toMatchObject({ configured: false })
    const metas = await t.query(internal.r2Sync.storageMeta, { storageIds: [id] })
    expect(metas[0]).toMatchObject({ size: 1 })
  })
})
