import { describe, expect, it } from 'vitest'
import { backByTime, isMaintenanceActive, nextBoundary } from './maintenanceMode'
import { displayErrorId, newErrorId } from './errorId'

const window = { startsAt: 1_000, endsAt: 5_000 }

describe('maintenance window', () => {
  it('is open from the start up to, not including, the end', () => {
    expect(isMaintenanceActive(window, 999)).toBe(false)
    expect(isMaintenanceActive(window, 1_000)).toBe(true)
    expect(isMaintenanceActive(window, 4_999)).toBe(true)
    expect(isMaintenanceActive(window, 5_000)).toBe(false)
    expect(isMaintenanceActive(null, 2_000)).toBe(false)
  })

  it('waits for the next open or close', () => {
    expect(nextBoundary(window, 0)).toBe(1_000)
    expect(nextBoundary(window, 2_000)).toBe(3_000)
    expect(nextBoundary(window, 6_000)).toBeNull()
    expect(nextBoundary(null, 0)).toBeNull()
  })

  it('formats the end as HH:MM GMT', () => {
    expect(backByTime(Date.UTC(2026, 0, 5, 2, 30))).toBe('02:30')
    expect(backByTime(Date.UTC(2026, 0, 5, 23, 5))).toBe('23:05')
    expect(backByTime(Number.NaN)).toBe('')
  })
})

describe('error ids', () => {
  it('makes err_ ids and accepts only safe ids for display', () => {
    expect(newErrorId()).toMatch(/^err_[0-9a-f]{8}$/)
    expect(displayErrorId('err_7f2c9a41')).toBe('err_7f2c9a41')
    expect(displayErrorId('<script>')).toBeNull()
    expect(displayErrorId(undefined)).toBeNull()
  })
})
