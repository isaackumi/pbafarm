/**
 * Public API v1 httpActions (INT-004, doc 09 §8). Registered in convex/http.ts.
 *
 * Every request: Bearer key → `internal.publicApi.authorize` (hash compare,
 * scope, per-key and per-company rate limits) → the internal query or
 * mutation. Programs are Effect pipelines (D-019): failures are a tagged
 * `ApiFailure` mapped to one JSON error shape `{ error: { code, message } }`.
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { ConvexError } from 'convex/values'
import { httpAction } from '../_generated/server'
import type { ActionCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { sha256Hex } from '../lib/crypto'
import { runEffect } from '../lib/effect'
import { API_KEY_PATTERN, type ApiScope } from './apiScopes'
import type { ApiResource, AuthResult, WriteResult } from '../publicApi'
import { openApiDocument } from './openapi'
import { MAX_READINGS_PER_BATCH, ReadingsBody, checkReading, type CleanReading } from './sensorLogic'
import type { IngestResult } from '../sensors'

export class ApiFailure extends Data.TaggedError('ApiFailure')<{
  readonly status: number
  readonly code: string
  readonly message: string
  readonly retryAfterMs?: number
}> {}

export const MAX_BODY_BYTES = 1024 * 1024
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const IDEMPOTENCY_RE = /^[A-Za-z0-9_\-:.]{1,200}$/

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  })
}

function failureResponse(f: ApiFailure) {
  const headers: Record<string, string> = {}
  if (f.status === 401) headers['WWW-Authenticate'] = 'Bearer'
  if (f.retryAfterMs !== undefined) headers['Retry-After'] = String(Math.max(1, Math.ceil(f.retryAfterMs / 1000)))
  return jsonResponse(f.status, { error: { code: f.code, message: f.message } }, headers)
}

/** Run an API program; every failure becomes a JSON error response. */
export function runApi(program: Effect.Effect<Response, ApiFailure>): Promise<Response> {
  return runEffect(
    program.pipe(
      Effect.catchTag('ApiFailure', (f) => Effect.succeed(failureResponse(f))),
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          console.error('api v1 internal error', cause)
          return jsonResponse(500, { error: { code: 'internal', message: 'Internal error' } })
        }),
      ),
    ),
  )
}

/** The human message of an error thrown by a nested Convex function. */
export function domainErrorMessage(err: unknown): string {
  if (err instanceof ConvexError) {
    const data = err.data as { message?: unknown } | string
    if (typeof data === 'string') return data
    if (data && typeof data.message === 'string') return data.message
  }
  const raw = err instanceof Error ? err.message : String(err)
  const uncaught = raw.match(/Uncaught (?:Error|ConvexError): ([^\n]*)/)
  const text = uncaught ? uncaught[1] : raw.split('\n')[0]
  return text.replace(/^\[[^\]]*\]\s*/g, '').trim().slice(0, 500) || 'Request failed'
}

/** Parse `Authorization: Bearer pbk_…`. */
export function parseBearer(header: string | null): { prefix: string; key: string } | null {
  const m = header?.match(/^Bearer\s+(\S+)\s*$/i)
  if (!m) return null
  const k = API_KEY_PATTERN.exec(m[1])
  return k ? { prefix: k[1], key: m[1] } : null
}

export type ApiAuth = Extract<AuthResult, { ok: true }>

/** Authenticate the request's key for `scope` (and charge the rate limits). */
export function authenticate(
  ctx: ActionCtx,
  req: Request,
  scope: ApiScope,
): Effect.Effect<ApiAuth, ApiFailure> {
  return Effect.gen(function* () {
    const bearer = parseBearer(req.headers.get('Authorization'))
    if (!bearer) {
      return yield* Effect.fail(
        new ApiFailure({ status: 401, code: 'unauthorized', message: 'Send Authorization: Bearer <API key>' }),
      )
    }
    const hash = yield* Effect.promise(() => sha256Hex(bearer.key))
    const result: AuthResult = yield* Effect.promise(() =>
      ctx.runMutation(internal.publicApi.authorize, { prefix: bearer.prefix, hash, scope }),
    )
    if (!result.ok) {
      return yield* Effect.fail(
        new ApiFailure({
          status: result.status,
          code: result.code,
          message: result.message,
          retryAfterMs: result.retryAfterMs,
        }),
      )
    }
    return result
  })
}

const READ_SCOPE: Record<ApiResource, ApiScope> = {
  cages: 'cages:read',
  'daily-records': 'daily:read',
  sampling: 'sampling:read',
  harvests: 'harvest:read',
  'feed-stock': 'inventory:read',
  sales: 'sales:read',
}

function badRequest(message: string) {
  return new ApiFailure({ status: 400, code: 'invalid_request', message })
}

/** limit / cursor / from / to from the query string. */
export function parseListParams(url: URL) {
  return Effect.gen(function* () {
    const p = url.searchParams
    const rawLimit = p.get('limit')
    const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return yield* Effect.fail(badRequest(`limit must be a whole number from 1 to ${MAX_LIMIT}`))
    }
    const from = p.get('from') ?? undefined
    const to = p.get('to') ?? undefined
    for (const [name, value] of [['from', from], ['to', to]] as const) {
      if (value !== undefined && !DATE_RE.test(value)) {
        return yield* Effect.fail(badRequest(`${name} must be a date as YYYY-MM-DD`))
      }
    }
    return { limit, cursor: p.get('cursor') || null, from, to }
  })
}

/** GET /api/v1/<resource> */
export const listHandler = (resource: ApiResource) =>
  httpAction((ctx, req) =>
    runApi(
      Effect.gen(function* () {
        const auth = yield* authenticate(ctx, req, READ_SCOPE[resource])
        const params = yield* parseListParams(new URL(req.url))
        const page = yield* Effect.tryPromise({
          try: () =>
            ctx.runQuery(internal.publicApi.listResource, {
              resource,
              companyId: auth.companyId,
              locationIds: auth.locationIds,
              ...params,
            }),
          catch: () => badRequest('cursor is not valid for this list; start again without it'),
        })
        return jsonResponse(200, page)
      }),
    ),
  )

/** GET /api/v1/<resource>/<id> (registered with pathPrefix). */
export const getHandler = (resource: ApiResource) =>
  httpAction((ctx, req) =>
    runApi(
      Effect.gen(function* () {
        const auth = yield* authenticate(ctx, req, READ_SCOPE[resource])
        const path = new URL(req.url).pathname
        const id = decodeURIComponent(path.slice(`/api/v1/${resource}/`.length))
        if (!id || id.includes('/')) {
          return yield* Effect.fail(new ApiFailure({ status: 404, code: 'not_found', message: 'Not found' }))
        }
        const row = yield* Effect.promise(() =>
          ctx.runQuery(internal.publicApi.getResource, {
            resource,
            companyId: auth.companyId,
            locationIds: auth.locationIds,
            id,
          }),
        )
        if (!row) {
          return yield* Effect.fail(new ApiFailure({ status: 404, code: 'not_found', message: 'Not found' }))
        }
        return jsonResponse(200, { data: row })
      }),
    ),
  )

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const optionalNumber = Schema.optional(Schema.Number)
const optionalString = Schema.optional(Schema.String)

export const DailyRecordsBody = Schema.Struct({
  date: Schema.String,
  records: Schema.Array(
    Schema.Struct({
      cageId: Schema.String,
      feedKg: Schema.Number,
      feedTypeId: optionalString,
      mortality: Schema.Number,
      mortalityCause: optionalString,
      notes: optionalString,
      dissolvedOxygen: optionalNumber,
      temperatureC: optionalNumber,
    }),
  ),
})

export const SamplingBody = Schema.Struct({
  date: Schema.String,
  records: Schema.Array(
    Schema.Struct({
      cageId: Schema.String,
      fishCount: Schema.Number,
      totalWeightG: Schema.Number,
      batchCode: optionalString,
      dissolvedOxygen: optionalNumber,
      temperatureC: optionalNumber,
      secchiCm: optionalNumber,
    }),
  ),
})

/** Read, size-check and Schema-decode a JSON body; returns it with its hash. */
export function readJsonBody<S extends Schema.Decoder<unknown>>(req: Request, schema: S) {
  return Effect.gen(function* () {
    const declared = Number(req.headers.get('Content-Length') ?? '0')
    if (declared > MAX_BODY_BYTES) {
      return yield* Effect.fail(new ApiFailure({ status: 413, code: 'payload_too_large', message: 'Body is larger than 1 MB' }))
    }
    const text = yield* Effect.promise(() => req.text())
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return yield* Effect.fail(new ApiFailure({ status: 413, code: 'payload_too_large', message: 'Body is larger than 1 MB' }))
    }
    const parsed = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () => badRequest('Body must be JSON'),
    })
    const body = yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(
      Effect.mapError((issue) => badRequest(`Invalid body: ${issue.message}`)),
    )
    const hash = yield* Effect.promise(() => sha256Hex(text))
    return { body: body as S['Type'], hash }
  })
}

function idempotencyKeyOf(req: Request) {
  const key = req.headers.get('Idempotency-Key')
  if (!key) return Effect.fail(badRequest('Send an Idempotency-Key header (any unique string per request)'))
  if (!IDEMPOTENCY_RE.test(key)) {
    return Effect.fail(badRequest('Idempotency-Key: 1–200 characters of letters, digits, _ - : .'))
  }
  return Effect.succeed(key)
}

function checkBatch(date: string, count: number) {
  if (!DATE_RE.test(date)) return Effect.fail(badRequest('date must be YYYY-MM-DD'))
  if (count < 1 || count > 100) return Effect.fail(badRequest('records must hold 1 to 100 lines'))
  return Effect.void
}

/** Run a write mutation; domain refusals become 422 with the app's message. */
function runWrite(run: () => Promise<WriteResult>) {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: run,
      catch: (err) =>
        new ApiFailure({ status: 422, code: 'unprocessable', message: domainErrorMessage(err) }),
    })
    return jsonResponse(result.status, result.body, result.replayed ? { 'Idempotent-Replayed': 'true' } : {})
  })
}

/** POST /api/v1/daily-records */
export const createDailyRecordsHandler = httpAction((ctx, req) =>
  runApi(
    Effect.gen(function* () {
      const auth = yield* authenticate(ctx, req, 'daily:write')
      const idempotencyKey = yield* idempotencyKeyOf(req)
      const { body, hash } = yield* readJsonBody(req, DailyRecordsBody)
      yield* checkBatch(body.date, body.records.length)
      return yield* runWrite(() =>
        ctx.runMutation(internal.publicApi.createDailyRecords, {
          apiKeyId: auth.apiKeyId as Id<'apiKeys'>,
          idempotencyKey,
          requestHash: hash,
          date: body.date,
          records: body.records.map((r) => ({ ...r })),
        }),
      )
    }),
  ),
)

/** POST /api/v1/sampling */
export const createSamplingHandler = httpAction((ctx, req) =>
  runApi(
    Effect.gen(function* () {
      const auth = yield* authenticate(ctx, req, 'sampling:write')
      const idempotencyKey = yield* idempotencyKeyOf(req)
      const { body, hash } = yield* readJsonBody(req, SamplingBody)
      yield* checkBatch(body.date, body.records.length)
      return yield* runWrite(() =>
        ctx.runMutation(internal.publicApi.createSampling, {
          apiKeyId: auth.apiKeyId,
          idempotencyKey,
          requestHash: hash,
          date: body.date,
          records: body.records.map((r) => ({ ...r })),
        }),
      )
    }),
  ),
)

/**
 * POST /ingest/v1/readings (INT-007): up to 500 water-quality readings.
 * Each reading is checked on its own; bad ones are listed in `rejected`,
 * repeats of stored readings are counted as `duplicates`. 422 when none
 * could be stored.
 */
export const ingestReadingsHandler = httpAction((ctx, req) =>
  runApi(
    Effect.gen(function* () {
      const auth = yield* authenticate(ctx, req, 'ingest:write')
      const { body } = yield* readJsonBody(req, ReadingsBody)
      if (body.readings.length < 1 || body.readings.length > MAX_READINGS_PER_BATCH) {
        return yield* Effect.fail(badRequest(`readings must hold 1 to ${MAX_READINGS_PER_BATCH} items`))
      }
      const now = Date.now()
      const rejected: { index: number; reason: string }[] = []
      const ok: (CleanReading & { index: number })[] = []
      for (const [index, raw] of body.readings.entries()) {
        const checked = checkReading(raw, now)
        if (checked.ok) ok.push({ index, ...checked.reading })
        else rejected.push({ index, reason: checked.reason })
      }
      const stored: IngestResult = ok.length
        ? yield* Effect.tryPromise({
            try: () => ctx.runMutation(internal.sensors.ingest, { apiKeyId: auth.apiKeyId, readings: ok }),
            catch: (err) => new ApiFailure({ status: 422, code: 'unprocessable', message: domainErrorMessage(err) }),
          })
        : { accepted: 0, duplicates: 0, rejected: [] }
      const all = [...rejected, ...stored.rejected].sort((a, b) => a.index - b.index)
      const result = { accepted: stored.accepted, duplicates: stored.duplicates, rejected: all }
      return jsonResponse(stored.accepted + stored.duplicates > 0 ? 200 : 422, result)
    }),
  ),
)

/** GET /api/v1/openapi.json (no key needed). */
export const openApiHandler = httpAction(async (_ctx, req) => {
  const origin = new URL(req.url).origin
  return jsonResponse(200, openApiDocument(origin), { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' })
})
