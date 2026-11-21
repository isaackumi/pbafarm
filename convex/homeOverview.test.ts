import { describe, expect, test } from 'vitest'
import {
  attentionKind,
  biomassOn,
  biomassSeries,
  cycleDay,
  kpiDeltas,
  mergeActivity,
  pctChange,
  pickAttention,
  rangeStart,
  snapshotOn,
  type ActivityRow,
  type Occupancy,
} from './lib/homeOverview'

const snap = (date: string, o: Partial<{ count: number; biomassKg: number; feedKg: number; gainKg: number; mortality: number }> = {}) => ({
  date,
  count: 1000,
  biomassKg: 100,
  feedKg: 0,
  gainKg: 0,
  mortality: 0,
  ...o,
})

const a: Occupancy = {
  openedOn: '2026-09-01',
  closedOn: null,
  open: true,
  weekly: [
    snap('2026-09-06', { biomassKg: 100, feedKg: 50, gainKg: 40, mortality: 10, count: 990 }),
    snap('2026-10-11', { biomassKg: 200, feedKg: 150, gainKg: 120, mortality: 20, count: 980 }),
    snap('2026-11-15', { biomassKg: 300, feedKg: 300, gainKg: 220, mortality: 50, count: 950 }),
    snap('2026-11-20', { biomassKg: 320, feedKg: 330, gainKg: 240, mortality: 60, count: 940 }),
  ],
}
const closed: Occupancy = {
  openedOn: '2026-08-01',
  closedOn: '2026-10-20',
  open: false,
  weekly: [snap('2026-08-02', { biomassKg: 50 }), snap('2026-10-18', { biomassKg: 80 }), snap('2026-10-20', { biomassKg: 0 })],
}

describe('home biomass (Paper 01 "Standing biomass")', () => {
  test('snapshotOn takes the last snapshot on or before a day, inside the occupancy', () => {
    expect(snapshotOn(a, '2026-08-31')).toBeNull()
    expect(snapshotOn(a, '2026-09-05')).toBeNull()
    expect(snapshotOn(a, '2026-10-12')?.biomassKg).toBe(200)
    expect(snapshotOn(closed, '2026-10-21')).toBeNull()
  })

  test('biomass sums the occupancies standing that day', () => {
    expect(biomassOn([a, closed], '2026-10-19')).toBe(280)
    expect(biomassOn([a, closed], '2026-11-20')).toBe(320)
  })

  test('the series covers the range ends and every snapshot inside it', () => {
    const s = biomassSeries([a, closed], '2026-10-01', '2026-11-20')
    expect(s.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-11', '2026-10-18', '2026-10-20', '2026-11-15', '2026-11-20'])
    expect(s[0].kg).toBe(150)
    expect(s[s.length - 1].kg).toBe(320)
  })

  test('ranges: 30d, 90d and the cycle (oldest open stocking)', () => {
    expect(rangeStart('30d', '2026-11-20', [a])).toBe('2026-10-21')
    expect(rangeStart('90d', '2026-11-20', [a])).toBe('2026-08-22')
    expect(rangeStart('cycle', '2026-11-20', [a, closed])).toBe('2026-09-01')
    expect(rangeStart('cycle', '2026-11-20', [])).toBe('2026-08-22')
  })

  test('cycle day counts the start day as day 1', () => {
    expect(cycleDay([a], '2026-09-01')).toBe(1)
    expect(cycleDay([a], '2026-11-01')).toBe(62)
    expect(cycleDay([closed], '2026-11-01')).toBeNull()
  })

  test('% change needs a base', () => {
    expect(pctChange(110, 100)).toBeCloseTo(10)
    expect(pctChange(10, 0)).toBeNull()
  })
})

describe('home KPI deltas', () => {
  test('FCR now vs 30 days ago, mortality this 30 days vs the 30 before', () => {
    const d = kpiDeltas([a], '2026-11-20')
    expect(d.fcr).toBeCloseTo(330 / 240)
    expect(d.fcrDelta).toBeCloseTo(330 / 240 - 150 / 120)
    // deaths 60 − 20 over 940 + 40 standing at the end
    expect(d.mortalityPct).toBeCloseTo((40 / 980) * 100)
    // 2026-09-21 → 2026-10-21: 20 − 10 over 980 + 10
    expect(d.mortalityDelta).toBeCloseTo((40 / 980) * 100 - (10 / 990) * 100)
  })

  test('no occupancies: nothing to show', () => {
    expect(kpiDeltas([], '2026-11-20')).toEqual({ fcr: null, fcrDelta: null, mortalityPct: null, mortalityDelta: null })
  })
})

describe('needs attention', () => {
  test('the action follows the problem', () => {
    expect(attentionKind('low_oxygen')).toBe('water')
    expect(attentionKind('temperature_out_of_range')).toBe('water')
    expect(attentionKind('density')).toBe('density')
    expect(attentionKind('missing_entries')).toBe('entry')
    expect(attentionKind('mortality_spike')).toBe('entry')
  })

  test('one row per unit, most urgent first', () => {
    const rows = pickAttention([
      { unitId: 'x', reason: 'missing_entries', tone: 'warn', rank: 10 },
      { unitId: 'x', reason: 'low_oxygen', tone: 'alert', rank: 30 },
      { unitId: 'y', reason: 'density', tone: 'warn', rank: 5 },
      { unitId: 'z', reason: 'density', tone: 'alert', rank: 20 },
    ])
    expect(rows.map((r) => `${r.unitId}:${r.reason}`)).toEqual(['x:low_oxygen', 'z:density', 'y:density'])
  })
})

describe('farm activity', () => {
  const row = (id: string, date: string, unit: string, batch: string | null, createdAt = 0): ActivityRow => ({
    id, type: 'stocking', date, unit, batch, fish: 1, biomassKg: 1, status: 'approved', createdAt,
  })
  test('newest first, search on unit or batch, capped', () => {
    const rows = [row('1', '2026-11-16', 'C-09', 'TL-044', 1), row('2', '2026-11-18', 'B-12 → B-14', 'CF-031'), row('3', '2026-11-16', 'A-01', null, 5)]
    expect(mergeActivity(rows, undefined, 10).map((r) => r.id)).toEqual(['2', '3', '1'])
    expect(mergeActivity(rows, 'cf-0', 10).map((r) => r.id)).toEqual(['2'])
    expect(mergeActivity(rows, 'b-14', 10).map((r) => r.id)).toEqual(['2'])
    expect(mergeActivity(rows, '', 2)).toHaveLength(2)
  })
})
