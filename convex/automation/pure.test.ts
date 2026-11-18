import { describe, expect, test } from 'vitest'
import * as Effect from 'effect/Effect'
import { evaluateConditions, renderTemplate, validateConditions } from './conditions'
import { inQuietHours, localParts, nextRunAt, zonedTimeToUtc } from './schedule'
import { sendAll } from './deliver'

const ctx = {
  payload: { dailyMortalityPct: 0.8, cumulativeMortalityPct: 3, dissolvedOxygen: 3.2, cageName: 'B2' },
  settings: { farmRules: { dailyMortalityAlertPct: 0.5, cumulativeMortalityAlertPct: 10 } },
  check: { count: 2 },
}

describe('conditions', () => {
  test('literal and field-to-field thresholds', () => {
    expect(evaluateConditions([{ field: 'payload.dissolvedOxygen', op: 'lt', value: 4 }], ctx)).toBe(true)
    expect(evaluateConditions([{ field: 'payload.dissolvedOxygen', op: 'lt', value: 3 }], ctx)).toBe(false)
    expect(
      evaluateConditions(
        [{ field: 'payload.dailyMortalityPct', op: 'gte', valueFrom: 'settings.farmRules.dailyMortalityAlertPct' }],
        ctx,
      ),
    ).toBe(true)
  })

  test('all vs any, empty list matches', () => {
    const conds = [
      { field: 'payload.dailyMortalityPct', op: 'gte' as const, valueFrom: 'settings.farmRules.dailyMortalityAlertPct' },
      { field: 'payload.cumulativeMortalityPct', op: 'gte' as const, valueFrom: 'settings.farmRules.cumulativeMortalityAlertPct' },
    ]
    expect(evaluateConditions(conds, ctx, 'all')).toBe(false)
    expect(evaluateConditions(conds, ctx, 'any')).toBe(true)
    expect(evaluateConditions([], ctx)).toBe(true)
  })

  test('a missing reading never trips a threshold', () => {
    expect(evaluateConditions([{ field: 'payload.temperatureC', op: 'lt', value: 20 }], ctx)).toBe(false)
    expect(evaluateConditions([{ field: 'payload.temperatureC', op: 'not_set' }], ctx)).toBe(true)
    expect(evaluateConditions([{ field: 'payload.cageName', op: 'eq', value: 'B2' }], ctx)).toBe(true)
    expect(evaluateConditions([{ field: 'payload.cageName', op: 'neq', value: 'B2' }], ctx)).toBe(false)
  })

  test('validation messages', () => {
    expect(validateConditions([{ field: 'payload.x', op: 'gt' }])).toMatch(/needs a value/)
    expect(validateConditions([{ field: 'payload.x', op: 'gt', value: 'abc' }])).toMatch(/number/)
    expect(validateConditions([{ field: '__proto__..x', op: 'is_set' }])).toMatch(/not a valid field/)
    expect(validateConditions([{ field: 'payload.x', op: 'is_set' }])).toBeNull()
  })

  test('templates render numbers and ignore unknown fields', () => {
    expect(renderTemplate('{{payload.cageName}} DO {{payload.dissolvedOxygen}} {{payload.nope}}!', ctx)).toBe(
      'B2 DO 3.2 !',
    )
    expect(renderTemplate('{{ check.count }}', { check: { count: 1 / 3 } })).toBe('0.33')
  })
})

describe('schedule (company time zone)', () => {
  test('UTC / Accra: 16:00 today if still ahead, else tomorrow', () => {
    const at = Date.UTC(2026, 10, 18, 10, 0)
    expect(new Date(nextRunAt({ localTime: '16:00' }, 'UTC', at)!).toISOString()).toBe('2026-11-18T16:00:00.000Z')
    expect(new Date(nextRunAt({ localTime: '16:00' }, 'Africa/Accra', Date.UTC(2026, 10, 18, 16, 0))!).toISOString()).toBe(
      '2026-11-19T16:00:00.000Z',
    )
  })

  test('other zones and weekdays', () => {
    // Nairobi is UTC+3: 07:00 local = 04:00 UTC. 2026-11-18 is a Wednesday; next Monday is the 23rd.
    const at = Date.UTC(2026, 10, 18, 12, 0)
    expect(new Date(nextRunAt({ localTime: '07:00', daysOfWeek: [1] }, 'Africa/Nairobi', at)!).toISOString()).toBe(
      '2026-11-23T04:00:00.000Z',
    )
    expect(localParts(Date.UTC(2026, 10, 18, 22, 30), 'Africa/Nairobi')).toMatchObject({ date: '2026-11-19', hhmm: '01:30' })
  })

  test('DST transitions (New York)', () => {
    // Before and after the March 2026 change (8 March): 09:00 local is 14:00 then 13:00 UTC.
    expect(new Date(zonedTimeToUtc(2026, 3, 7, 9, 0, 'America/New_York')).toISOString()).toBe('2026-03-07T14:00:00.000Z')
    expect(new Date(zonedTimeToUtc(2026, 3, 9, 9, 0, 'America/New_York')).toISOString()).toBe('2026-03-09T13:00:00.000Z')
    // 02:30 does not exist on 8 March: resolved after the gap.
    const gap = zonedTimeToUtc(2026, 3, 8, 2, 30, 'America/New_York')
    expect(localParts(gap, 'America/New_York').hour).toBe(3)
    // 01:30 happens twice on 1 November: the first one (EDT).
    expect(new Date(zonedTimeToUtc(2026, 11, 1, 1, 30, 'America/New_York')).toISOString()).toBe('2026-11-01T05:30:00.000Z')
    // A daily 09:00 schedule across the change keeps 09:00 local.
    const next = nextRunAt({ localTime: '09:00' }, 'America/New_York', Date.UTC(2026, 2, 8, 0, 0))!
    expect(localParts(next, 'America/New_York')).toMatchObject({ date: '2026-03-08', hhmm: '09:00' })
  })

  test('quiet hours, including past midnight', () => {
    const q = { start: '21:00', end: '06:00' }
    expect(inQuietHours(q, Date.UTC(2026, 10, 18, 22, 0), 'UTC')).toBe(true)
    expect(inQuietHours(q, Date.UTC(2026, 10, 18, 5, 59), 'UTC')).toBe(true)
    expect(inQuietHours(q, Date.UTC(2026, 10, 18, 6, 0), 'UTC')).toBe(false)
    expect(inQuietHours({ start: '12:00', end: '14:00' }, Date.UTC(2026, 10, 18, 13, 0), 'UTC')).toBe(true)
    expect(inQuietHours(undefined, Date.UTC(2026, 10, 18, 13, 0), 'UTC')).toBe(false)
  })
})

describe('sendAll (Effect)', () => {
  const input = (to: string) => ({ channel: 'sms' as const, to, body: 'hi' })

  test('records each outcome; failures carry the retry flag', async () => {
    const out = await Effect.runPromise(
      sendAll(async (i) => {
        if (i.to === '+1') return { ok: true, providerMessageId: 'm1' }
        if (i.to === '+2') return { ok: false, error: 'HTTP 400: bad number', retryable: false }
        if (i.to === '+3') return { ok: false, error: 'HTTP 503', retryable: true }
        throw new Error('internal query failed')
      }, [0, 1, 2, 3].map((i) => ({ index: i, input: input(`+${i + 1}`) }))),
    )
    expect(out).toEqual([
      { index: 0, ok: true, providerMessageId: 'm1' },
      { index: 1, ok: false, error: 'HTTP 400: bad number', retryable: false },
      { index: 2, ok: false, error: 'HTTP 503', retryable: true },
      { index: 3, ok: false, error: 'internal query failed', retryable: true },
    ])
  })

  test('a send that hangs times out and is not retried (it may have gone out)', async () => {
    const out = await Effect.runPromise(
      sendAll(() => new Promise(() => {}), [{ index: 0, input: input('+1') }], { timeoutMs: 20 }),
    )
    expect(out[0]).toMatchObject({ ok: false, retryable: false })
    expect(out[0].error).toMatch(/No answer/)
  })
})
