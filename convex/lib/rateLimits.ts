import { HOUR, MINUTE, RateLimiter } from '@convex-dev/rate-limiter'
import { components } from '../_generated/api'

/**
 * Application rate limits (D-017, doc 18 §8). Keys are noted per limit.
 * Each send to a phone costs the company (or the platform) money, so limits
 * are tight and checked before anything is sent.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  /** Test messages from Settings, key = companyId. */
  messagingTestPerCompany: { kind: 'fixed window', rate: 10, period: HOUR },
  /** Phone sign-in codes, key = E.164 phone (consumed for unknown numbers too). */
  loginCodePerPhone: { kind: 'fixed window', rate: 3, period: 15 * MINUTE },
  loginCodePerPhoneDaily: { kind: 'fixed window', rate: 10, period: 24 * HOUR },
  /** Phone sign-in codes, key = companyId. */
  loginCodePerCompany: { kind: 'fixed window', rate: 100, period: HOUR },
  /** Phone sign-in codes across the platform (no key). */
  loginCodeGlobal: { kind: 'fixed window', rate: 500, period: HOUR },
  /** Two-step and enrolment codes, key = userId. */
  mfaCodePerUser: { kind: 'fixed window', rate: 5, period: 15 * MINUTE },
  /** Public API requests (INT-004), key = apiKeyId. Bursts up to 60. */
  apiPerKey: { kind: 'token bucket', rate: 120, period: MINUTE, capacity: 60 },
  /** Public API requests across all of a company's keys, key = companyId. */
  apiPerCompany: { kind: 'token bucket', rate: 600, period: MINUTE, capacity: 200 },
  /** Webhook test sends from the UI (INT-005), key = companyId. */
  webhookTestPerCompany: { kind: 'fixed window', rate: 20, period: HOUR },
})

/** Six-digit codes: lifetime, wrong tries allowed, and resend cooldown. */
export const OTP_TTL_MS = 10 * MINUTE
export const OTP_MAX_ATTEMPTS = 5
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000

/** Human sentence for a refused request ("Try again in 4 minutes."). */
export function retryAfterText(retryAfterMs: number | undefined): string {
  const ms = Math.max(0, retryAfterMs ?? 0)
  if (ms < 60_000) return `Try again in ${Math.max(1, Math.ceil(ms / 1000))} seconds.`
  const minutes = Math.ceil(ms / MINUTE)
  return `Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}
