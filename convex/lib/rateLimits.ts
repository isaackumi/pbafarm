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
})

/** Human sentence for a refused request ("Try again in 4 minutes."). */
export function retryAfterText(retryAfterMs: number | undefined): string {
  const ms = Math.max(0, retryAfterMs ?? 0)
  if (ms < 60_000) return `Try again in ${Math.max(1, Math.ceil(ms / 1000))} seconds.`
  const minutes = Math.ceil(ms / MINUTE)
  return `Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}
