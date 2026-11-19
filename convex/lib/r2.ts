/**
 * Cloudflare R2 storage provider (CF-005, D-016), as an Effect service.
 *
 * R2 speaks the S3 API. Every request here is a SigV4 *presigned* URL
 * (query-string auth, `UNSIGNED-PAYLOAD`), signed with Web Crypto, so there is
 * no AWS SDK dependency and the same signer can hand a browser a short-lived
 * PUT/GET URL later. Region is always `auto` for R2.
 *
 * Env-gated: without all of R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY and R2_BUCKET the service reports `configured: false`
 * and every operation fails with `R2NotConfigured`; callers treat that as a
 * no-op. R2_ENDPOINT optionally overrides the endpoint origin (EU
 * jurisdiction: https://<account>.eu.r2.cloudflarestorage.com).
 *
 * Wired behind the `files` table (convex/files.ts, CF-005): with the env set,
 * new uploads are presigned PUTs and downloads redirect to presigned GETs.
 * See docs/ops/r2-storage.md.
 *
 * Network goes through the `Fetch` service (tests inject `fetchLayer(fake)`).
 * Each attempt has a timeout; network errors, timeouts and 5xx are retried
 * (PUT/GET/HEAD of one key are idempotent), 4xx never.
 */
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schedule from 'effect/Schedule'
import { Fetch, FetchLive, type FetchFn } from './effectHttp'

export type R2Config = {
  readonly accountId: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly bucket: string
  /** Endpoint origin; default https://<accountId>.r2.cloudflarestorage.com */
  readonly endpoint?: string
}

export const R2_ENV = {
  accountId: 'R2_ACCOUNT_ID',
  accessKeyId: 'R2_ACCESS_KEY_ID',
  secretAccessKey: 'R2_SECRET_ACCESS_KEY',
  bucket: 'R2_BUCKET',
  endpoint: 'R2_ENDPOINT',
} as const

/** The R2 config from env, or null when any required variable is unset. */
export function r2ConfigFromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const accountId = env[R2_ENV.accountId]?.trim()
  const accessKeyId = env[R2_ENV.accessKeyId]?.trim()
  const secretAccessKey = env[R2_ENV.secretAccessKey]?.trim()
  const bucket = env[R2_ENV.bucket]?.trim()
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  const endpoint = env[R2_ENV.endpoint]?.trim() || undefined
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint }
}

export class R2NotConfigured extends Data.TaggedError('R2NotConfigured')<{
  readonly message: string
}> {}

export class R2Error extends Data.TaggedError('R2Error')<{
  readonly operation: 'put' | 'get' | 'head' | 'delete' | 'presign'
  readonly key: string
  /** HTTP status, absent for network errors and timeouts. */
  readonly status?: number
  readonly retryable: boolean
  readonly message: string
}> {}

// ---------------------------------------------------------------------------
// SigV4 presigning (https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html)

const enc = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)))
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(data))
}

/** RFC 3986 encoding as S3 expects (encodeURIComponent leaves !'()* alone). */
export function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function amzDates(now: Date) {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

export type PresignInput = {
  readonly method: 'GET' | 'PUT' | 'HEAD' | 'DELETE'
  /** Origin, e.g. https://acct.r2.cloudflarestorage.com */
  readonly origin: string
  /** Already split path segments are encoded here; pass the raw path ("/bucket/key"). */
  readonly path: string
  readonly region: string
  readonly service?: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly expiresSec: number
  readonly now: Date
  /** Extra headers the request will send and that are part of the signature. */
  readonly headers?: Record<string, string>
  /** Extra signed query parameters (e.g. response-content-disposition on GET). */
  readonly query?: Record<string, string>
}

export async function presignS3Url(o: PresignInput): Promise<string> {
  const service = o.service ?? 's3'
  const url = new URL(o.origin)
  const host = url.host
  const canonicalUri = o.path
    .split('/')
    .map((seg) => uriEncode(seg))
    .join('/')
  const { amzDate, dateStamp } = amzDates(o.now)
  const scope = `${dateStamp}/${o.region}/${service}/aws4_request`

  const headers: Record<string, string> = { host }
  for (const [k, val] of Object.entries(o.headers ?? {})) headers[k.toLowerCase()] = val.trim()
  const headerNames = Object.keys(headers).sort()
  const signedHeaders = headerNames.join(';')
  const canonicalHeaders = headerNames.map((h) => `${h}:${headers[h]}\n`).join('')

  const query: Record<string, string> = {
    ...(o.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${o.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.max(1, Math.min(604800, Math.floor(o.expiresSec)))),
    'X-Amz-SignedHeaders': signedHeaders,
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join('&')

  const canonicalRequest = [o.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')

  let key: ArrayBuffer = await hmac(enc.encode(`AWS4${o.secretAccessKey}`), dateStamp)
  key = await hmac(key, o.region)
  key = await hmac(key, service)
  key = await hmac(key, 'aws4_request')
  const signature = toHex(await hmac(key, stringToSign))

  return `${url.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

// ---------------------------------------------------------------------------
// Service

export type R2ObjectInfo = {
  readonly size: number
  readonly etag?: string
  /** Hex SHA-256 stored as x-amz-meta-sha256 when the object was put by `put`. */
  readonly sha256?: string
  readonly contentType?: string
}

export type R2PutOptions = {
  readonly contentType?: string
  /** Hex SHA-256 of the body, stored as object metadata for reconciliation. */
  readonly sha256?: string
}

export type R2PresignOptions = R2PutOptions & {
  /** GET only: headers R2 sets on the response (signed query parameters). */
  readonly responseContentType?: string
  readonly responseContentDisposition?: string
  /** PUT only: sign `If-None-Match: *` so the URL can create the object but never overwrite it. */
  readonly createOnly?: boolean
}

type R2Failure = R2Error | R2NotConfigured

export interface R2StorageApi {
  readonly configured: boolean
  readonly put: (key: string, body: Blob | ArrayBuffer | Uint8Array, opts?: R2PutOptions) => Effect.Effect<{ etag?: string }, R2Failure>
  /** The object's bytes, or null when it does not exist. */
  readonly get: (key: string) => Effect.Effect<Blob | null, R2Failure>
  /** Size/etag/sha256 of the object, or null when it does not exist. */
  readonly head: (key: string) => Effect.Effect<R2ObjectInfo | null, R2Failure>
  /** Delete the object (a missing object is not an error). */
  readonly remove: (key: string) => Effect.Effect<void, R2Failure>
  /**
   * A presigned URL a client can GET or PUT directly (default 5 minutes). For
   * PUT, `contentType` and `sha256` are signed: the client must send exactly
   * `Content-Type` and `x-amz-meta-sha256` with those values.
   */
  readonly presign: (method: 'GET' | 'PUT', key: string, ttlSec?: number, opts?: R2PresignOptions) => Effect.Effect<string, R2Failure>
}

export class R2Storage extends Context.Service<R2Storage, R2StorageApi>()('anowa/R2Storage') {}

export type R2Policy = {
  readonly timeoutMs?: number
  readonly retries?: number
  readonly retryBaseDelayMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRIES = 2
const DEFAULT_PRESIGN_TTL_SEC = 300

function objectUrlParts(config: R2Config, key: string) {
  const origin = (config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '')
  return { origin, path: `/${config.bucket}/${key}` }
}

function metaHeaders(opts?: R2PutOptions): Record<string, string> {
  return opts?.sha256 ? { 'x-amz-meta-sha256': opts.sha256 } : {}
}

/** Build the service for one config (null = not configured) and fetch implementation. */
export function makeR2Storage(
  config: R2Config | null,
  fetchFn: FetchFn,
  options: { now?: () => Date; policy?: R2Policy } = {},
): R2StorageApi {
  const now = options.now ?? (() => new Date())
  const timeoutMs = options.policy?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = options.policy?.retries ?? DEFAULT_RETRIES
  const baseDelay = options.policy?.retryBaseDelayMs ?? 300
  const notConfigured = Effect.fail(
    new R2NotConfigured({ message: 'R2 is not configured (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)' }),
  )

  const presign = (
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
    key: string,
    ttlSec: number,
    headers: Record<string, string>,
    query?: Record<string, string>,
  ): Effect.Effect<string, R2Failure> => {
    if (!config) return notConfigured
    const { origin, path } = objectUrlParts(config, key)
    return Effect.tryPromise({
      try: () =>
        presignS3Url({
          method,
          origin,
          path,
          region: 'auto',
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          expiresSec: ttlSec,
          now: now(),
          headers,
          query,
        }),
      catch: (cause) =>
        new R2Error({ operation: 'presign', key, retryable: false, message: `Could not sign R2 URL: ${String(cause)}` }),
    })
  }

  /** One request with timeout + retry of transient failures. 404 is returned, not failed. */
  const send = (
    operation: 'put' | 'get' | 'head' | 'delete',
    key: string,
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
    init: { body?: BodyInit; headers?: Record<string, string> },
  ): Effect.Effect<Response, R2Failure> =>
    Effect.gen(function* () {
      const signed = yield* presign(method, key, DEFAULT_PRESIGN_TTL_SEC, metaFrom(init.headers))
      const once = Effect.tryPromise({
        try: (signal) => fetchFn(signed, { method, body: init.body, headers: init.headers, signal }),
        catch: (cause) =>
          new R2Error({ operation, key, retryable: true, message: `R2 ${operation} ${key} failed: ${String((cause as Error)?.message ?? cause)}` }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(timeoutMs),
          orElse: () =>
            Effect.fail(new R2Error({ operation, key, retryable: true, message: `R2 ${operation} ${key} timed out after ${timeoutMs} ms` })),
        }),
        Effect.flatMap((res) => {
          if (res.ok || res.status === 404) return Effect.succeed(res)
          return Effect.fail(
            new R2Error({
              operation,
              key,
              status: res.status,
              retryable: res.status >= 500,
              message: `R2 ${operation} ${key} failed (${res.status})`,
            }),
          )
        }),
      )
      if (retries <= 0) return yield* once
      return yield* once.pipe(
        Effect.retry({
          schedule: Schedule.exponential(Duration.millis(baseDelay)).pipe(Schedule.jittered),
          times: retries,
          while: (e) => e._tag === 'R2Error' && e.retryable,
        }),
      )
    })

  return {
    configured: config !== null,
    put: (key, body, opts) =>
      Effect.gen(function* () {
        const headers: Record<string, string> = { ...metaHeaders(opts) }
        if (opts?.contentType) headers['content-type'] = opts.contentType
        const res = yield* send('put', key, 'PUT', { body: body as BodyInit, headers })
        if (res.status === 404) {
          return yield* Effect.fail(new R2Error({ operation: 'put', key, status: 404, retryable: false, message: `R2 bucket not found for ${key}` }))
        }
        return { etag: res.headers.get('etag') ?? undefined }
      }),
    get: (key) =>
      Effect.gen(function* () {
        const res = yield* send('get', key, 'GET', {})
        if (res.status === 404) return null
        return yield* Effect.tryPromise({
          try: () => res.blob(),
          catch: (cause) => new R2Error({ operation: 'get', key, retryable: true, message: `R2 get ${key}: ${String(cause)}` }),
        })
      }),
    head: (key) =>
      Effect.gen(function* () {
        const res = yield* send('head', key, 'HEAD', {})
        if (res.status === 404) return null
        return {
          size: Number(res.headers.get('content-length') ?? 0),
          etag: res.headers.get('etag') ?? undefined,
          sha256: res.headers.get('x-amz-meta-sha256') ?? undefined,
          contentType: res.headers.get('content-type') ?? undefined,
        }
      }),
    remove: (key) =>
      Effect.gen(function* () {
        yield* send('delete', key, 'DELETE', {})
      }),
    presign: (method, key, ttlSec = DEFAULT_PRESIGN_TTL_SEC, opts) => {
      const headers = metaHeaders(opts)
      if (method === 'PUT' && opts?.contentType) headers['content-type'] = opts.contentType
      if (method === 'PUT' && opts?.createOnly) headers['if-none-match'] = '*'
      const query: Record<string, string> = {}
      if (method === 'GET' && opts?.responseContentType) query['response-content-type'] = opts.responseContentType
      if (method === 'GET' && opts?.responseContentDisposition) {
        query['response-content-disposition'] = opts.responseContentDisposition
      }
      return presign(method, key, ttlSec, headers, query)
    },
  }
}

/** Only x-amz-* headers are signed; content-type may vary. */
function metaFrom(headers?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).filter(([k]) => k.toLowerCase().startsWith('x-amz-')))
}

/** Layer for a given config, using the `Fetch` service. */
export const r2Layer = (config: R2Config | null, options?: { now?: () => Date; policy?: R2Policy }) =>
  Layer.effect(
    R2Storage,
    Effect.gen(function* () {
      const fetchFn = yield* Fetch
      return makeR2Storage(config, fetchFn, options)
    }),
  )

/** Production layer: config from env (read when called), global fetch. */
export const r2Live = () => r2Layer(r2ConfigFromEnv()).pipe(Layer.provide(FetchLive))

/** Object key for a Convex storage id. */
export function r2KeyFor(storageId: string, prefix = 'files/'): string {
  return `${prefix}${storageId}`
}
