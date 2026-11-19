/**
 * R2 behind the `files` table (CF-005): the Effect programs convex/files.ts
 * runs when the R2_* env vars are set. Pure of Convex ctx so they can be
 * tested with `r2Layer(config)` + `fetchLayer(fake)`.
 *
 * - Upload: `presignUpload` returns a short-lived PUT URL for a server-chosen
 *   key `files/<companyId>/<uploadId>`, with Content-Type, the declared
 *   SHA-256 (x-amz-meta-sha256) and `If-None-Match: *` signed in, so the URL
 *   can create the object once and never overwrite it after attach.
 * - Attach: `inspectUpload` HEADs the object (exists, ≤ max bytes), then
 *   downloads it and checks the bytes hash to the SHA-256 declared with the
 *   upload binding: R2's metadata is what the client sent, not proof.
 * - Download: `presignDownload` returns a GET URL valid 5 minutes that
 *   forces `Content-Disposition: attachment` and the recorded type.
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import { R2Storage, r2ConfigFromEnv, type R2Error, type R2NotConfigured } from './r2'

export type FilesProvider = 'convex' | 'r2'

/** Uploads go to R2 when it is configured, unless FILES_PROVIDER=convex. */
export function filesProvider(env: Record<string, string | undefined> = process.env): FilesProvider {
  if (env.FILES_PROVIDER?.trim().toLowerCase() === 'convex') return 'convex'
  return r2ConfigFromEnv(env) ? 'r2' : 'convex'
}

export const R2_UPLOAD_TTL_SEC = 15 * 60
export const R2_DOWNLOAD_TTL_SEC = 5 * 60

export function r2UploadKey(companyId: string, uploadId: string): string {
  return `files/${companyId}/${uploadId}`
}

/** The thumbnail object next to an upload (CF-004). */
export function r2ThumbKey(companyId: string, uploadId: string): string {
  return `${r2UploadKey(companyId, uploadId)}.thumb`
}

/** The upload is missing, too large, or not the declared bytes. */
export class R2UploadRejected extends Data.TaggedError('R2UploadRejected')<{
  readonly reason: 'missing' | 'too_large' | 'hash_mismatch'
  readonly message: string
}> {}

type R2Failure = R2Error | R2NotConfigured

export function presignUpload(input: {
  key: string
  contentType: string
  sha256: string
}): Effect.Effect<{ url: string; headers: Record<string, string> }, R2Failure, R2Storage> {
  return Effect.gen(function* () {
    const r2 = yield* R2Storage
    const url = yield* r2.presign('PUT', input.key, R2_UPLOAD_TTL_SEC, {
      contentType: input.contentType,
      sha256: input.sha256,
      createOnly: true,
    })
    return {
      url,
      headers: { 'Content-Type': input.contentType, 'x-amz-meta-sha256': input.sha256, 'If-None-Match': '*' },
    }
  })
}

async function hexSha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Size and type of an uploaded object whose bytes match `sha256`. */
export function inspectUpload(input: {
  key: string
  sha256: string
  maxBytes: number
}): Effect.Effect<{ size: number; contentType?: string }, R2UploadRejected | R2Failure, R2Storage> {
  return Effect.gen(function* () {
    const r2 = yield* R2Storage
    const head = yield* r2.head(input.key)
    if (!head) return yield* new R2UploadRejected({ reason: 'missing', message: 'File not found. Upload it again.' })
    if (head.size > input.maxBytes) {
      return yield* new R2UploadRejected({ reason: 'too_large', message: 'Files can be at most 10 MB' })
    }
    const blob = yield* r2.get(input.key)
    if (!blob) return yield* new R2UploadRejected({ reason: 'missing', message: 'File not found. Upload it again.' })
    if (blob.size > input.maxBytes) {
      return yield* new R2UploadRejected({ reason: 'too_large', message: 'Files can be at most 10 MB' })
    }
    const actual = yield* Effect.promise(() => hexSha256(blob))
    if (actual !== input.sha256.toLowerCase()) {
      return yield* new R2UploadRejected({ reason: 'hash_mismatch', message: 'File not found. Upload it again.' })
    }
    return { size: blob.size, contentType: head.contentType }
  })
}

export function contentDisposition(name: string): string {
  const safeName = name.replace(/["\\\r\n]/g, '_')
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export function presignDownload(input: {
  key: string
  name: string
  mime: string
}): Effect.Effect<string, R2Failure, R2Storage> {
  return Effect.gen(function* () {
    const r2 = yield* R2Storage
    return yield* r2.presign('GET', input.key, R2_DOWNLOAD_TTL_SEC, {
      responseContentType: input.mime,
      responseContentDisposition: contentDisposition(input.name),
    })
  })
}
