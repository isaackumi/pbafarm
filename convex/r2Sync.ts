/**
 * Copy Convex-stored files to R2 and reconcile the two (CF-006).
 *
 * Internal actions that take Convex storage ids, so they work on whatever
 * table records the files (today convex/files.ts; CF-004 adds the `files`
 * table). Nothing schedules them yet: an operator (or, once wired, a driver
 * that pages through `files`) calls them in batches of at most 100 ids.
 *   npx convex run r2Sync:copyToR2 '{"storageIds":["…"],"dryRun":true}'
 *   npx convex run r2Sync:reconcileR2 '{"storageIds":["…"]}'
 *
 * Without the R2_* env vars both return `configured: false` and do nothing.
 * Object key = `files/<storageId>` (r2KeyFor); the SHA-256 Convex computed on
 * upload is stored as x-amz-meta-sha256 so reconciliation can compare content
 * without downloading. Copy is idempotent: an object already present with the
 * same size and hash is skipped. Convex storage is never modified.
 */
import { v } from 'convex/values'
import * as Effect from 'effect/Effect'
import { internalAction, internalQuery } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { runEffect } from './lib/effect'
import { withErrorReporting } from './lib/monitoring'
import { R2Storage, type R2StorageApi, r2KeyFor, r2Live } from './lib/r2'

const MAX_IDS = 100

const isConfigured = Effect.gen(function* () {
  return (yield* R2Storage).configured
})

type StorageMeta = {
  storageId: Id<'_storage'>
  size: number
  sha256: string
  contentType: string | null
}

const storageMetaValidator = v.object({
  storageId: v.id('_storage'),
  size: v.number(),
  sha256: v.string(),
  contentType: v.union(v.string(), v.null()),
})

/** Size, hash and type of each stored file (null when it no longer exists). */
export const storageMeta = internalQuery({
  args: { storageIds: v.array(v.id('_storage')) },
  returns: v.array(v.union(storageMetaValidator, v.null())),
  handler: async (ctx, { storageIds }) => {
    const out: Array<StorageMeta | null> = []
    for (const storageId of storageIds.slice(0, MAX_IDS)) {
      const meta = await ctx.db.system.get(storageId)
      out.push(
        meta
          ? { storageId, size: meta.size, sha256: meta.sha256, contentType: meta.contentType ?? null }
          : null,
      )
    }
    return out
  },
})

/** Convex's `_storage.sha256` is base64; R2 metadata holds hex. */
export function base64ToHex(b64: string): string {
  if (/^[0-9a-f]{64}$/i.test(b64)) return b64.toLowerCase()
  const bin = atob(b64)
  let hex = ''
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0')
  return hex
}

export type CopyStatus = 'copied' | 'would_copy' | 'exists' | 'missing_in_convex' | 'error'
export type CopyResult = { storageId: string; key: string; status: CopyStatus; bytes: number; error?: string }

/** Copy logic, separate from the action for tests. `load` reads the Convex bytes. */
export function copyObjects(
  items: Array<{ storageId: string; meta: StorageMeta | null }>,
  load: (storageId: string) => Promise<Blob | null>,
  opts: { dryRun: boolean; keyPrefix?: string },
): Effect.Effect<CopyResult[], never, R2Storage> {
  return Effect.gen(function* () {
    const r2: R2StorageApi = yield* R2Storage
    const results: CopyResult[] = []
    for (const { storageId, meta } of items) {
      const key = r2KeyFor(storageId, opts.keyPrefix)
      if (!meta) {
        results.push({ storageId, key, status: 'missing_in_convex', bytes: 0 })
        continue
      }
      const sha256 = base64ToHex(meta.sha256)
      const one = Effect.gen(function* () {
        const existing = yield* r2.head(key)
        if (existing && existing.size === meta.size && (!existing.sha256 || existing.sha256 === sha256)) {
          return { storageId, key, status: 'exists' as const, bytes: meta.size }
        }
        if (opts.dryRun) return { storageId, key, status: 'would_copy' as const, bytes: meta.size }
        const blob = yield* Effect.promise(() => load(storageId))
        if (!blob) return { storageId, key, status: 'missing_in_convex' as const, bytes: 0 }
        yield* r2.put(key, blob, { contentType: meta.contentType ?? undefined, sha256 })
        return { storageId, key, status: 'copied' as const, bytes: meta.size }
      })
      // One bad file must not stop the batch.
      results.push(
        yield* one.pipe(
          Effect.catch((e) => Effect.succeed({ storageId, key, status: 'error' as const, bytes: 0, error: e.message })),
        ),
      )
    }
    return results
  })
}

export type ReconcileStatus = 'ok' | 'missing_in_r2' | 'size_mismatch' | 'hash_mismatch' | 'missing_in_convex' | 'error'
export type ReconcileResult = { storageId: string; key: string; status: ReconcileStatus; error?: string }

export function reconcileObjects(
  items: Array<{ storageId: string; meta: StorageMeta | null }>,
  opts: { keyPrefix?: string },
): Effect.Effect<ReconcileResult[], never, R2Storage> {
  return Effect.gen(function* () {
    const r2: R2StorageApi = yield* R2Storage
    const results: ReconcileResult[] = []
    for (const { storageId, meta } of items) {
      const key = r2KeyFor(storageId, opts.keyPrefix)
      if (!meta) {
        results.push({ storageId, key, status: 'missing_in_convex' })
        continue
      }
      const one = Effect.gen(function* () {
        const obj = yield* r2.head(key)
        if (!obj) return { storageId, key, status: 'missing_in_r2' as const }
        if (obj.size !== meta.size) return { storageId, key, status: 'size_mismatch' as const }
        if (obj.sha256 && obj.sha256 !== base64ToHex(meta.sha256)) return { storageId, key, status: 'hash_mismatch' as const }
        return { storageId, key, status: 'ok' as const }
      })
      results.push(
        yield* one.pipe(Effect.catch((e) => Effect.succeed({ storageId, key, status: 'error' as const, error: e.message }))),
      )
    }
    return results
  })
}

function countBy<T extends { status: string }>(rows: T[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1
  return out
}

const resultValidator = v.object({
  storageId: v.string(),
  key: v.string(),
  status: v.string(),
  bytes: v.optional(v.number()),
  error: v.optional(v.string()),
})

export const copyToR2 = internalAction({
  args: {
    storageIds: v.array(v.id('_storage')),
    keyPrefix: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    configured: v.boolean(),
    dryRun: v.boolean(),
    counts: v.record(v.string(), v.number()),
    results: v.array(resultValidator),
  }),
  handler: (ctx, args) => withErrorReporting('r2Sync:copyToR2', async () => {
    const dryRun = args.dryRun !== false
    if (args.storageIds.length > MAX_IDS) throw new Error(`At most ${MAX_IDS} storage ids per call`)
    const layer = r2Live()
    const configured = await runEffect(isConfigured.pipe(Effect.provide(layer)))
    if (!configured) return { configured: false, dryRun, counts: {}, results: [] }
    const metas: Array<StorageMeta | null> = await ctx.runQuery(internal.r2Sync.storageMeta, { storageIds: args.storageIds })
    const items = args.storageIds.map((storageId, i) => ({ storageId, meta: metas[i] }))
    const results = await runEffect(
      copyObjects(items, (id) => ctx.storage.get(id as Id<'_storage'>), { dryRun, keyPrefix: args.keyPrefix }).pipe(
        Effect.provide(layer),
      ),
    )
    return { configured: true, dryRun, counts: countBy(results), results }
  }),
})

export const reconcileR2 = internalAction({
  args: {
    storageIds: v.array(v.id('_storage')),
    keyPrefix: v.optional(v.string()),
  },
  returns: v.object({
    configured: v.boolean(),
    counts: v.record(v.string(), v.number()),
    results: v.array(resultValidator),
  }),
  handler: (ctx, args) => withErrorReporting('r2Sync:reconcileR2', async () => {
    if (args.storageIds.length > MAX_IDS) throw new Error(`At most ${MAX_IDS} storage ids per call`)
    const layer = r2Live()
    const configured = await runEffect(isConfigured.pipe(Effect.provide(layer)))
    if (!configured) return { configured: false, counts: {}, results: [] }
    const metas: Array<StorageMeta | null> = await ctx.runQuery(internal.r2Sync.storageMeta, { storageIds: args.storageIds })
    const items = args.storageIds.map((storageId, i) => ({ storageId, meta: metas[i] }))
    const results = await runEffect(reconcileObjects(items, { keyPrefix: args.keyPrefix }).pipe(Effect.provide(layer)))
    return { configured: true, counts: countBy(results), results }
  }),
})
