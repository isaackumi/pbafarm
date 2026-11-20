import { describe, expect, it } from 'vitest'
import { lotTimeline, maxDispatchTemp, withdrawalSummary } from './traceView'

const report = {
  lot: { harvest_date: '2026-11-18' },
  harvest: { withdrawal_override: null },
  withdrawal_clear_at_harvest: true,
  trace: {
    origins: [{ opened_on: '2026-07-20', origin: 'hatchery' }],
    journey: [
      { date: '2026-08-01', kind: 'transfer_in' },
      { date: '2026-11-18', kind: 'harvested' },
    ],
    treatments: [
      { date: '2026-07-25', withdrawal_until: '2026-08-08' },
      { date: '2026-10-30', withdrawal_until: '2026-11-13' },
    ],
    feed: [{ feed_type: 'A', kg_fed: 100 }, { feed_type: 'B', kg_fed: 50 }],
  },
  dispatches: [{ temperature_c: 3.8 }, { temperature_c: null }, { temperature_c: 4.1 }],
}

describe('traceView', () => {
  it('orders origin, dated steps, grow-out, harvest and dispatch', () => {
    const steps = lotTimeline(report)
    expect(steps.map((s) => s.kind)).toEqual(['origin', 'treatment', 'move', 'treatment', 'growout', 'harvest', 'dispatch'])
    expect(steps[0].tone).toBe('lime')
    expect(steps[4]).toMatchObject({ days: 121, feedKg: 150, feedTypes: ['A', 'B'] })
  })

  it('omits grow-out and dispatch without a trace or dispatches', () => {
    expect(lotTimeline({ lot: { harvest_date: '2026-11-18' }, trace: null, dispatches: [] }).map((s) => s.kind)).toEqual(['harvest'])
  })

  it('summarises withdrawal state', () => {
    expect(withdrawalSummary(report)).toEqual({ state: 'clear', until: '2026-11-13' })
    expect(withdrawalSummary({ ...report, withdrawal_clear_at_harvest: false })).toEqual({ state: 'running', until: null })
    expect(withdrawalSummary({ ...report, harvest: { withdrawal_override: { reason: 'x', until: '2026-11-20' } } })).toEqual({ state: 'override', until: '2026-11-20' })
  })

  it('finds the warmest dispatch temperature', () => {
    expect(maxDispatchTemp(report.dispatches)).toBe(4.1)
    expect(maxDispatchTemp([{ temperature_c: null }])).toBeNull()
  })
})
