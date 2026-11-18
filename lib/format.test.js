import { afterEach, describe, expect, test } from 'vitest'
import {
  daysBetween,
  formatDate,
  formatMoney,
  formatNumber,
  formatQuantity,
  fromMetric,
  localToday,
  setActiveCurrency,
  setActiveLocale,
  setActiveUnitSystem,
  setActiveZone,
  todayIn,
  toMetric,
  unitLabel,
  unitSymbol,
} from './format'

afterEach(() => {
  setActiveZone(null)
  setActiveLocale(null)
  setActiveUnitSystem('metric')
  setActiveCurrency('GHS')
})

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

  test('every kind converts to imperial and back (I18N-002)', () => {
    const cases = [
      ['mass', 1, 2.2046, 'lb'],
      ['smallMass', 100, 3.5274, 'oz'],
      ['length', 10, 32.8084, 'ft'],
      ['shortLength', 2.54, 1, 'in'],
      ['area', 1, 10.7639, 'ft²'],
      ['volume', 1, 35.3147, 'ft³'],
      ['liquid', 3.785411784, 1, 'gal'],
      ['temperature', 100, 212, '°F'],
    ]
    for (const [kind, metric, imperial, unit] of cases) {
      expect(fromMetric(metric, kind, 'imperial')).toBeCloseTo(imperial, 3)
      expect(toMetric(imperial, kind, 'imperial')).toBeCloseTo(metric, 3)
      expect(unitSymbol(kind, 'imperial')).toBe(unit)
      expect(fromMetric(metric, kind, 'metric')).toBe(metric)
    }
    expect(toMetric(32, 'temperature', 'imperial')).toBeCloseTo(0, 6)
    expect(formatQuantity(28, 'temperature', { unitSystem: 'metric', locale: 'en-US' })).toBe('28.0°C')
    expect(formatQuantity(28, 'temperature', { unitSystem: 'imperial', locale: 'en-US' })).toBe('82.4°F')
    expect(formatQuantity(500, 'liquid', { unitSystem: 'metric', locale: 'en-US', decimals: 0 })).toBe('500 L')
  })

  test('the organization unit system, locale and currency are the defaults', () => {
    setActiveUnitSystem('imperial')
    expect(formatQuantity(1, 'mass', { locale: 'en-US' })).toBe('2.2 lb')
    expect(toMetric(2.2046226, 'mass')).toBeCloseTo(1, 5)
    setActiveLocale('fr')
    expect(formatNumber(1234.5, { decimals: 1 })).toMatch(/^1\s234,5$/)
    expect(formatDate('2026-11-18')).toBe('18 nov. 2026')
    setActiveCurrency('KES')
    setActiveLocale('en-US')
    expect(formatMoney(1250.5)).toMatch(/KES|Ksh/)
    expect(formatMoney(10, { currency: 'USD' })).toBe('$10.00')
  })
})
