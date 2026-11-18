import { afterEach, describe, expect, test } from 'vitest'
import {
  daysBetween,
  formatDate,
  formatQuantity,
  localToday,
  setActiveZone,
  todayIn,
  toMetric,
  unitLabel,
} from './format'

afterEach(() => setActiveZone(null))

describe('lib/format', () => {
  const late = Date.UTC(2026, 10, 18, 21, 30) // 00:30 on the 19th in Nairobi

  test('today follows the active site zone', () => {
    expect(todayIn('Africa/Nairobi', late)).toBe('2026-11-19')
    setActiveZone('Africa/Accra')
    expect(localToday(late)).toBe('2026-11-18')
    setActiveZone('Africa/Nairobi')
    expect(localToday(late)).toBe('2026-11-19')
  })

  test('day count matches the server convention', () => {
    expect(daysBetween('2026-11-01', '2026-11-18')).toBe(17)
    expect(daysBetween('2026-11-18', '2026-11-01')).toBe(0)
  })

  test('units convert for display and back for saving', () => {
    expect(formatQuantity(1, 'mass', { unitSystem: 'imperial', locale: 'en-US' })).toBe('2.2 lb')
    expect(formatQuantity(10, 'area', { locale: 'en-US' })).toBe('10.0 m²')
    expect(toMetric(1, 'mass', 'imperial')).toBeCloseTo(0.4536, 4)
    expect(toMetric(5, 'mass', 'metric')).toBe(5)
  })

  test('unit labels default to cage', () => {
    expect(unitLabel({})).toBe('Cage')
    expect(unitLabel({ unit_type: 'pond' })).toBe('Pond')
    expect(unitLabel('tank', { plural: true })).toBe('Tanks')
  })

  test('business dates display without shifting a day', () => {
    expect(formatDate('2026-11-18', { locale: 'en-GB' })).toBe('18 Nov 2026')
  })
})
