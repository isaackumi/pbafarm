/**
 * Small HttpClient-style JSON fetch for Effect programs (D-019).
 *
 * Use from actions, httpActions and server routes (never from queries or
 * mutations: Convex only allows fetch in actions). Every call gets:
 *   - a per-attempt timeout that aborts the underlying fetch,
 *   - retry with exponential backoff + jitter for transient failures only
 *     (network error, timeout, HTTP 5xx; never 4xx),
 *   - typed errors (tagged) instead of thrown strings,
 *   - optional Schema validation of the response body.
 *
 * `fetch` is a service (`Fetch`) so tests provide a fake with `fetchLayer`.
 * URLs in errors are reduced to origin + path so query-string secrets (e.g.
 * Gemini's `?key=`) never reach logs.
 *
 * Retrying a non-idempotent POST (send an SMS, charge a card) after a timeout
 * can duplicate it. Pass `retries: 0`, or a `retryOn` that excludes
 * `HttpTimeoutError`, unless the provider de-duplicates (idempotency key).
 */
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'

export class HttpNetworkError extends Data.TaggedError('HttpNetworkError')<{
  readonly url: string
  readonly message: string
  readonly cause?: unknown
}> {}

export class HttpTimeoutError extends Data.TaggedError('HttpTimeoutError')<{
  readonly url: string
  readonly timeoutMs: number
  readonly message: string
}> {}

/** Non-2xx response. `body` is the parsed JSON (or raw text, or null). */
export class HttpStatusError extends Data.TaggedError('HttpStatusError')<{
  readonly url: string
  readonly status: number
  readonly body: unknown
  /** Raw response text (for provider-specific error messages). */
  readonly text: string
  readonly message: string
}> {}

/** 2xx response whose body did not match the expected Schema. */
export class HttpDecodeError extends Data.TaggedError('HttpDecodeError')<{
  readonly url: string
  readonly status: number
  readonly body: unknown
  readonly message: string
}> {}

export type HttpTransportError = HttpNetworkError | HttpTimeoutError | HttpStatusError
export type HttpError = HttpTransportError | HttpDecodeError

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** The fetch implementation, as a service so tests can replace it. */
export class Fetch extends Context.Service<Fetch, FetchFn>()('anowa/Fetch') {}

/** Production layer: the runtime's global fetch (looked up per call). */
export const FetchLive = Layer.succeed(Fetch, (input, init) => globalThis.fetch(input, init))

/** Layer for a specific fetch implementation (tests, instrumented fetch). */
export const fetchLayer = (impl: FetchFn) => Layer.succeed(Fetch, impl)

export type HttpRequest = {
  readonly url: string
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  readonly headers?: Record<string, string>
  /** Objects are sent as JSON (Content-Type set if absent); strings as-is. */
  readonly body?: unknown
  /** fetch redirect mode; 'manual' makes a 3xx an HttpStatusError (webhooks). */
  readonly redirect?: 'follow' | 'manual' | 'error'
}

export type HttpPolicy = {
  /** Per-attempt timeout. Default 15s. */
  readonly timeoutMs?: number
  /** Retries after the first attempt. Default 2. 0 disables retry. */
  readonly retries?: number
  /** First backoff delay; doubles each retry, with jitter. Default 300ms. */
  readonly retryBaseDelayMs?: number
  /** Which failures to retry. Default `isTransientHttpError`. */
  readonly retryOn?: (error: HttpTransportError) => boolean
}

export type HttpResponse = {
  readonly status: number
  readonly headers: Headers
  /** Parsed JSON, the raw text when not JSON, or null when empty. */
  readonly body: unknown
  /** Raw response text. */
  readonly text: string
}

export const DEFAULT_TIMEOUT_MS = 15_000
export const DEFAULT_RETRIES = 2
export const DEFAULT_RETRY_BASE_DELAY_MS = 300

/** Network failures, timeouts and 5xx are transient; 4xx never are. */
export function isTransientHttpError(error: HttpTransportError): boolean {
  switch (error._tag) {
    case 'HttpNetworkError':
    case 'HttpTimeoutError':
      return true
    case 'HttpStatusError':
      return error.status >= 500
  }
}

/** origin + path only: drops query strings that may carry API keys. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return url.split('?')[0]
  }
}

function parseBody(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  return String(cause)
}

/** One attempt: fetch + read body, aborted when the timeout fires. */
function attempt(
  req: HttpRequest,
  timeoutMs: number,
): Effect.Effect<HttpResponse, HttpTransportError, Fetch> {
  const safeUrl = redactUrl(req.url)
  return Effect.gen(function* () {
    const fetchFn = yield* Fetch
    const headers: Record<string, string> = { ...(req.headers ?? {}) }
    let body: string | undefined
    if (typeof req.body === 'string') {
      body = req.body
    } else if (req.body !== undefined) {
      body = JSON.stringify(req.body)
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json'
      }
    }

    const response = yield* Effect.tryPromise({
      try: async (signal) => {
        const res = await fetchFn(req.url, {
          method: req.method ?? (body === undefined ? 'GET' : 'POST'),
          headers,
          body,
          signal,
          ...(req.redirect ? { redirect: req.redirect } : {}),
        })
        const text = await res.text().catch(() => '')
        return { status: res.status, headers: res.headers, body: parseBody(text), text, ok: res.ok }
      },
      catch: (cause) => new HttpNetworkError({ url: safeUrl, message: errorMessage(cause), cause }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        orElse: () =>
          Effect.fail(
            new HttpTimeoutError({
              url: safeUrl,
              timeoutMs,
              message: `Request to ${safeUrl} timed out after ${timeoutMs} ms`,
            }),
          ),
      }),
    )

    if (!response.ok) {
      return yield* Effect.fail(
        new HttpStatusError({
          url: safeUrl,
          status: response.status,
          body: response.body,
          text: response.text,
          message: `Request to ${safeUrl} failed (${response.status})`,
        }),
      )
    }
    return { status: response.status, headers: response.headers, body: response.body, text: response.text }
  })
}

/**
 * Send a request and return the parsed body. Transient failures are retried
 * per `policy`; the last failure is returned when retries run out.
 */
export function requestJson(
  req: HttpRequest,
  policy: HttpPolicy = {},
): Effect.Effect<HttpResponse, HttpTransportError, Fetch> {
  const timeoutMs = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = policy.retries ?? DEFAULT_RETRIES
  const retryOn = policy.retryOn ?? isTransientHttpError
  const once = attempt(req, timeoutMs)
  if (retries <= 0) return once
  const schedule = Schedule.exponential(
    Duration.millis(policy.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS),
  ).pipe(Schedule.jittered)
  return once.pipe(Effect.retry({ schedule, times: retries, while: retryOn }))
}

/** `requestJson` + Schema validation of a 2xx body. */
export function requestJsonAs<S extends Schema.Decoder<unknown>>(
  schema: S,
  req: HttpRequest,
  policy: HttpPolicy = {},
): Effect.Effect<S['Type'], HttpError, Fetch | S['DecodingServices']> {
  const decode = Schema.decodeUnknownEffect(schema)
  return Effect.gen(function* () {
    const res = yield* requestJson(req, policy)
    return yield* decode(res.body).pipe(
      Effect.mapError(
        (issue) =>
          new HttpDecodeError({
            url: redactUrl(req.url),
            status: res.status,
            body: res.body,
            message: `Unexpected response from ${redactUrl(req.url)}: ${issue.message}`,
          }),
      ),
    )
  })
}

/** The response body (declared or actual) is over the caller's cap. */
export class HttpTooLargeError extends Data.TaggedError('HttpTooLargeError')<{
  readonly url: string
  readonly maxBytes: number
  readonly message: string
}> {}

export type HttpBytes = {
  readonly status: number
  /** Declared Content-Type without parameters, lower case ('' when absent). */
  readonly contentType: string
  readonly bytes: Uint8Array
}

type BytesAttempt = HttpBytes | { readonly tooLarge: true } | { readonly failed: number; readonly text: string }

/** Read a body, stopping as soon as it passes `maxBytes`. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined)
    return null
  }
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.byteLength > maxBytes ? null : buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/**
 * GET a binary body (media download) with the same timeout and retry rules
 * as `requestJson`, refusing bodies over `maxBytes` without buffering them.
 * A too-large body is never retried.
 */
export function requestBytes(
  req: { readonly url: string; readonly headers?: Record<string, string> },
  policy: HttpPolicy & { readonly maxBytes: number },
): Effect.Effect<HttpBytes, HttpTransportError | HttpTooLargeError, Fetch> {
  const safeUrl = redactUrl(req.url)
  const timeoutMs = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const once = Effect.gen(function* () {
    const fetchFn = yield* Fetch
    const result = yield* Effect.tryPromise({
      try: async (signal): Promise<BytesAttempt> => {
        const res = await fetchFn(req.url, { method: 'GET', headers: { ...(req.headers ?? {}) }, signal, redirect: 'follow' })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return { failed: res.status, text: text.slice(0, 500) }
        }
        const bytes = await readCapped(res, policy.maxBytes)
        if (!bytes) return { tooLarge: true }
        const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
        return { status: res.status, contentType, bytes }
      },
      catch: (cause) => new HttpNetworkError({ url: safeUrl, message: errorMessage(cause), cause }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        orElse: () =>
          Effect.fail(
            new HttpTimeoutError({ url: safeUrl, timeoutMs, message: `Request to ${safeUrl} timed out after ${timeoutMs} ms` }),
          ),
      }),
    )
    if ('tooLarge' in result) {
      return yield* Effect.fail(
        new HttpTooLargeError({ url: safeUrl, maxBytes: policy.maxBytes, message: `Response from ${safeUrl} is over ${policy.maxBytes} bytes` }),
      )
    }
    if ('failed' in result) {
      return yield* Effect.fail(
        new HttpStatusError({
          url: safeUrl,
          status: result.failed,
          body: parseBody(result.text),
          text: result.text,
          message: `Request to ${safeUrl} failed (${result.failed})`,
        }),
      )
    }
    return result
  })
  const retries = policy.retries ?? DEFAULT_RETRIES
  if (retries <= 0) return once
  const retryOn = policy.retryOn ?? isTransientHttpError
  const schedule = Schedule.exponential(Duration.millis(policy.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS)).pipe(
    Schedule.jittered,
  )
  return once.pipe(
    Effect.retry({
      schedule,
      times: retries,
      while: (e) => e._tag !== 'HttpTooLargeError' && retryOn(e),
    }),
  )
}
