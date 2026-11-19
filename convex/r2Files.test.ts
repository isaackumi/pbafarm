/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import schema from './schema'
import { api, internal } from './_generated/api'
import { fetchLayer, type FetchFn } from './lib/effectHttp'
import { R2Storage, r2Layer, type R2Config } from './lib/r2'
import { filesProvider, inspectUpload, presignDownload, presignUpload, r2UploadKey } from './lib/r2Files'

/** R2 behind the `files` table (CF-005/CF-006), with an in-memory S3 behind a fake fetch. */
const modules = import.meta.glob('./**/*.ts')

const config: R2Config = { accountId: 'acct', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'pba-files' }
const R2_ENV = { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'AK', R2_SECRET_ACCESS_KEY: 'SK', R2_BUCKET: 'pba-files' }

type Stored = { bytes: Uint8Array; sha256?: string; contentType?: string }

/** In-memory S3: refuses unsigned requests, honours If-None-Match: * on PUT, supports DELETE. */
function fakeR2() {
  const objects = new Map<string, Stored>()
  const calls: Array<{ method: string; path: string }> = []
  const fetchFn: FetchFn = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const key = decodeURIComponent(url.pathname)
    calls.push({ method, path: key })
    if (!url.searchParams.get('X-Amz-Signature')) return new Response('unsigned', { status: 403 })
    const headers = new Headers(init?.headers)
    if (method === 'PUT') {
      if (headers.get('if-none-match') === '*' && objects.has(key)) return new Response(null, { status: 412 })
      const bytes = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer())
      objects.set(key, {
        bytes,
        sha256: headers.get('x-amz-meta-sha256') ?? undefined,
        contentType: headers.get('content-type') ?? undefined,
      })
      return new Response(null, { status: 200, headers: { etag: '"e1"' } })
    }
    if (method === 'DELETE') {
      objects.delete(key)
      return new Response(null, { status: 204 })
    }
    const obj = objects.get(key)
    if (!obj) return new Response(null, { status: 404 })
    const h: Record<string, string> = { 'content-length': String(obj.bytes.length), etag: '"e1"' }
    if (obj.sha256) h['x-amz-meta-sha256'] = obj.sha256
    if (obj.contentType) h['content-type'] = obj.contentType
    if (method === 'HEAD') return new Response(null, { status: 200, headers: h })
    return new Response(obj.bytes as BodyInit, { status: 200, headers: h })
  }
  return { objects, calls, fetchFn }
}

const bytesOf = (size: number, fill = 7) => new Uint8Array(size).fill(fill)
const hexSha = async (b: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (x) => x.toString(16).padStart(2, '0')).join('')

const run = <A, E>(program: Effect.Effect<A, E, R2Storage>, fetchFn: FetchFn) =>
  Effect.runPromise(
    Effect.result(
      program.pipe(
        Effect.provide(
          r2Layer(config, { policy: { timeoutMs: 200, retries: 0, retryBaseDelayMs: 1 } }).pipe(
            Layer.provide(fetchLayer(fetchFn)),
          ),
        ),
      ),
    ),
  )

describe('R2 file programs', () => {
  test('provider is r2 only when configured, and FILES_PROVIDER=convex wins', () => {
    expect(filesProvider({})).toBe('convex')
    expect(filesProvider(R2_ENV)).toBe('r2')
    expect(filesProvider({ ...R2_ENV, FILES_PROVIDER: 'convex' })).toBe('convex')
  })

  test('presigned PUT creates once, then inspectUpload checks size and hash', async () => {
    const r2 = fakeR2()
    const b = bytesOf(100)
    const sha256 = await hexSha(b)
    const key = r2UploadKey('co1', 'up1')
    const signed = await run(presignUpload({ key, contentType: 'application/pdf', sha256 }), r2.fetchFn)
    if (signed._tag !== 'Success') throw new Error('presign failed')
    const url = new URL(signed.success.url)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('if-none-match')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('x-amz-meta-sha256')
    const put = () => r2.fetchFn(signed.success.url, { method: 'PUT', headers: signed.success.headers, body: b as BodyInit })
    expect((await put()).status).toBe(200)
    // The URL cannot overwrite the object afterwards.
    expect((await put()).status).toBe(412)

    const ok = await run(inspectUpload({ key, sha256, maxBytes: 1000 }), r2.fetchFn)
    expect(ok).toMatchObject({ _tag: 'Success', success: { size: 100 } })
    const tooBig = await run(inspectUpload({ key, sha256, maxBytes: 50 }), r2.fetchFn)
    expect(tooBig).toMatchObject({ _tag: 'Failure', failure: { _tag: 'R2UploadRejected', reason: 'too_large' } })
    const wrong = await run(inspectUpload({ key, sha256: 'f'.repeat(64), maxBytes: 1000 }), r2.fetchFn)
    expect(wrong).toMatchObject({ _tag: 'Failure', failure: { reason: 'hash_mismatch' } })
    const missing = await run(inspectUpload({ key: 'files/none', sha256, maxBytes: 1000 }), r2.fetchFn)
    expect(missing).toMatchObject({ _tag: 'Failure', failure: { reason: 'missing' } })
  })

  test('presigned GET forces attachment and the recorded type', async () => {
    const r2 = fakeR2()
    const out = await run(presignDownload({ key: 'files/a/b', name: 'Vet "report".pdf', mime: 'application/pdf' }), r2.fetchFn)
    if (out._tag !== 'Success') throw new Error('presign failed')
    const url = new URL(out.success)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf')
    expect(url.searchParams.get('response-content-disposition')).toMatch(/^attachment; filename="Vet _report_.pdf"/)
    expect(r2.calls).toEqual([])
  })
})

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: Date.now() })
    const otherCompanyId = await ctx.db.insert('companies', { name: 'Other', code: 'OTH', status: 'approved', createdAt: Date.now() })
    const siteId = await ctx.db.insert('farmLocations', { companyId, name: 'Kpeve', active: true, updatedAt: Date.now() })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId })
    const staff2Id = await ctx.db.insert('users', { email: 's2@x.com', role: 'user', companyId })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompanyId })
    const cageId = await ctx.db.insert('cages', { name: 'C1', status: 'active', currentCount: 100, companyId, locationId: siteId, updatedAt: Date.now() })
    const treatmentId = await ctx.db.insert('healthTreatments', {
      cageId,
      date: '2026-11-01',
      treatment: 'Salt bath',
      companyId,
      locationId: siteId,
      updatedAt: Date.now(),
    })
    return { companyId, treatmentId, staffId, staff2Id, outsiderId }
  })
  return {
    t,
    ids,
    ref: { entityType: 'healthTreatments' as const, entityId: ids.treatmentId },
    asStaff: t.withIdentity({ subject: `${ids.staffId}|s` }),
    asStaff2: t.withIdentity({ subject: `${ids.staff2Id}|s` }),
    asOutsider: t.withIdentity({ subject: `${ids.outsiderId}|s` }),
  }
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    const raw = (e as { data?: unknown }).data
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { code?: string } | undefined
    if (data?.code) return data.code
    // Errors thrown from inside actions arrive with the ConvexError data as the message.
    const msg = String((e as Error).message)
    return msg.match(/"code":"([A-Z_]+)"/)?.[1] ?? msg
  }
  throw new Error('expected a rejection')
}

describe('files on R2 (CF-005)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  function useR2() {
    for (const [k, val] of Object.entries(R2_ENV)) vi.stubEnv(k, val)
    const r2 = fakeR2()
    vi.stubGlobal('fetch', r2.fetchFn)
    return r2
  }

  test('without R2 env, uploads stay on Convex storage', async () => {
    const { asStaff, ref } = await setup()
    const out = await asStaff.mutation(api.files.generateUploadUrl, { ...ref, sha256: await hexSha(bytesOf(10)) })
    expect(out).toMatchObject({ provider: 'convex', method: 'POST', headers: {} })
  })

  test('upload to R2, attach, and download through a presigned redirect', async () => {
    const r2 = useR2()
    const { t, ids, ref, asStaff, asOutsider } = await setup()
    const b = bytesOf(1000)
    const target = await asStaff.mutation(api.files.generateUploadUrl, {
      ...ref,
      sha256: await hexSha(b),
      contentType: 'application/pdf',
      name: 'Vet report.pdf',
    })
    expect(target).toMatchObject({ provider: 'r2', method: 'PUT' })
    const key = r2UploadKey(ids.companyId, target.uploadId)
    expect(decodeURIComponent(new URL(target.uploadUrl).pathname)).toContain(key)
    expect((await r2.fetchFn(target.uploadUrl, { method: 'PUT', headers: target.headers, body: b as BodyInit })).status).toBe(200)

    // Another company cannot claim the upload.
    expect(
      await codeOf(asOutsider.action(api.files.attachR2, { ...ref, uploadId: target.uploadId, name: 'x.pdf' })),
    ).toMatch(/NOT_FOUND|not found/)

    const attached = await asStaff.action(api.files.attachR2, { ...ref, uploadId: target.uploadId, name: 'Vet report.pdf' })
    if (!attached.ok) throw new Error(attached.message)
    const row = await t.run((ctx) => ctx.db.get(attached.id))
    expect(row).toMatchObject({ provider: 'r2', r2Key: key, size: 1000, mime: 'application/pdf' })
    expect(row?.storageId).toBeUndefined()
    // The binding is spent.
    expect(
      await codeOf(asStaff.action(api.files.attachR2, { ...ref, uploadId: target.uploadId, name: 'again.pdf' })),
    ).toBe('NOT_FOUND')

    await expect(asOutsider.mutation(api.files.requestDownload, { fileId: attached.id })).rejects.toThrow(/not found/i)
    const { path } = await asStaff.mutation(api.files.requestDownload, { fileId: attached.id })
    const res = await t.fetch(path, { method: 'GET', redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    const location = new URL(res.headers.get('Location') ?? '')
    expect(decodeURIComponent(location.pathname)).toContain(key)
    expect(location.searchParams.get('response-content-disposition')).toContain('Vet report.pdf')
    const got = await r2.fetchFn(location.toString(), { method: 'GET' })
    expect((await got.arrayBuffer()).byteLength).toBe(1000)
  })

  test('another user of the same company, wrong bytes and expired bindings are refused', async () => {
    const r2 = useR2()
    const { t, ref, asStaff, asStaff2 } = await setup()
    const b = bytesOf(500)
    const target = await asStaff.mutation(api.files.generateUploadUrl, {
      ...ref,
      sha256: await hexSha(b),
      contentType: 'image/png',
      name: 'p.png',
    })
    expect(
      await codeOf(asStaff2.action(api.files.attachR2, { ...ref, uploadId: target.uploadId, name: 'p.png' })),
    ).toBe('NOT_FOUND')

    // Bytes that do not hash to the declared SHA-256 are refused and deleted.
    const other = bytesOf(500, 9)
    await r2.fetchFn(target.uploadUrl, { method: 'PUT', headers: target.headers, body: other as BodyInit })
    expect(r2.objects.size).toBe(1)
    expect(await codeOf(asStaff.action(api.files.attachR2, { ...ref, uploadId: target.uploadId, name: 'p.png' }))).toBe(
      'NOT_FOUND',
    )
    expect(r2.objects.size).toBe(0)

    const late = await asStaff.mutation(api.files.generateUploadUrl, {
      ...ref,
      sha256: await hexSha(b),
      contentType: 'image/png',
      name: 'p.png',
    })
    await r2.fetchFn(late.uploadUrl, { method: 'PUT', headers: late.headers, body: b as BodyInit })
    await t.run((ctx) => ctx.db.patch(late.uploadId, { expiresAt: Date.now() - 1 }))
    expect(await codeOf(asStaff.action(api.files.attachR2, { ...ref, uploadId: late.uploadId, name: 'p.png' }))).toBe(
      'NOT_FOUND',
    )
    // Pruning drops the expired binding and schedules the orphan's deletion.
    vi.useFakeTimers()
    try {
      await t.mutation(internal.files.pruneDownloadTokens, {})
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    } finally {
      vi.useRealTimers()
    }
    expect(r2.objects.size).toBe(0)
  })

  test('unclaimed objects are deleted when the claim window ends; removal deletes again after the PUT URL expires', async () => {
    const r2 = useR2()
    const { t, ref, asStaff } = await setup()
    const b = bytesOf(300)
    vi.useFakeTimers()
    try {
      const put = async () => {
        const target = await asStaff.mutation(api.files.generateUploadUrl, {
          ...ref,
          sha256: await hexSha(b),
          contentType: 'image/png',
          name: 'p.png',
        })
        await r2.fetchFn(target.uploadUrl, { method: 'PUT', headers: target.headers, body: b as BodyInit })
        return target
      }
      await put()
      const kept = await put()
      const attached = await asStaff.action(api.files.attachR2, { ...ref, uploadId: kept.uploadId, name: 'p.png' })
      if (!attached.ok) throw new Error(attached.message)
      expect(r2.objects.size).toBe(2)
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      // The unclaimed one is gone; the attached one stays.
      expect(r2.objects.size).toBe(1)

      await asStaff.mutation(api.files.remove, { fileId: attached.id })
      vi.advanceTimersByTime(1)
      await t.finishInProgressScheduledFunctions()
      expect(r2.objects.size).toBe(0)
      // Re-upload on the still-valid URL after the first delete…
      await r2.fetchFn(kept.uploadUrl, { method: 'PUT', headers: kept.headers, body: b as BodyInit })
      expect(r2.objects.size).toBe(1)
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      // …is removed by the delayed second delete.
      expect(r2.objects.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('upload URLs are rate limited per user', async () => {
    const { asStaff, ref } = await setup()
    const sha256 = await hexSha(bytesOf(10))
    for (let i = 0; i < 40; i++) await asStaff.mutation(api.files.generateUploadUrl, { ...ref, sha256 })
    expect(await codeOf(asStaff.mutation(api.files.generateUploadUrl, { ...ref, sha256 }))).toBe('RATE_LIMITED')
  })

  test('types outside the allow-list are refused before any URL is signed', async () => {
    useR2()
    const { ref, asStaff } = await setup()
    expect(
      await codeOf(
        asStaff.mutation(api.files.generateUploadUrl, {
          ...ref,
          sha256: await hexSha(bytesOf(5)),
          contentType: 'application/x-msdownload',
          name: 'x.exe',
        }),
      ),
    ).toBe('VALIDATION')
  })

  test('backfill copies Convex files to R2 and switches verified rows (dry run by default)', async () => {
    const r2 = useR2()
    const { t, ids, ref } = await setup()
    const fileId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([bytesOf(300)], { type: 'application/pdf' }))
      return ctx.db.insert('files', {
        companyId: ids.companyId,
        ...ref,
        provider: 'convex',
        storageId,
        name: 'old.pdf',
        mime: 'application/pdf',
        size: 300,
        uploadedBy: ids.staffId,
        createdAt: Date.now(),
      })
    })
    const dry = await t.action(internal.r2Sync.backfillFilesToR2, {})
    expect(dry).toMatchObject({ configured: true, dryRun: true, copied: { would_copy: 1 }, marked: 0, isDone: true })
    expect(r2.objects.size).toBe(0)

    const real = await t.action(internal.r2Sync.backfillFilesToR2, { dryRun: false })
    expect(real).toMatchObject({ copied: { copied: 1 }, reconciled: { ok: 1 }, marked: 1 })
    const row = await t.run((ctx) => ctx.db.get(fileId))
    expect(row).toMatchObject({ provider: 'r2', r2Key: `files/${row?.storageId}` })
    // Second pass finds nothing left on Convex.
    expect(await t.action(internal.r2Sync.backfillFilesToR2, { dryRun: false })).toMatchObject({ marked: 0 })
  })
})
