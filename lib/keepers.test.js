import { describe, expect, test } from 'vitest'
import { capacityBar, coverLoad, handoverNote, nextMonday, rangeIds, rowStatus } from './keepers'

const t = (key, v = {}) => `${key}${Object.keys(v).length ? JSON.stringify(v) : ''}`

describe('keeper screen helpers', () => {
  test('drag selection is the run between two squares, either direction', () => {
    const units = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
    expect(rangeIds(units, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeIds(units, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(rangeIds(units, 'x', 'b')).toEqual([])
  })

  test('capacity bar caps at 100% and warns over capacity', () => {
    expect(capacityBar(31, 25)).toEqual({ pct: 100, tone: 'bg-warn' })
    expect(capacityBar(12, 25, { unassigned: true })).toEqual({ pct: 48, tone: 'bg-alert' })
    expect(capacityBar(8, 25, { away: true }).tone).toBe('bg-cover')
  })

  test('why a row is listed: the most urgent reason first', () => {
    expect(rowStatus({ kind: 'keeper', units: 31, stocked: 31, logged: 18, due: 13 }, 25).reason).toEqual({ key: 'keepers.reason.overDue', values: { count: 13 } })
    expect(rowStatus({ kind: 'keeper', units: 14, stocked: 14, logged: 0, due: 14 }, 25)).toMatchObject({
      today: { tone: 'text-alert' },
      reason: { key: 'keepers.reason.notStarted' },
    })
    expect(rowStatus({ kind: 'keeper', units: 8, stocked: 8, logged: 8, due: 0, away: { until: '2026-11-26', coverName: 'Yaw' } }, 25).today.key).toBe('keepers.list.coverLogging')
    expect(rowStatus({ kind: 'unassigned', units: 12, since: null }, 25).reason.key).toBe('keepers.reason.neverAssigned')
  })

  test('cover load and next Monday', () => {
    expect(coverLoad(5, 8, 25)).toEqual({ now: 5, during: 13, heavy: false })
    expect(coverLoad(20, 8, 25).heavy).toBe(true)
    expect(nextMonday('2026-11-20')).toBe('2026-11-23')
    expect(nextMonday('2026-11-23')).toBe('2026-11-30')
  })

  test('handover note groups sampling and caps long lists', () => {
    const facts = Array.from({ length: 6 }, (_, i) => ({ name: `A-0${i + 1}`, sampleDue: true, deadYesterday: i === 0 ? 2 : 0 }))
    const note = handoverNote(t, facts)
    expect(note).toContain('keepers.cover.note.list')
    expect(note).toContain('"count":2')
    expect(note.match(/keepers\.cover\.note\.sampleDue/g)).toHaveLength(1)
    expect(handoverNote(t, [])).toBe('')
  })
})
