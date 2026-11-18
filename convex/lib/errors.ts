/**
 * User-facing errors.
 *
 * Throw `userError(code, message)` for failures the person can act on
 * (validation, duplicates, insufficient stock, permission refusals). Convex
 * passes a ConvexError's `data` through to the client intact, so the UI can
 * show `error.data.message` instead of a request-id/stack dump, and branch on
 * `error.data.code`. Plain `Error` throws keep working: the client falls back
 * to cleaning `error.message` (see lib/errorMessage.js).
 *
 * In production Convex replaces a plain `Error` message with "Server Error",
 * so any message the person must read has to be a `userError`. Converted so
 * far: daily entry (convex/dailyRecords.ts) and the feed ledger
 * (convex/lib/feedLedger.ts), plus the modules that already used it. Other
 * plain throws are converted module by module (OPS-001).
 */
import { ConvexError } from 'convex/values'

export const ERROR_CODES = [
  /** Input failed validation (missing/invalid field, bad range). */
  'VALIDATION',
  /** The record already exists (e.g. a daily record for that cage and date). */
  'DUPLICATE',
  /** A referenced record does not exist or is not visible to the caller. */
  'NOT_FOUND',
  /** Not enough feed (or other stock) to cover the request. */
  'INSUFFICIENT_STOCK',
  /** Not signed in. */
  'UNAUTHENTICATED',
  /** Signed in but not allowed to do this. */
  'FORBIDDEN',
  /** The action conflicts with the record's current state (e.g. cage not active). */
  'CONFLICT',
  /** Too many requests in a short time. */
  'RATE_LIMITED',
  /** Fish are inside a treatment withdrawal period (PROD-012). */
  'WITHDRAWAL_ACTIVE',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export type UserErrorData = {
  code: ErrorCode
  message: string
  details?: Record<string, string | number | boolean | null>
}

export function userError(
  code: ErrorCode,
  message: string,
  details?: UserErrorData['details'],
): ConvexError<UserErrorData> {
  const data: UserErrorData = details ? { code, message, details } : { code, message }
  return new ConvexError(data)
}

export function isUserError(err: unknown): err is ConvexError<UserErrorData> {
  if (!(err instanceof ConvexError)) return false
  const data = err.data as unknown
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { code?: unknown }).code === 'string' &&
    typeof (data as { message?: unknown }).message === 'string'
  )
}
