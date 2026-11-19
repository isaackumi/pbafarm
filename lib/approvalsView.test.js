import { describe, expect, it } from 'vitest'
import { inboxView, requestAge, tabCounts } from './approvalsView'

const rows = [
  { type: 'fish_transfer', id: 't1' },
  { type: 'stocking', id: 's1' },
  { type: 'stocking', id: 's2' },
  { type: 'topup', id: 'u1' },
]

describe('approvalsView', () => {
  it('formats request age in minutes, hours or days', () => {
    const now = 10 * 86_400_000
    expect(requestAge(now - 12 * 60000, now)).toEqual({ unit: 'm', n: 12 })
    expect(requestAge(now - 3 * 3_600_000, now)).toEqual({ unit: 'h', n: 3 })
    expect(requestAge(now - 50 * 3_600_000, now)).toEqual({ unit: 'd', n: 2 })
  })

  it('counts rows per tab', () => {
    expect(tabCounts(rows)).toEqual({ all: 4, stocking: 2, fish_transfer: 1, topup: 1 })
  })

  it('keeps the selected row while listed, else selects the first', () => {
    expect(inboxView(rows, 'stocking', 'stocking-s2').selected.id).toBe('s2')
    expect(inboxView(rows, 'stocking', 'topup-u1').selected.id).toBe('s1')
    expect(inboxView(rows, 'topup', null).list).toHaveLength(1)
    expect(inboxView([], 'all', null).selected).toBeNull()
  })
})
