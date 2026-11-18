/**
 * Effect plumbing shared by the messaging adapters (D-019, PLAT-007).
 *
 * Each adapter builds its send as an Effect that needs the `Fetch` service
 * and fails with a tagged `ProviderRejected` / `ProviderUnavailable`.
 * `runSend` provides `Fetch` and turns the outcome into the plain
 * `SendResult` the rest of the app already uses, so callers and their
 * behaviour do not change: adapters never throw.
 *
 * Retry policy for sends (doc 19 §4, rule 4):
 *   - HTTP 5xx and connection failures: retried twice with jittered backoff.
 *   - Timeouts: NOT retried. The provider may already have accepted the
 *     message; a second POST would send a second SMS/WhatsApp/email. None of
 *     the SMS/WhatsApp vendors here accept an idempotency key.
 *   - 4xx (including 429): never retried; 429 is still reported
 *     `retryable: true` to the caller, as before.
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Cause from 'effect/Cause'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import {
  type Fetch,
  type FetchFn,
  type HttpPolicy,
  type HttpRequest,
  type HttpResponse,
  type HttpTransportError,
  fetchLayer,
  requestJson,
} from '../../lib/effectHttp'
import { type SendResult, isRetryableStatus, networkErrorMessage, networkFailure, providerError } from './types'

/** The provider answered and refused the message (bad number, bad sender, auth…). */
export class ProviderRejected extends Data.TaggedError('ProviderRejected')<{
  readonly message: string
  readonly retryable: boolean
}> {}

/** The provider could not be reached or failed (network, timeout, 429, 5xx). */
export class ProviderUnavailable extends Data.TaggedError('ProviderUnavailable')<{
  readonly message: string
}> {}

export type ProviderFailure = ProviderRejected | ProviderUnavailable

export type Accepted = { providerMessageId?: string }

export type SendEffect = Effect.Effect<Accepted, ProviderFailure, Fetch>

/** Per-attempt timeout for a provider call. */
export const SEND_TIMEOUT_MS = 10_000

export const SEND_POLICY: HttpPolicy = {
  timeoutMs: SEND_TIMEOUT_MS,
  retries: 2,
  retryBaseDelayMs: 300,
  retryOn: (error: HttpTransportError) =>
    error._tag === 'HttpNetworkError' || (error._tag === 'HttpStatusError' && error.status >= 500),
}

/** Parsed JSON object/array, or null when the body is empty or not JSON. */
function jsonOf(body: unknown): unknown {
  return typeof body === 'object' ? body : null
}

/**
 * POST to a provider. Non-2xx responses become a failure whose message the
 * adapter builds from the parsed JSON and raw text (`describe`).
 */
export function providerPost(
  req: HttpRequest,
  describe: (status: number, json: unknown, text: string) => string = (status, _json, text) =>
    providerError(status, text),
  policy: HttpPolicy = SEND_POLICY,
): Effect.Effect<HttpResponse, ProviderFailure, Fetch> {
  return requestJson({ method: 'POST', ...req }, policy).pipe(
    Effect.catchTags({
      HttpStatusError: (e) => {
        const message = describe(e.status, jsonOf(e.body), e.text)
        return Effect.fail(
          isRetryableStatus(e.status)
            ? new ProviderUnavailable({ message })
            : new ProviderRejected({ message, retryable: false }),
        )
      },
      HttpNetworkError: (e) => Effect.fail(new ProviderUnavailable({ message: networkErrorMessage(e.cause ?? e.message) })),
      HttpTimeoutError: (e) =>
        Effect.fail(new ProviderUnavailable({ message: `Network error: no response within ${e.timeoutMs / 1000} s` })),
    }),
  )
}

/**
 * Validate a provider's 2xx body with Schema. Bodies that do not match are
 * treated as carrying no information (the adapters' previous optional-chaining
 * behaviour), so a provider adding or changing fields never breaks a send.
 */
export function decodeBody<S extends Schema.Decoder<unknown>>(schema: S, res: HttpResponse): S['Type'] | undefined {
  return Option.getOrUndefined(Schema.decodeUnknownOption(schema)(jsonOf(res.body)))
}

/** Run an adapter's send and return the plain result; never throws. */
export async function runSend(program: SendEffect, fetchImpl?: FetchFn): Promise<SendResult> {
  const impl: FetchFn = fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(fetchLayer(impl))))
  if (Exit.isSuccess(exit)) return { ok: true, providerMessageId: exit.value.providerMessageId }
  const failure = Cause.findError(exit.cause)
  if (Result.isSuccess(failure)) {
    const error = failure.success
    return error._tag === 'ProviderRejected'
      ? { ok: false, error: error.message, retryable: error.retryable }
      : { ok: false, error: error.message, retryable: true }
  }
  // A throw while building the request (e.g. btoa on non-Latin-1 input):
  // reported like the adapters' old catch-all.
  return networkFailure(Cause.squash(exit.cause))
}
