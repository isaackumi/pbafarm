/**
 * Optional error monitoring (OPS-001): send unexpected errors to Sentry when a
 * DSN is configured, do nothing otherwise. No SDK: one envelope POST
 * (https://develop.sentry.dev/sdk/data-model/envelopes/), so the client bundle
 * and the Convex runtime stay small. Shared by the browser (lib/monitoring.js,
 * NEXT_PUBLIC_SENTRY_DSN) and Convex actions (`withErrorReporting`,
 * SENTRY_DSN on the deployment).
 *
 * Not reported: user errors (`userError`, a ConvexError the person can act
 * on) and auth refusals; those are expected outcomes, not bugs.
 * Never sent: request bodies, arguments, emails or query strings. Only the
 * error type, message, stack, the function/page name and the tags given.
 *
 * Reporting is best-effort: it never throws and gives up after 3 s.
 */
import { ConvexError } from 'convex/values'

export type SentryDsn = { publicKey: string; envelopeUrl: string; dsn: string }

/** Parse https://<key>@<host>[/<path>]/<projectId>; null when absent or malformed. */
export function parseDsn(dsn: string | undefined | null): SentryDsn | null {
  if (!dsn?.trim()) return null
  try {
    const u = new URL(dsn.trim())
    const parts = u.pathname.split('/').filter(Boolean)
    const projectId = parts.pop()
    if (!u.username || !projectId || !/^https?:$/.test(u.protocol)) return null
    const prefix = parts.length ? `/${parts.join('/')}` : ''
    return {
      publicKey: u.username,
      dsn: dsn.trim(),
      envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/?sentry_key=${u.username}&sentry_version=7`,
    }
  } catch {
    return null
  }
}

export type ReportContext = {
  /** Where it happened: a Convex function name or a page path (no query string). */
  readonly transaction?: string
  readonly environment?: string
  readonly release?: string
  readonly platform?: 'javascript' | 'node'
  readonly tags?: Record<string, string>
  readonly level?: 'error' | 'warning' | 'fatal'
}

function eventId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function describe(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) {
    return { type: error.name || 'Error', value: error.message.slice(0, 2000), stack: error.stack?.slice(0, 8000) }
  }
  return { type: 'NonError', value: String(error).slice(0, 2000) }
}

/** Envelope body (three newline-separated JSON lines). */
export function buildEnvelope(dsn: SentryDsn, error: unknown, context: ReportContext = {}, now = new Date()): string {
  const id = eventId()
  const { type, value, stack } = describe(error)
  const event = {
    event_id: id,
    timestamp: now.getTime() / 1000,
    platform: context.platform ?? 'javascript',
    level: context.level ?? 'error',
    environment: context.environment,
    release: context.release,
    transaction: context.transaction,
    tags: context.tags,
    exception: { values: [{ type, value }] },
    extra: stack ? { stack } : undefined,
  }
  return [
    JSON.stringify({ event_id: id, sent_at: now.toISOString(), dsn: dsn.dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n')
}

/** Expected refusals (user errors, auth codes) are not bugs. */
export function isReportable(error: unknown): boolean {
  if (error instanceof ConvexError) return false
  const data = (error as { data?: unknown } | null)?.data
  if (data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string') return false
  return true
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Send one error. Resolves to true when sent; never throws. */
export async function reportError(
  dsnString: string | undefined | null,
  error: unknown,
  context: ReportContext = {},
  fetchImpl: FetchLike = (i, init) => globalThis.fetch(i, init),
): Promise<boolean> {
  const dsn = parseDsn(dsnString)
  if (!dsn || !isReportable(error)) return false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    try {
      const res = await fetchImpl(dsn.envelopeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        body: buildEnvelope(dsn, error, context),
        signal: controller.signal,
        keepalive: true,
      })
      return res.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

/**
 * Run an action/httpAction body: unexpected errors are reported to SENTRY_DSN
 * (when set) and rethrown unchanged. Use inside the handler so Convex still
 * infers `args`: `handler: (ctx, args) => withErrorReporting('mod:fn', async () => …)`.
 * Queries and mutations cannot fetch; their errors are in the Convex logs.
 */
export async function withErrorReporting<R>(name: string, body: () => Promise<R>): Promise<R> {
  try {
    return await body()
  } catch (error) {
    await reportError(process.env.SENTRY_DSN, error, {
      transaction: name,
      platform: 'node',
      environment: process.env.SENTRY_ENVIRONMENT,
      tags: { runtime: 'convex' },
    })
    throw error
  }
}
