/**
 * Forward checked readings to Convex POST /ingest/v1/readings (INT-007) in
 * chunks of 500, with requestJson (convex/lib/effectHttp: per-attempt
 * timeout, retry only network/timeout/5xx, never 4xx). Retrying is safe:
 * Convex de-duplicates readings by (company, device, parameter, measuredAt).
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { requestJson, type Fetch, type HttpPolicy } from '../../../convex/lib/effectHttp'
import { MAX_READINGS_PER_BATCH, type CleanReading } from '../../../convex/integrations/sensorLogic'

export const IngestResult = Schema.Struct({
  accepted: Schema.Number,
  duplicates: Schema.Number,
  rejected: Schema.Array(Schema.Struct({ index: Schema.Number, reason: Schema.String })),
})
export type IngestResult = typeof IngestResult.Type

/** Convex refused the Worker's key or the request (4xx other than 422). */
export class UpstreamRejected extends Data.TaggedError('UpstreamRejected')<{ status: number; message: string }> {}
/** Convex unreachable, timing out or failing (5xx) after retries. */
export class UpstreamUnavailable extends Data.TaggedError('UpstreamUnavailable')<{ message: string }> {}
/** A 2xx/422 body that is not an ingest result. */
export class UpstreamDecodeError extends Data.TaggedError('UpstreamDecodeError')<{ message: string }> {}

export type ForwardError = UpstreamRejected | UpstreamUnavailable | UpstreamDecodeError

export const FORWARD_POLICY: HttpPolicy = { timeoutMs: 10_000, retries: 2, retryBaseDelayMs: 250 }

const decodeResult = Schema.decodeUnknownEffect(IngestResult)

function decodeBody(body: unknown) {
  return decodeResult(body).pipe(
    Effect.mapError(() => new UpstreamDecodeError({ message: 'Unexpected response from the ingestion endpoint' })),
  )
}

/** One chunk (at most 500 readings). 422 means "none stored" and still carries a result. */
export function forwardChunk(
  opts: { siteUrl: string; apiKey: string; policy?: HttpPolicy },
  readings: CleanReading[],
): Effect.Effect<IngestResult, ForwardError, Fetch> {
  return Effect.gen(function* () {
    const sent = yield* Effect.result(
      requestJson(
        {
          url: `${opts.siteUrl.replace(/\/+$/, '')}/ingest/v1/readings`,
          method: 'POST',
          headers: { Authorization: `Bearer ${opts.apiKey}` },
          body: { readings },
        },
        opts.policy ?? FORWARD_POLICY,
      ),
    )
    if (Result.isSuccess(sent)) return yield* decodeBody(sent.success.body)
    const e = sent.failure
    switch (e._tag) {
      case 'HttpStatusError':
        if (e.status === 422) return yield* decodeBody(e.body)
        if (e.status >= 500) return yield* new UpstreamUnavailable({ message: `Ingestion endpoint failed (${e.status})` })
        return yield* new UpstreamRejected({ status: e.status, message: `Ingestion endpoint refused the request (${e.status})` })
      case 'HttpTimeoutError':
        return yield* new UpstreamUnavailable({ message: 'Ingestion endpoint timed out' })
      case 'HttpNetworkError':
        return yield* new UpstreamUnavailable({ message: 'Ingestion endpoint unreachable' })
    }
  })
}

/**
 * All chunks in order; `indexes[i]` is the device-batch index of
 * `readings[i]`, so rejects map back to what the device sent. Stops at the
 * first failing chunk (earlier chunks are stored; the device resends the
 * whole batch and those come back as duplicates).
 */
export type ForwardResult = { accepted: number; duplicates: number; rejected: { index: number; reason: string }[] }

export function forwardAll(
  opts: { siteUrl: string; apiKey: string; policy?: HttpPolicy },
  readings: CleanReading[],
  indexes: number[],
): Effect.Effect<ForwardResult, ForwardError, Fetch> {
  return Effect.gen(function* () {
    const out: ForwardResult = { accepted: 0, duplicates: 0, rejected: [] }
    for (let start = 0; start < readings.length; start += MAX_READINGS_PER_BATCH) {
      const chunk = readings.slice(start, start + MAX_READINGS_PER_BATCH)
      const res = yield* forwardChunk(opts, chunk)
      out.accepted += res.accepted
      out.duplicates += res.duplicates
      for (const r of res.rejected) out.rejected.push({ index: indexes[start + r.index] ?? -1, reason: r.reason })
    }
    return out
  })
}
