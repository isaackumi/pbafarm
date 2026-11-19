import { describe, expect, it } from 'vitest'
import { byDate, monthGrid, shiftMonth } from './calendarGrid'

describe('monthGrid', () => {
  it('starts on Monday and pads with adjacent months', () => {
    const weeks = monthGrid(new Date(2026, 10, 18)) // November 2026 starts on a Sunday
    expect(weeks[0][0]).toEqual({ iso: '2026-10-26', day: 26, inMonth: false })
    expect(weeks[0][6]).toEqual({ iso: '2026-11-01', day: 1, inMonth: true })
    expect(weeks.at(-1).at(-1)).toEqual({ iso: '2026-12-06', day: 6, inMonth: false })
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks).toHaveLength(6)
  })

  it('adds no trailing week when the month ends on Sunday', () => {
    const may = monthGrid(new Date(2026, 4, 1)) // 31 May 2026 is a Sunday
    expect(may.at(-1).at(-1).iso).toBe('2026-05-31')
    expect(may).toHaveLength(5)
  })
})

describe('shiftMonth / byDate', () => {
  it('crosses year boundaries', () => {
    expect(shiftMonth(new Date(2026, 11, 31), 1)).toEqual(new Date(2027, 0, 1))
  })

  it('groups events by date and skips undated ones', () => {
    const map = byDate([{ date: '2026-11-02', id: 1 }, { id: 2 }, { date: '2026-11-02', id: 3 }])
    expect(map.get('2026-11-02').map((e) => e.id)).toEqual([1, 3])
    expect(map.size).toBe(1)
  })
})
