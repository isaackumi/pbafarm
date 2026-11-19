/**
 * POST /webhooks/in/<publicId> (INT-003, doc 09 §7). Registered in convex/http.ts.
 *
 * Order: size cap → webhook lookup → per-webhook rate limit → decrypt the
 * secret (here, never in a query result) → signature + timestamp → JSON +
 * event id → `record` (idempotent on the event id and on the digest of the
 * signed `${t}.${body}`, so a new unsigned event id header is no replay bypass). Failures are an
 * `ApiFailure` mapped to `{ error: { code, message } }` by runApi.
 *
 * Responses: 200 `{ received: true, duplicate }`, 400 bad body, 401 bad
 * signature, 404 unknown or disabled webhook, 413 too large, 429 rate
 * limited, 503 encryption not configured.
 */
import * as Effect from 'effect/Effect'
import { httpAction } from '../_generated/server'
import type { ActionCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { decryptJson, readEncryptionKey } from '../lib/crypto'
import { ApiFailure, jsonResponse, runApi } from './apiHttp'
import type { InboundLookup, RecordResult } from '../inboundWebhooks'
import {
  MAX_INBOUND_BYTES,
  REJECT_MESSAGES,
  SIGNATURE_HEADER,
  checkSignature,
  eventIdentity,
  inboundAad,
} from './inboundLogic'

export const INBOUND_PREFIX = '/webhooks/in/'

const notFound = () => new ApiFailure({ status: 404, code: 'not_found', message: 'Unknown webhook' })

const call = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({
    try: f,
    catch: () => new ApiFailure({ status: 500, code: 'internal', message: 'Something went wrong' }),
  })

function logRejected(ctx: ActionCtx, webhookId: Extract<InboundLookup, { found: true }>['webhookId'], reason: string, bytes: number) {
  return call(() => ctx.runMutation(internal.inboundWebhooks.logRejected, { webhookId, reason, payloadBytes: bytes }))
}

export const inboundWebhookHandler = httpAction((ctx, req) =>
  runApi(
    Effect.gen(function* () {
      const publicId = new URL(req.url).pathname.slice(INBOUND_PREFIX.length)
      const declared = Number(req.headers.get('content-length') ?? '0')
      if (declared > MAX_INBOUND_BYTES) {
        return yield* Effect.fail(new ApiFailure({ status: 413, code: 'too_large', message: `Body is over ${MAX_INBOUND_BYTES} bytes` }))
      }
      const hook: InboundLookup = yield* call(() => ctx.runQuery(internal.inboundWebhooks.lookup, { publicId }))
      if (!hook.found || !hook.active) return yield* Effect.fail(notFound())

      const admitted = yield* call(() => ctx.runMutation(internal.inboundWebhooks.admit, { webhookId: hook.webhookId }))
      if (!admitted.ok) {
        return yield* Effect.fail(
          new ApiFailure({ status: 429, code: 'rate_limited', message: 'Too many requests', retryAfterMs: admitted.retryAfterMs }),
        )
      }

      const raw = yield* call(() => req.text())
      const bytes = new TextEncoder().encode(raw).length
      if (bytes > MAX_INBOUND_BYTES) {
        return yield* Effect.fail(new ApiFailure({ status: 413, code: 'too_large', message: `Body is over ${MAX_INBOUND_BYTES} bytes` }))
      }

      const key = readEncryptionKey()
      if (!key || !hook.ciphertext || !hook.iv) {
        return yield* Effect.fail(new ApiFailure({ status: 503, code: 'unavailable', message: 'Webhook is not ready' }))
      }
      const { secret } = yield* Effect.tryPromise({
        try: () =>
          decryptJson<{ secret: string }>(
            { ciphertext: hook.ciphertext!, iv: hook.iv! },
            inboundAad(hook.companyId, hook.webhookId),
            key,
          ),
        catch: () => new ApiFailure({ status: 503, code: 'unavailable', message: 'Webhook is not ready' }),
      })

      const check = yield* call(() => checkSignature(secret, raw, req.headers.get(SIGNATURE_HEADER), Date.now()))
      if (!check.ok) {
        yield* logRejected(ctx, hook.webhookId, check.reason, bytes)
        return yield* Effect.fail(new ApiFailure({ status: 401, code: 'invalid_signature', message: REJECT_MESSAGES[check.reason] }))
      }

      let body: unknown
      try {
        body = JSON.parse(raw)
      } catch {
        body = undefined
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        yield* logRejected(ctx, hook.webhookId, 'invalid_json', bytes)
        return yield* Effect.fail(new ApiFailure({ status: 400, code: 'invalid_body', message: 'Body must be a JSON object' }))
      }
      const identity = eventIdentity(req.headers, body as Record<string, unknown>)
      if (!identity.ok) {
        yield* logRejected(ctx, hook.webhookId, 'missing_event_id', bytes)
        return yield* Effect.fail(new ApiFailure({ status: 400, code: 'invalid_body', message: identity.message }))
      }

      const result: RecordResult = yield* call(() =>
        ctx.runMutation(internal.inboundWebhooks.record, {
          webhookId: hook.webhookId,
          externalId: identity.externalId,
          eventType: identity.eventType,
          payload: raw,
          payloadBytes: bytes,
          signedAt: check.signedAt,
          signedDigest: check.signedDigest,
        }),
      )
      if (result.status === 'disabled') return yield* Effect.fail(notFound())
      return jsonResponse(200, { received: true, duplicate: result.status === 'duplicate', id: identity.externalId })
    }),
  ),
)
