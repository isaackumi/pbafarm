import { describe, expect, test } from 'vitest'
import {
  CLOSED,
  breakerKey,
  breakerPhase,
  budgetUsed,
  concurrencyRefusal,
  guardSettings,
  healthAlerts,
  healthOf,
  isZeroQuota,
  monthOf,
  nextBreaker,
  nextMonthStart,
  percentile,
  runGuarded,
  tighter,
  withDeadline,
  type Target,
} from './aiGuard'
import { resolveModel } from './llmModels'

const S = { breakerFailures: 2, breakerOpenMs: 60_000 }
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0)

describe('settings (env)', () => {
  test('defaults and clamping', () => {
    const s = guardSettings({})
    expect(s).toMatchObject({ perUser: 2, perCompany: 10, server: 40, deadlineMs: 45_000, attemptMs: 28_000, companyBudgetUsd: null })
    const t = guardSettings({ AI_MAX_INFLIGHT_PER_USER: '0', AI_QUESTION_DEADLINE_MS: '10000', AI_ATTEMPT_TIMEOUT_MS: '60000', AI_COMPANY_MONTHLY_BUDGET_USD: '25' })
    expect(t.perUser).toBe(1)
    // The first attempt never gets more than the whole question.
    expect(t.attemptMs).toBe(10_000)
    expect(t.companyBudgetUsd).toBe(25)
    expect(guardSettings({ AI_COMPANY_MONTHLY_BUDGET_USD: 'abc' }).companyBudgetUsd).toBeNull()
  })
})

describe('concurrency caps', () => {
  const caps = { perUser: 2, perCompany: 10, server: 40 }
  test('user, then company, then the shared server key', () => {
    expect(concurrencyRefusal({ user: 1, company: 9, server: 39 }, caps)).toBeNull()
    expect(concurrencyRefusal({ user: 2, company: 0, server: 0 }, caps)).toBe('user')
    expect(concurrencyRefusal({ user: 0, company: 10, server: 0 }, caps)).toBe('company')
    expect(concurrencyRefusal({ user: 0, company: 0, server: 40 }, caps)).toBe('server')
  })
  test('scheduled calls (no user) and org-key calls (no server count) skip those caps', () => {
    expect(concurrencyRefusal({ user: null, company: 3, server: null }, caps)).toBeNull()
  })
})

describe('budgets', () => {
  test('share used is the larger of money and unpriced tokens', () => {
    expect(budgetUsed({ costUsd: 8, unpricedTokens: 0 }, { usd: 10, tokens: null })).toBeCloseTo(0.8)
    expect(budgetUsed({ costUsd: 1, unpricedTokens: 900 }, { usd: 10, tokens: 1000 })).toBeCloseTo(0.9)
    expect(budgetUsed({ costUsd: 100, unpricedTokens: 100 }, { usd: null, tokens: null })).toBeNull()
  })
  test('the org can only tighten the platform budget', () => {
    expect(tighter(50, 20)).toBe(20)
    expect(tighter(undefined, 20)).toBe(20)
    expect(tighter(null, undefined)).toBeNull()
    expect(tighter(0, -1)).toBeNull()
  })
  test('calendar months in UTC', () => {
    expect(monthOf(NOW)).toBe('2026-11')
    expect(new Date(nextMonthStart(NOW)).toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(new Date(nextMonthStart(Date.UTC(2026, 11, 31, 23))).toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('circuit breaker', () => {
  test('opens after the threshold of overload/5xx/timeout failures in 60 s', () => {
    const one = nextBreaker(CLOSED, { ok: false, kind: 'unavailable', retryAfterSec: null }, NOW, S)
    expect(breakerPhase(one, NOW)).toBe('closed')
    const two = nextBreaker(one, { ok: false, kind: 'timeout', retryAfterSec: null }, NOW + 1_000, S)
    expect(breakerPhase(two, NOW + 1_000)).toBe('open')
    expect(two.openUntil).toBe(NOW + 1_000 + 60_000)
    // Failures outside the window start a new count.
    const late = nextBreaker(one, { ok: false, kind: 'timeout', retryAfterSec: null }, NOW + 61_000, S)
    expect(breakerPhase(late, NOW + 61_000)).toBe('closed')
  })

  test('half-open after the open time; a failed probe reopens longer, a success closes', () => {
    const open = nextBreaker(nextBreaker(CLOSED, { ok: false, kind: 'unavailable', retryAfterSec: null }, NOW, S), { ok: false, kind: 'unavailable', retryAfterSec: null }, NOW, S)
    const later = NOW + 61_000
    expect(breakerPhase(open, later)).toBe('half_open')
    const reopened = nextBreaker(open, { ok: false, kind: 'unavailable', retryAfterSec: null }, later, S)
    expect(breakerPhase(reopened, later)).toBe('open')
    expect(reopened.openUntil - later).toBe(120_000)
    expect(nextBreaker(open, { ok: true }, later, S)).toEqual(CLOSED)
  })

  test('quota opens at once until the retry-after or 15 minutes; "limit: 0" until the daily reset', () => {
    const q = nextBreaker(CLOSED, { ok: false, kind: 'quota', retryAfterSec: 3600 }, NOW, S)
    expect(q.openUntil).toBe(NOW + 3_600_000)
    expect(nextBreaker(CLOSED, { ok: false, kind: 'quota', retryAfterSec: 5 }, NOW, S).openUntil).toBe(NOW + 15 * 60_000)
    const zero = nextBreaker(CLOSED, { ok: false, kind: 'quota', retryAfterSec: null, zeroQuota: true }, NOW, S)
    expect(zero.refused).toBe(true)
    expect(new Date(zero.openUntil).toISOString()).toBe('2026-11-21T00:00:00.000Z')
    expect(isZeroQuota('Quota exceeded for metric ... limit: 0, model: gemini-2.5-pro')).toBe(true)
    expect(isZeroQuota('limit: 10')).toBe(false)
  })

  test('question problems (too long, blocked, auth) do not count against the model', () => {
    for (const kind of ['too_long', 'blocked', 'auth', 'model_unavailable'] as const) {
      expect(nextBreaker(CLOSED, { ok: false, kind, retryAfterSec: null }, NOW, S)).toEqual(CLOSED)
    }
  })
})

type T = Target & { tag?: string }
const target = (model: string, providerId = 'gemini'): T => ({ providerId, model, scope: 'server' })

function harness(o: {
  explicit?: boolean
  blocked?: string[]
  replies: Record<string, () => Promise<string>>
  next?: T[]
  canRetry?: () => boolean
  deadlineAt?: number
  attemptMs?: number
}) {
  const records: Array<{ model: string; ok: boolean; message?: string }> = []
  const queue = [...(o.next ?? [])]
  const run = () =>
    runGuarded<string, T>({
      now: Date.now,
      deadlineAt: o.deadlineAt ?? Date.now() + 45_000,
      attemptMs: o.attemptMs ?? 28_000,
      explicit: !!o.explicit,
      blocked: new Set(o.blocked ?? []),
      first: async () => target('m1'),
      next: async (_failed, tried) => {
        while (queue.length) {
          const t = queue.shift()!
          if (!tried.has(breakerKey(t.scope, t.providerId, t.model))) return t
        }
        return null
      },
      attempt: (t) => o.replies[t.model](),
      record: async (t, r) => {
        records.push({ model: t.model, ok: r.ok, message: r.message })
      },
      canRetry: o.canRetry,
    })
  return { run, records }
}

const fail = (message: string, status?: number) => () => Promise.reject(Object.assign(new Error(message), { status }))
const ok = (text: string) => () => Promise.resolve(text)

describe('one question: Auto fallback, explicit model, deadline', () => {
  test('Auto retries ONCE on the next model after a 503, and every attempt is recorded', async () => {
    const h = harness({ replies: { m1: fail('overloaded', 503), m2: ok('hello') }, next: [target('m2'), target('m3')] })
    const r = await h.run()
    expect(r).toMatchObject({ ok: true, value: 'hello', fallback: true, attempts: 2 })
    expect(h.records).toEqual([
      { model: 'm1', ok: false, message: 'overloaded' },
      { model: 'm2', ok: true, message: undefined },
    ])
  })

  test('never more than two attempts', async () => {
    const h = harness({ replies: { m1: fail('overloaded', 503), m2: fail('overloaded', 503), m3: ok('x') }, next: [target('m2'), target('m3')] })
    const r = await h.run()
    expect(r).toMatchObject({ ok: false, kind: 'unavailable', status: 503, attempts: 2 })
    expect(h.records.map((x) => x.model)).toEqual(['m1', 'm2'])
  })

  test('an explicitly chosen model does not switch silently', async () => {
    const h = harness({ explicit: true, replies: { m1: fail('overloaded', 503), m2: ok('x') }, next: [target('m2')] })
    const r = await h.run()
    expect(r).toMatchObject({ ok: false, kind: 'unavailable', attempts: 1 })
    expect(h.records.map((x) => x.model)).toEqual(['m1'])
  })

  test('an explicit model whose breaker is open is refused before any call: pick Auto or another model', async () => {
    const h = harness({ explicit: true, blocked: ['server|gemini|m1'], replies: { m1: ok('x') } })
    const r = await h.run()
    expect(r).toMatchObject({ ok: false, kind: 'model_paused', attempts: 0 })
    expect(h.records).toEqual([])
  })

  test('Auto skips a model whose breaker is open without calling it', async () => {
    const h = harness({ blocked: ['server|gemini|m1'], replies: { m1: ok('no'), m2: ok('yes') }, next: [target('m2')] })
    const r = await h.run()
    expect(r).toMatchObject({ ok: true, value: 'yes', attempts: 1 })
    expect(h.records.map((x) => x.model)).toEqual(['m2'])
  })

  test('no retry for question problems or once a tool wrote a draft', async () => {
    const tooLong = harness({ replies: { m1: fail('maximum context length exceeded', 400), m2: ok('x') }, next: [target('m2')] })
    expect(await tooLong.run()).toMatchObject({ ok: false, kind: 'too_long', attempts: 1 })
    const drafted = harness({ replies: { m1: fail('overloaded', 503), m2: ok('x') }, next: [target('m2')], canRetry: () => false })
    expect(await drafted.run()).toMatchObject({ ok: false, kind: 'unavailable', attempts: 1 })
  })

  test('the deadline cuts a slow attempt and leaves no time for a second one', async () => {
    const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 500))
    const started = Date.now()
    const h = harness({ replies: { m1: slow, m2: ok('x') }, next: [target('m2')], deadlineAt: Date.now() + 1_300, attemptMs: 50 })
    const r = await h.run()
    // m1 timed out after 50 ms; m2 had over 1 s left (the minimum for another attempt) and answered.
    expect(r).toMatchObject({ ok: true, value: 'x', fallback: true })
    expect(h.records[0]).toMatchObject({ model: 'm1', ok: false })
    expect(h.records[0].message).toMatch(/deadline/)
    // With under a second left no attempt starts: the member gets "took too long" now, not later.
    const none = harness({ replies: { m1: slow, m2: ok('x') }, next: [target('m2')], deadlineAt: Date.now() + 60, attemptMs: 50 })
    expect(await none.run()).toMatchObject({ ok: false, kind: 'timeout', attempts: 0 })
    expect(none.records).toEqual([])
    expect(Date.now() - started).toBeLessThan(1_500)
  })

  test('withDeadline aborts the attempt signal', async () => {
    let aborted = false
    const r = await withDeadline(
      (signal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true
          })
          setTimeout(() => resolve('late'), 200)
        }),
      20,
    )
    expect(r.ok).toBe(false)
    expect(aborted).toBe(true)
  })
})

describe('Auto picks around excluded models (resolveModel)', () => {
  const models = [
    { id: 'gemini-2.5-flash', vision: true },
    { id: 'gemini-2.5-flash-lite', vision: true },
    { id: 'gemini-2.5-pro', vision: true },
  ]
  test('the next best default when the best is excluded', () => {
    const base = resolveModel({ providerId: 'gemini', models, env: {} })
    expect(base).toMatchObject({ ok: true, model: 'gemini-2.5-flash' })
    expect(resolveModel({ providerId: 'gemini', models, env: {}, exclude: ['gemini-2.5-flash'] })).toMatchObject({ ok: true, model: 'gemini-2.5-flash-lite' })
    // An excluded saved model falls back too.
    expect(resolveModel({ providerId: 'gemini', models, env: {}, saved: 'gemini-2.5-pro', exclude: ['gemini-2.5-pro'] })).toMatchObject({ ok: true, model: 'gemini-2.5-flash' })
    expect(resolveModel({ providerId: 'gemini', models, env: {}, exclude: models.map((m) => m.id) }).ok).toBe(false)
  })
})

describe('health alerts', () => {
  const s = { errorRate: 0.25, minCalls: 20, p95Ms: 30_000, costUsd: 5, spikeX: 4 }
  const rows = (n: number, failed: number, ms = 1_000, cost = 0) =>
    Array.from({ length: n }, (_, i) => ({ companyId: 'c', providerId: 'p', ok: i >= failed, durationMs: ms, costUsd: cost }))
  test('p95 by nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5)
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95)).toBe(95)
    expect(percentile([], 0.95)).toBeNull()
  })
  test('error rate and latency need enough calls', () => {
    expect(healthAlerts('P', healthOf(rows(10, 9)), 0, s)).toEqual([])
    expect(healthAlerts('P', healthOf(rows(40, 10)), 0, s).map((a) => a.kind)).toEqual(['error_rate'])
    expect(healthAlerts('P', healthOf(rows(40, 0, 31_000)), 0, s).map((a) => a.kind)).toEqual(['latency'])
  })
  test('cost spike: over the floor and several times the previous window', () => {
    expect(healthAlerts('P', healthOf(rows(10, 0, 1_000, 1)), 1, s).map((a) => a.kind)).toEqual(['cost_spike'])
    expect(healthAlerts('P', healthOf(rows(10, 0, 1_000, 1)), 5, s)).toEqual([])
    expect(healthAlerts('P', healthOf(rows(2, 0, 1_000, 1)), 0, s)).toEqual([])
  })
})
