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
  /** Failed password sign-ins (CF-003), key = normalized email; refused when used up. */
  signInFailPerEmail: { kind: 'fixed window', rate: 20, period: HOUR },
  /**
   * Failed password sign-ins across the platform (no key). Convex does not
   * expose the caller's IP to auth actions, so this stands in for a per-IP
   * limit: when used up, every password sign-in needs the human check
   * (never a hard block, which would lock everyone out).
   */
  signInFailGlobal: { kind: 'fixed window', rate: 300, period: 10 * MINUTE },
  /** Two-step and enrolment codes, key = userId. */
  mfaCodePerUser: { kind: 'fixed window', rate: 5, period: 15 * MINUTE },
  /** Public API requests (INT-004), key = apiKeyId. Bursts up to 60. */
  apiPerKey: { kind: 'token bucket', rate: 120, period: MINUTE, capacity: 60 },
  /** Public API requests across all of a company's keys, key = companyId. */
  apiPerCompany: { kind: 'token bucket', rate: 600, period: MINUTE, capacity: 200 },
  /** Webhook test sends from the UI (INT-005), key = companyId. */
  webhookTestPerCompany: { kind: 'fixed window', rate: 20, period: HOUR },
  /** Inbound webhook requests (INT-003), key = inbound webhook id. */
  inboundPerWebhook: { kind: 'token bucket', rate: 600, period: MINUTE, capacity: 200 },
  /** Rejected inbound requests written to the log, key = inbound webhook id. */
  inboundRejectLogPerWebhook: { kind: 'fixed window', rate: 60, period: HOUR },
  /** Assistant calls on the organization's own key (INT-009), key = userId. Same as the Next proxy. */
  llmPerUserMinute: { kind: 'fixed window', rate: 10, period: MINUTE },
  llmPerUserHour: { kind: 'fixed window', rate: 100, period: HOUR },
  /** key = companyId. */
  llmPerCompanyHour: { kind: 'fixed window', rate: 500, period: HOUR },
  /** Usage rows reported by the Next proxy for server-key calls, key = userId. */
  llmUsageReportPerUser: { kind: 'fixed window', rate: 150, period: HOUR },
  /** Model-list lookups with a pasted key (AI settings), key = userId. */
  llmModelPreviewPerUser: { kind: 'fixed window', rate: 30, period: HOUR },
  /** Live model lists for the org's keys (assistant picker, AI settings), key = userId. */
  llmModelListPerUser: { kind: 'fixed window', rate: 120, period: HOUR },
  /**
   * Ask Anowa stream rows started (AI-009), key = userId. Bounds rows a member
   * can create even when the turn fails before it spends LLM quota.
   */
  assistantStreamStartPerUser: { kind: 'token bucket', rate: 30, period: MINUTE, capacity: 10 },
  /**
   * Attachment upload URLs (CF-005), key = userId / companyId. Bounds orphaned
   * R2 objects. An image with a thumbnail (CF-004) takes two tokens, so the
   * budget is 40 photos (80 documents) in a burst per user.
   */
  uploadUrlPerUser: { kind: 'token bucket', rate: 240, period: HOUR, capacity: 80 },
  uploadUrlPerCompany: { kind: 'token bucket', rate: 1200, period: HOUR, capacity: 300 },
  /** Sensor threshold alerts (ANLY-006), key = `${unitId}:${parameter}`. */
  sensorBreachAlertPerUnit: { kind: 'fixed window', rate: 1, period: HOUR },
  /** Farm bot (BOT-001, doc 23) messages handled, key = channelBindings id. */
  botPerBinding: { kind: 'token bucket', rate: 30, period: MINUTE, capacity: 10 },
  botPerBindingHour: { kind: 'fixed window', rate: 300, period: HOUR },
  /** All of a company's bot messages, key = companyId. */
  botPerCompany: { kind: 'token bucket', rate: 300, period: MINUTE, capacity: 100 },
  /** Replies to unbound chats (onboarding, LINK attempts), key = `${provider}:${address}`. */
  botUnboundPerAddress: { kind: 'fixed window', rate: 10, period: HOUR },
  /** Unbound replies across the platform (no key): bounds what spam can cost. */
  botUnboundGlobal: { kind: 'fixed window', rate: 500, period: HOUR },
  /** Connect codes from /account, key = userId. */
  botConnectCodePerUser: { kind: 'fixed window', rate: 10, period: HOUR },
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
