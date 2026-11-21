import { describe, expect, test } from 'vitest'
import { maintenanceClock, maintenanceUntil } from './maintenance'

describe('maintenance window (Paper 62)', () => {
  const now = Date.parse('2026-11-21T00:00:00Z')
  test('only a valid future time turns it on', () => {
    expect(maintenanceUntil('', now)).toBeNull()
    expect(maintenanceUntil('soon', now)).toBeNull()
    expect(maintenanceUntil('2026-11-20T23:00:00Z', now)).toBeNull()
    expect(maintenanceUntil('2026-11-21T02:30:00Z', now)?.toISOString()).toBe('2026-11-21T02:30:00.000Z')
  })
  test('the time reads as drawn: "02:30 GMT"', () => {
    expect(maintenanceClock(new Date('2026-11-21T02:30:00Z'))).toBe('02:30 GMT')
  })
})
