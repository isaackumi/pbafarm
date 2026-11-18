/**
 * Effect bridge for Convex functions (D-019, docs/architecture/19-effect-adoption.md).
 *
 * Effect is adopted incrementally: existing functions stay plain async code.
 * New code that talks to the outside world (providers, webhooks, AI, IoT)
 * builds an `Effect` and runs it at the edge of a Convex handler with one of
 * the helpers below, which turn a typed failure into the same errors the rest
 * of the backend throws:
 *
 *   - `UserFacingError` (tagged) -> `userError(code, message, details)`
 *     (a ConvexError the client can show; see ./errors.ts)
 *   - a `ConvexError` that escaped as a defect -> rethrown intact
 *   - any other typed failure -> `toUserError(error)` if it returns one,
 *     otherwise a plain `Error` (logged server-side, generic on the client)
 *
 * Which runner to use:
 *   - actions and httpActions: `runEffect` (async; timers, fetch, retry OK)
 *   - mutations: `runEffect` works, but keep the program free of
 *     `Effect.sleep`/`retry`/`timeout`: a mutation must not wait on timers,
 *     and the transaction would be held while it does. Prefer `runEffectSync`.
 *   - queries: `runEffectSync` only, with a pure program. Queries must stay
 *     deterministic and cache-friendly: no `Clock` (wall time), no `Random`,
 *     no timers, no I/O. Pass "now" in as an argument. `runEffectSync` throws
 *     if the program tries to go async, which catches accidental timers.
 */
import * as Cause from 'effect/Cause'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Result from 'effect/Result'
import { ConvexError } from 'convex/values'
import { type ErrorCode, type UserErrorData, isUserError, userError } from './errors'

/**
 * A failure the person can act on. Fail with this inside an Effect program
 * instead of throwing `userError(...)`; the runner converts it.
 */
export class UserFacingError extends Data.TaggedError('UserFacingError')<{
  readonly code: ErrorCode
  readonly message: string
  readonly details?: UserErrorData['details']
}> {}

export type RunOptions<E> = {
  /**
   * Map a typed failure (other than `UserFacingError`) to a user error.
   * Return `undefined` to treat it as an internal failure (plain `Error`).
   */
  readonly toUserError?: (error: E) => ConvexError<UserErrorData> | undefined
}

/** Convert a failed Exit into the value a Convex handler should throw. */
export function exitToThrowable<A, E>(
  exit: Exit.Exit<A, E>,
  options: RunOptions<E> = {},
): unknown {
  if (Exit.isSuccess(exit)) {
    throw new TypeError('exitToThrowable called with a successful Exit')
  }
  const cause = exit.cause
  const failure = Cause.findError(cause)
  if (Result.isSuccess(failure)) {
    const error = failure.success
    if (error instanceof UserFacingError) {
      return userError(error.code, error.message, error.details)
    }
    if (error instanceof ConvexError) return error
    const mapped = options.toUserError?.(error)
    if (mapped) return mapped
    return toError(error)
  }
  // Defect (a throw inside Effect.sync/promise) or interruption.
  const squashed = Cause.squash(cause)
  if (squashed instanceof ConvexError || isUserError(squashed)) return squashed
  return toError(squashed)
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'object' && value !== null && 'message' in value) {
    return new Error(String((value as { message: unknown }).message))
  }
  return new Error(String(value))
}

/**
 * Run an Effect from an action, httpAction or mutation handler and return its
 * value, or throw the mapped error.
 */
export async function runEffect<A, E>(
  program: Effect.Effect<A, E, never>,
  options?: RunOptions<E>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(program)
  if (Exit.isSuccess(exit)) return exit.value
  throw exitToThrowable(exit, options)
}

/**
 * Run a synchronous, pure Effect (queries, mutations, domain pipelines).
 * Throws if the program needs to go async (timers, promises).
 */
export function runEffectSync<A, E>(
  program: Effect.Effect<A, E, never>,
  options?: RunOptions<E>,
): A {
  const exit = Effect.runSyncExit(program)
  if (Exit.isSuccess(exit)) return exit.value
  throw exitToThrowable(exit, options)
}
