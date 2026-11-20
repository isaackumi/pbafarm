/**
 * AI protections (D-023, docs/architecture/09 §14): pure rules shared by
 * the Convex guard (convex/aiGuard.ts), every AI call path and the Next
 * proxy. No database, no clock reads: "now" is passed in.
 *
 * 1. Concurrency: at most N in-flight calls per user, per company and for
 *    the platform's shared server key (leases, convex/aiGuard.ts).
 * 2. Monthly budget per company and per key, from llmUsage costs (tokens
 *    when a model has no price). Warn at 80% and 100%, refuse at 100%.
 * 3. Circuit breaker per key scope + provider + model, with one Auto
 *    fallback and an overall deadline per question.
 */
import { classifyLlmFailure, type LlmFailureKind } from './llmErrors'

type Env = Record<string, string | undefined>

function envNumber(env: Env, name: string, fallback: number, o: { min?: number; max?: number } = {}): number {
  const raw = env[name]
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, n))
}

function envOptional(env: Env, name: string): number | null {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ---------------------------------------------------------------------------
// Settings (env)
// ---------------------------------------------------------------------------

export type GuardSettings = {
  /** In-flight calls per user (AI_MAX_INFLIGHT_PER_USER, default 2). */
  perUser: number
  /** In-flight calls per company (AI_MAX_INFLIGHT_PER_COMPANY, default 10). */
  perCompany: number
  /** In-flight calls on the shared server key, all tenants (AI_MAX_INFLIGHT_SERVER, default 40). */
  server: number
  /** Overall deadline per question (AI_QUESTION_DEADLINE_MS, default 45 s). */
  deadlineMs: number
  /** First attempt's share, so an Auto fallback still has time (AI_ATTEMPT_TIMEOUT_MS, default 28 s). */
  attemptMs: number
  /** Breaker: overload/5xx/timeout failures inside 60 s that open it (AI_BREAKER_FAILURES, default 2; quota opens at once). */
  breakerFailures: number
  /** Breaker open time for overload/5xx/timeout (AI_BREAKER_OPEN_MS, default 60 s). */
  breakerOpenMs: number
  /** Platform default monthly budget per tenant, USD (AI_COMPANY_MONTHLY_BUDGET_USD; unset = none). */
  companyBudgetUsd: number | null
  /** Platform default monthly token budget per tenant for unpriced models (AI_COMPANY_MONTHLY_TOKENS). */
  companyBudgetTokens: number | null
  /** All server keys together, USD per month (AI_SERVER_MONTHLY_BUDGET_USD). */
  serverBudgetUsd: number | null
  /** Largest share (0–1) of the server-key monthly budget one tenant may use. */
  serverTenantShare: number
}

export function guardSettings(env: Env = process.env): GuardSettings {
  const deadlineMs = envNumber(env, 'AI_QUESTION_DEADLINE_MS', 45_000, { min: 5_000, max: 120_000 })
  return {
    perUser: Math.floor(envNumber(env, 'AI_MAX_INFLIGHT_PER_USER', 2, { min: 1, max: 20 })),
    perCompany: Math.floor(envNumber(env, 'AI_MAX_INFLIGHT_PER_COMPANY', 10, { min: 1, max: 500 })),
    server: Math.floor(envNumber(env, 'AI_MAX_INFLIGHT_SERVER', 40, { min: 1, max: 2000 })),
    deadlineMs,
    attemptMs: Math.min(deadlineMs, envNumber(env, 'AI_ATTEMPT_TIMEOUT_MS', 28_000, { min: 2_000, max: 120_000 })),
    breakerFailures: Math.floor(envNumber(env, 'AI_BREAKER_FAILURES', 2, { min: 1, max: 50 })),
    breakerOpenMs: envNumber(env, 'AI_BREAKER_OPEN_MS', 60_000, { min: 5_000, max: 3_600_000 }),
    companyBudgetUsd: envOptional(env, 'AI_COMPANY_MONTHLY_BUDGET_USD'),
    companyBudgetTokens: envOptional(env, 'AI_COMPANY_MONTHLY_TOKENS'),
    serverBudgetUsd: envOptional(env, 'AI_SERVER_MONTHLY_BUDGET_USD'),
    serverTenantShare: envNumber(env, 'AI_SERVER_TENANT_SHARE', 0.25, { min: 0.01, max: 1 }),
  }
}

/** Per provider server-key budget: AI_SERVER_MONTHLY_BUDGET_USD_<PROVIDER>. */
export function serverProviderBudgetUsd(providerId: string, env: Env = process.env): number | null {
  return envOptional(env, `AI_SERVER_MONTHLY_BUDGET_USD_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`)
}

/** A lease outlives the call deadline by this margin, then expires on its own. */
export const LEASE_MARGIN_MS = 30_000

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

export type InFlight = { user: number | null; company: number; server: number | null }

/** Which cap refuses a new call, or null. `user`/`server` null = not counted for this call. */
export function concurrencyRefusal(n: InFlight, s: Pick<GuardSettings, 'perUser' | 'perCompany' | 'server'>): 'user' | 'company' | 'server' | null {
  if (n.user !== null && n.user >= s.perUser) return 'user'
  if (n.company >= s.perCompany) return 'company'
  if (n.server !== null && n.server >= s.server) return 'server'
  return null
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** Calendar month in UTC: "2026-11". */
export function monthOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7)
}

/** First instant of the next UTC month. */
export function nextMonthStart(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

export type Spend = { costUsd: number; unpricedTokens: number }
export type Budget = { usd: number | null; tokens: number | null }

/** Share of the budget used (0..∞), the larger of money and unpriced tokens; null when no budget is set. */
export function budgetUsed(spend: Spend, budget: Budget): number | null {
  const parts: number[] = []
  if (budget.usd !== null && budget.usd > 0) parts.push(spend.costUsd / budget.usd)
  if (budget.tokens !== null && budget.tokens > 0) parts.push(spend.unpricedTokens / budget.tokens)
  return parts.length ? Math.max(...parts) : null
}

/** The tightest of the budgets that are set (the org can only lower the platform's). */
export function tighter(...values: Array<number | null | undefined>): number | null {
  const set = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0)
  return set.length ? Math.min(...set) : null
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export type BreakerState = {
  failures: number
  windowStart: number
  /** 0 = closed. In the past = half-open (the next call is a probe). */
  openUntil: number
  /** Consecutive opens, for the back-off of a failed probe. */
  opens: number
  lastKind?: string
  /** A quota "limit: 0" refusal: the key has no allowance for this model. */
  refused?: boolean
}

export const CLOSED: BreakerState = { failures: 0, windowStart: 0, openUntil: 0, opens: 0 }
const WINDOW_MS = 60_000
const MAX_OPEN_MS = 10 * 60_000
const QUOTA_MIN_OPEN_MS = 15 * 60_000
/** A quota breaker never stays open longer than a day, whatever retry-after says. */
export const QUOTA_MAX_OPEN_MS = 24 * 60 * 60_000

export function breakerPhase(b: BreakerState, now: number): 'closed' | 'open' | 'half_open' {
  if (!b.openUntil) return 'closed'
  return b.openUntil > now ? 'open' : 'half_open'
}

/** Failure kinds that count against a model (not the question's fault). */
export const BREAKER_KINDS: ReadonlySet<LlmFailureKind> = new Set(['quota', 'rate_limited', 'unavailable', 'timeout'])

/** Kinds where Auto may try the next model once. */
export const FALLBACK_KINDS: ReadonlySet<LlmFailureKind> = new Set(['quota', 'rate_limited', 'unavailable', 'timeout', 'model_unavailable', 'empty'])

/** Next UTC midnight: daily free-tier quotas reset then. */
function nextUtcMidnight(now: number): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

/** Whether a quota message says the key has no allowance at all for the model. */
export function isZeroQuota(message: string): boolean {
  return /limit:\s*0\b/i.test(message)
}

/** The breaker after one call. */
export function nextBreaker(
  b: BreakerState,
  outcome: { ok: true } | { ok: false; kind: LlmFailureKind; retryAfterSec: number | null; zeroQuota?: boolean },
  now: number,
  s: Pick<GuardSettings, 'breakerFailures' | 'breakerOpenMs'>,
): BreakerState {
  if (outcome.ok) return { ...CLOSED }
  if (!BREAKER_KINDS.has(outcome.kind)) return b
  const phase = breakerPhase(b, now)
  const inWindow = b.windowStart && now - b.windowStart < WINDOW_MS
  const failures = (inWindow ? b.failures : 0) + 1
  const windowStart = inWindow ? b.windowStart : now
  // Retry-after comes from provider text: capped so no message can pause a model for long.
  const retryMs = Math.min((outcome.retryAfterSec ?? 0) * 1000, outcome.kind === 'quota' ? QUOTA_MAX_OPEN_MS : MAX_OPEN_MS)
  if (outcome.kind === 'quota') {
    // Until the provider's retry-after or longer; "limit: 0" until the daily reset.
    const until = outcome.zeroQuota
      ? Math.max(nextUtcMidnight(now), now + retryMs)
      : now + Math.max(QUOTA_MIN_OPEN_MS, retryMs)
    return { failures, windowStart, openUntil: until, opens: b.opens + 1, lastKind: 'quota', refused: !!outcome.zeroQuota }
  }
  // A failed probe reopens at once, for twice as long (capped).
  if (phase === 'half_open') {
    const ms = Math.min(MAX_OPEN_MS, s.breakerOpenMs * 2 ** Math.min(b.opens, 4))
    return { failures, windowStart, openUntil: now + Math.max(ms, retryMs), opens: b.opens + 1, lastKind: outcome.kind }
  }
  if (phase === 'open') return { ...b, failures, windowStart, lastKind: outcome.kind }
  if (failures >= s.breakerFailures) {
    return { failures, windowStart, openUntil: now + Math.max(s.breakerOpenMs, retryMs), opens: b.opens + 1, lastKind: outcome.kind }
  }
  return { ...b, failures, windowStart, lastKind: outcome.kind }
}

/** Breaker id: whose key ('server' or the company id), provider, model. */
export function breakerKey(scope: string, providerId: string, model: string): string {
  return `${scope}|${providerId}|${model}`
}

// ---------------------------------------------------------------------------
// One question: deadline, attempts, Auto fallback
// ---------------------------------------------------------------------------

export type GuardFailureKind = LlmFailureKind | 'not_configured'

export type Target = {
  providerId: string
  model: string
  /** 'server' or the company id: whose key, for the breaker. */
  scope: string
}

export type AttemptOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown; message: string; status: number | null }

export type GuardedResult<T, X extends Target> =
  | { ok: true; value: T; target: X; fallback: boolean; attempts: number }
  | {
      ok: false
      kind: GuardFailureKind
      retryAfterSec: number | null
      message: string
      /** Provider HTTP status of the last failure, when it answered. */
      status: number | null
      target: X | null
      attempts: number
    }

/**
 * Tests that fake timers and then run them all (vi.runAllTimers) would fire
 * every deadline at once; they turn the deadline timers off here. Production
 * never touches this.
 */
export const deadlineTestHooks: { disabled: boolean } = { disabled: false }

/** Thrown into an attempt when the question's deadline passes. */
export class DeadlineError extends Error {
  constructor(ms: number) {
    super(`did not answer within ${Math.round(ms / 1000)} s (deadline)`)
    this.name = 'DeadlineError'
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : 'error'
}

function statusOf(err: unknown): number | null {
  const e = err as { status?: unknown; statusCode?: unknown } | null
  const s = e?.status ?? e?.statusCode
  return typeof s === 'number' ? s : null
}

/**
 * Run one question with the protections: refuse an explicitly chosen model
 * whose breaker is open, give each attempt what is left of the deadline (the
 * first at most `attemptMs`), and when the member chose Auto retry ONCE on
 * the next target after a model failure. `record` logs every attempt (usage,
 * spend, breaker); `canRetry` says no side effect happened (agent drafts).
 */
export async function runGuarded<T, X extends Target>(o: {
  now: () => number
  deadlineAt: number
  attemptMs: number
  explicit: boolean
  blocked: ReadonlySet<string>
  first: () => Promise<X | null>
  next: (failed: X, tried: ReadonlySet<string>) => Promise<X | null>
  attempt: (target: X, signal: AbortSignal) => Promise<T>
  record: (target: X, outcome: { ok: boolean; message?: string; status?: number | null; durationMs: number; value?: T }) => Promise<void>
  canRetry?: () => boolean
}): Promise<GuardedResult<T, X>> {
  let target = await o.first()
  if (!target) return { ok: false, kind: 'not_configured', retryAfterSec: null, message: 'No AI key or model', status: null, target: null, attempts: 0 }
  const tried = new Set<string>()
  let attempts = 0
  let lastFailure: { kind: GuardFailureKind; retryAfterSec: number | null; message: string; status: number | null } | null = null
  while (target && attempts < 2) {
    const key = breakerKey(target.scope, target.providerId, target.model)
    if (o.blocked.has(key)) {
      if (o.explicit) {
        return { ok: false, kind: 'model_paused', retryAfterSec: null, message: `${target.model} is paused (breaker open)`, status: null, target, attempts }
      }
      tried.add(key)
      target = await o.next(target, tried)
      continue
    }
    tried.add(key)
    const left = deadlineTestHooks.disabled ? o.attemptMs : o.deadlineAt - o.now()
    if (left < 1_000) break
    const budget = attempts === 0 ? Math.min(left, o.attemptMs) : left
    attempts += 1
    const started = o.now()
    const outcome = await withDeadline((signal) => o.attempt(target as X, signal), budget)
    const durationMs = o.now() - started
    if (outcome.ok) {
      await o.record(target, { ok: true, durationMs, value: outcome.value })
      return { ok: true, value: outcome.value, target, fallback: attempts > 1, attempts }
    }
    await o.record(target, { ok: false, message: outcome.message, status: outcome.status, durationMs })
    const f = classifyLlmFailure({ status: outcome.status, message: outcome.message })
    lastFailure = { kind: f.kind, retryAfterSec: f.retryAfterSec, message: outcome.message, status: outcome.status }
    if (o.explicit || !FALLBACK_KINDS.has(f.kind) || attempts >= 2 || (o.canRetry && !o.canRetry())) {
      return { ok: false, ...lastFailure, target, attempts }
    }
    const failed: X = target
    target = await o.next(failed, tried)
    if (!target) return { ok: false, ...lastFailure, target: failed, attempts }
  }
  if (lastFailure) return { ok: false, ...lastFailure, target, attempts }
  if (!target) return { ok: false, kind: 'model_paused', retryAfterSec: null, message: 'Every model is paused', status: null, target: null, attempts }
  return { ok: false, kind: 'timeout', retryAfterSec: null, message: 'deadline passed', status: null, target, attempts }
}

/** Run `fn` with an abort signal that fires after `ms`; a late answer becomes a DeadlineError. */
export async function withDeadline<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<AttemptOutcome<T>> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    if (deadlineTestHooks.disabled) return
    timer = setTimeout(() => {
      const err = new DeadlineError(ms)
      controller.abort(err)
      reject(err)
    }, ms)
  })
  try {
    const value = await Promise.race([fn(controller.signal), deadline])
    return { ok: true, value }
  } catch (err) {
    const timedOut = controller.signal.aborted
    const message = timedOut ? new DeadlineError(ms).message : messageOf(err)
    return { ok: false, error: err, message, status: timedOut ? null : statusOf(err) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Health and alerts (5-minute check, platform console)
// ---------------------------------------------------------------------------

export type UsageSample = {
  companyId: string
  providerId: string
  ok: boolean
  durationMs?: number
  costUsd?: number
}

export type HealthStats = { calls: number; errors: number; errorRate: number; p95Ms: number | null; costUsd: number }

/** Nearest-rank percentile of `values` (unsorted); null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[rank]
}

export function healthOf(rows: UsageSample[]): HealthStats {
  const calls = rows.length
  const errors = rows.filter((r) => !r.ok).length
  const durations = rows.map((r) => r.durationMs).filter((d): d is number => typeof d === 'number')
  const costUsd = rows.reduce((a, r) => a + (r.costUsd ?? 0), 0)
  return { calls, errors, errorRate: calls ? errors / calls : 0, p95Ms: percentile(durations, 0.95), costUsd: Math.round(costUsd * 10_000) / 10_000 }
}

/** Rows grouped by a key (provider, tenant). */
export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = out.get(k)
    if (list) list.push(r)
    else out.set(k, [r])
  }
  return out
}

export type AlertSettings = {
  /** Error share that alerts (AI_ALERT_ERROR_RATE, default 0.25). */
  errorRate: number
  /** Calls needed in the window before rates count (AI_ALERT_MIN_CALLS, default 20). */
  minCalls: number
  /** p95 latency that alerts (AI_ALERT_P95_MS, default 30 s). */
  p95Ms: number
  /** Spend in the window that alerts when it is also a spike (AI_ALERT_COST_USD, default 5). */
  costUsd: number
  /** Spike = this many times the previous window (AI_ALERT_COST_SPIKE_X, default 4). */
  spikeX: number
}

export function alertSettings(env: Env = process.env): AlertSettings {
  return {
    errorRate: envNumber(env, 'AI_ALERT_ERROR_RATE', 0.25, { min: 0.01, max: 1 }),
    minCalls: Math.floor(envNumber(env, 'AI_ALERT_MIN_CALLS', 20, { min: 1, max: 100_000 })),
    p95Ms: envNumber(env, 'AI_ALERT_P95_MS', 30_000, { min: 1_000, max: 600_000 }),
    costUsd: envNumber(env, 'AI_ALERT_COST_USD', 5, { min: 0.01, max: 1_000_000 }),
    spikeX: envNumber(env, 'AI_ALERT_COST_SPIKE_X', 4, { min: 1, max: 1000 }),
  }
}

export type HealthAlert = { kind: 'error_rate' | 'latency' | 'cost_spike'; message: string }

/** Alerts for one provider or tenant: this window's stats against the previous window's spend. */
export function healthAlerts(label: string, now: HealthStats, prevCostUsd: number, s: AlertSettings): HealthAlert[] {
  const out: HealthAlert[] = []
  if (now.calls >= s.minCalls && now.errorRate >= s.errorRate) {
    out.push({ kind: 'error_rate', message: `${label}: ${Math.round(now.errorRate * 100)}% of ${now.calls} AI calls failed in the last 15 minutes` })
  }
  if (now.calls >= s.minCalls && now.p95Ms !== null && now.p95Ms >= s.p95Ms) {
    out.push({ kind: 'latency', message: `${label}: p95 AI latency ${Math.round(now.p95Ms / 1000)} s over ${now.calls} calls` })
  }
  if (now.costUsd >= s.costUsd && now.costUsd >= s.spikeX * Math.max(prevCostUsd, 0.0001)) {
    out.push({ kind: 'cost_spike', message: `${label}: AI spend $${now.costUsd.toFixed(2)} in 15 minutes (previous 15 minutes $${prevCostUsd.toFixed(2)})` })
  }
  return out
}
