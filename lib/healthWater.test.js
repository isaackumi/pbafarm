import { describe, expect, test } from 'vitest'
import { activeTreatments, doTrend, mainUnitType, waterRows, waterSummary, withdrawalSummary } from './healthWater'

const units = [
  { id: 'a', name: 'C-10', unitType: 'cage' },
  { id: 'b', name: 'C-2', unitType: 'cage' },
  { id: 'c', name: 'P-1', unitType: 'pond' },
]
const limits = { cage: { dissolvedOxygen: { min: 4 } }, pond: { dissolvedOxygen: { min: 3 } } }

describe('waterRows / waterSummary', () => {
  test('checks each unit against its own type and lists breaches first', () => {
    const latest = [
      { unitId: 'a', values: { dissolvedOxygen: 5, temperatureC: 29 } },
      { unitId: 'b', values: { dissolvedOxygen: 3.5, temperatureC: 31 } },
      { unitId: 'c', values: { dissolvedOxygen: 3.5 } },
    ]
    const rows = waterRows(units, latest, limits)
    expect(rows.map((r) => r.unit.name)).toEqual(['C-2', 'C-10', 'P-1'])
    expect(rows[0].breaches).toEqual({ dissolvedOxygen: 'low' })
    expect(rows[2].breachCount).toBe(0)
    expect(waterSummary(rows)).toEqual({ avgDo: 4, avgTemp: 30, lowDoUnits: 1, logged: 3, outOfRange: 1 })
  })

  test('units without a reading count as not logged', () => {
    const rows = waterRows(units, [], limits)
    expect(waterSummary(rows)).toMatchObject({ avgDo: null, logged: 0, outOfRange: 0 })
    expect(mainUnitType(units)).toBe('cage')
  })
})

test('doTrend gives one point per day with average and lowest, null when nothing was logged', () => {
  const pts = doTrend(
    [
      { date: '2026-11-18', dissolved_oxygen: 5 },
      { date: '2026-11-18', dissolved_oxygen: 3 },
      { date: '2026-11-17', dissolved_oxygen: null },
      { date: '2026-11-10', dissolved_oxygen: 9 },
    ],
    '2026-11-18',
  )
  expect(pts).toHaveLength(7)
  expect(pts[0].date).toBe('2026-11-12')
  expect(pts[6]).toEqual({ date: '2026-11-18', avg: 4, min: 3 })
  expect(pts[5]).toEqual({ date: '2026-11-17', avg: null, min: null })
})

test('active treatments: running withdrawals first, then the last 7 days', () => {
  const list = activeTreatments(
    [
      { id: 1, date: '2026-11-01', withdrawal_until: '2026-11-26' },
      { id: 2, date: '2026-11-15' },
      { id: 3, date: '2026-11-02', withdrawal_until: '2026-11-20' },
      { id: 4, date: '2026-11-01' },
      { id: 5, date: '2026-11-17', withdrawal_until: '2026-11-17' },
    ],
    '2026-11-18',
  )
  expect(list.map((r) => r.id)).toEqual([3, 1, 5, 2])
  expect(list.map((r) => r.inWithdrawal)).toEqual([true, true, false, false])
  expect(
    withdrawalSummary([
      { cage_id: 'a', withdrawal_until: '2026-11-20' },
      { cage_id: 'a', withdrawal_until: '2026-11-26' },
    ]),
  ).toEqual({ units: 1, lastUntil: '2026-11-26' })
})
