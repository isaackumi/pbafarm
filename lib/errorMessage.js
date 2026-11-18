/**
 * Turn any thrown value into one human sentence for the UI.
 *
 * - ConvexError from convex/lib/errors.ts `userError`: `error.data.message`.
 * - ConvexError with string data: the string.
 * - Anything else: `error.message` stripped of Convex's request-id / stack
 *   noise ("[CONVEX M(x)] [Request ID: …] Server Error\nUncaught Error: …").
 */
export function errorMessage(err, fallback = 'Something went wrong') {
  const data = err && typeof err === 'object' ? err.data : undefined
  if (typeof data === 'string' && data.trim()) return data.trim()
  if (data && typeof data === 'object' && typeof data.message === 'string' && data.message.trim()) {
    return data.message.trim()
  }
  const raw = err?.message ?? (typeof err === 'string' ? err : '')
  const msg = String(raw || '')
    .replace(/^.*Uncaught (?:Convex)?Error:\s*/s, '')
    .replace(/^\[CONVEX [^\]]*\]\s*/, '')
    .replace(/^\[Request ID: [^\]]*\]\s*/, '')
    .split('\n')[0]
    .trim()
  return msg || fallback
}

/** The machine-readable code from a `userError`, or null. */
export function errorCode(err) {
  const data = err && typeof err === 'object' ? err.data : undefined
  return data && typeof data === 'object' && typeof data.code === 'string' ? data.code : null
}
