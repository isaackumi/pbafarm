/**
 * Outbound sends of an automation run, as an Effect program (D-019, doc 19
 * §3 "Automation engine runs").
 *
 * - Each send goes through the company's messaging route
 *   (convex/messaging/deliver.ts `deliverMessage`), which already retries
 *   provider 5xx/network errors inside one attempt (PLAT-007).
 * - Each send has its own timeout here. A timed-out send is NOT retryable:
 *   the provider may have accepted it and none of the SMS/WhatsApp vendors
 *   take an idempotency key (doc 19 §4 rule 4).
 * - Failures are tagged; `sendAll` never fails, it returns one outcome per
 *   message so the run can record each delivery and retry only the ones that
 *   failed transiently (run-level back-off lives in engine.ts).
 */
import * as Data from 'effect/Data'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import type { SendInput, SendResult } from '../messaging/providers/types'

/** The route refused or failed the message. */
export class DeliveryRejected extends Data.TaggedError('DeliveryRejected')<{
  readonly message: string
  readonly retryable: boolean
}> {}

/** No answer within the per-send timeout. */
export class DeliveryTimeout extends Data.TaggedError('DeliveryTimeout')<{
  readonly message: string
}> {}

export type DeliveryFailure = DeliveryRejected | DeliveryTimeout

export type Sender = (input: SendInput) => Promise<SendResult>

export type Outcome = {
  index: number
  ok: boolean
  providerMessageId?: string
  error?: string
  retryable?: boolean
}

/** Per-send budget: covers the adapter's own retries (3 × 10 s + backoff). */
export const SEND_TIMEOUT_MS = 45_000
export const SEND_CONCURRENCY = 4

export function sendOne(
  send: Sender,
  input: SendInput,
  timeoutMs: number = SEND_TIMEOUT_MS,
): Effect.Effect<{ providerMessageId?: string }, DeliveryFailure> {
  return Effect.tryPromise({
    try: () => send(input),
    // A throw here is infrastructure (a failed internal query), not the provider: retry later.
    catch: (e) =>
      new DeliveryRejected({ message: e instanceof Error ? e.message : String(e), retryable: true }),
  }).pipe(
    Effect.flatMap((r) =>
      r.ok
        ? Effect.succeed({ providerMessageId: r.providerMessageId })
        : Effect.fail(new DeliveryRejected({ message: r.error, retryable: r.retryable })),
    ),
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () =>
        Effect.fail(new DeliveryTimeout({ message: `No answer from the provider within ${Math.round(timeoutMs / 1000)} s` })),
    }),
  )
}

export function sendAll(
  send: Sender,
  items: { index: number; input: SendInput }[],
  opts: { timeoutMs?: number; concurrency?: number } = {},
): Effect.Effect<Outcome[]> {
  return Effect.forEach(
    items,
    ({ index, input }) =>
      Effect.result(sendOne(send, input, opts.timeoutMs)).pipe(
        Effect.map((r): Outcome => {
          if (Result.isSuccess(r)) return { index, ok: true, providerMessageId: r.success.providerMessageId }
          const e = r.failure
          return {
            index,
            ok: false,
            error: e.message,
            retryable: e._tag === 'DeliveryRejected' ? e.retryable : false,
          }
        }),
      ),
    { concurrency: opts.concurrency ?? SEND_CONCURRENCY },
  )
}
