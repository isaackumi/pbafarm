/**
 * Cloudflare Turnstile server-side check (CF-003, doc 14 §2.7, doc 17 Stage 2).
 *
 * `siteverify` is an Effect program (D-019): one POST to Cloudflare through
 * the Fetch service, per-attempt timeout, transient-only retry and a Schema
 * check of the body. Retries are safe because every attempt carries the same
 * `idempotency_key`, which Cloudflare uses to de-duplicate a token's check.
 *
 * Gated by TURNSTILE_SECRET_KEY on the Convex deployment: unset, no check is
 * made and no ticket is required (dev, CI, previews).
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { requestJsonAs, type Fetch, type HttpError, type HttpPolicy } from './effectHttp'
import { UserFacingError } from './effect'

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
export const TURNSTILE_SECRET_ENV = 'TURNSTILE_SECRET_KEY'
/** Optional: comma-separated hostnames the widget may run on. */
export const TURNSTILE_HOSTNAMES_ENV = 'TURNSTILE_ALLOWED_HOSTNAMES'
/** A ticket must be used within this window (Turnstile tokens live 300 s). */
export const HUMAN_TICKET_TTL_MS = 5 * 60 * 1000

export const HUMAN_PURPOSES = ['signup', 'register_company', 'password_reset', 'invite_accept'] as const
export type HumanPurpose = (typeof HUMAN_PURPOSES)[number]

export function isHumanPurpose(value: unknown): value is HumanPurpose {
  return typeof value === 'string' && (HUMAN_PURPOSES as readonly string[]).includes(value)
}

export function turnstileSecret(): string | null {
  const raw = process.env[TURNSTILE_SECRET_ENV]
  return raw && raw.trim() ? raw.trim() : null
}

/** Whether human checks are on for this deployment. */
export function turnstileRequired(): boolean {
  return turnstileSecret() !== null
}

export const SiteverifyResponse = Schema.Struct({
  success: Schema.Boolean,
  'error-codes': Schema.optional(Schema.Array(Schema.String)),
  hostname: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
  challenge_ts: Schema.optional(Schema.String),
})

/** Cloudflare could not be reached or answered oddly: not the person's fault, retry later. */
export class TurnstileUnavailable extends Data.TaggedError('TurnstileUnavailable')<{
  readonly message: string
}> {}

export type SiteverifyInput = {
  secret: string
  token: string
  /** Widget action: must equal the purpose the ticket is for. */
  expectedAction: HumanPurpose
  /** Hostnames allowed; empty = any. */
  allowedHostnames?: readonly string[]
  remoteip?: string
  idempotencyKey: string
}

/** Verify a widget token. Fails UserFacingError when the challenge did not pass. */
export function siteverify(
  input: SiteverifyInput,
  policy: HttpPolicy = { timeoutMs: 8_000, retries: 2 },
): Effect.Effect<void, UserFacingError | TurnstileUnavailable, Fetch> {
  const failed = (reason: string) =>
    new UserFacingError({
      code: 'FORBIDDEN',
      message: 'We could not confirm you are human. Complete the check again and retry.',
      details: { reason },
    })
  if (!input.token || input.token.length > 2048) return Effect.fail(failed('TURNSTILE_TOKEN_INVALID'))
  return requestJsonAs(
    SiteverifyResponse,
    {
      url: SITEVERIFY_URL,
      method: 'POST',
      body: {
        secret: input.secret,
        response: input.token,
        idempotency_key: input.idempotencyKey,
        ...(input.remoteip ? { remoteip: input.remoteip } : {}),
      },
    },
    policy,
  ).pipe(
    Effect.mapError((e: HttpError) => new TurnstileUnavailable({ message: e.message })),
    Effect.flatMap((body) => {
      if (!body.success) return Effect.fail(failed('TURNSTILE_FAILED'))
      if (body.action !== undefined && body.action !== input.expectedAction) {
        return Effect.fail(failed('TURNSTILE_ACTION_MISMATCH'))
      }
      const hosts = input.allowedHostnames ?? []
      if (hosts.length > 0 && (!body.hostname || !hosts.includes(body.hostname))) {
        return Effect.fail(failed('TURNSTILE_HOSTNAME_MISMATCH'))
      }
      return Effect.void
    }),
  )
}

export function allowedHostnames(): string[] {
  return (process.env[TURNSTILE_HOSTNAMES_ENV] ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}
