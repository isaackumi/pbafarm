import { describe, expect, test } from 'vitest'
import { checkDailyRows, isIsoDate, mortalityAverage, parseNumber, rowSpan } from './bulkImport'

describe('bulk import rules (Paper 53)', () => {
  test('mortality average needs three days of history in the last 30 days', () => {
    const h = [
      { date: '2026-09-01', mortality: 50 },
      { date: '2026-10-29', mortality: 2 },
      { date: '2026-10-30', mortality: 4 },
    ]
    expect(mortalityAverage(h, '2026-11-01')).toBeNull()
    expect(mortalityAverage([...h, { date: '2026-10-31', mortality: 0 }], '2026-11-01')).toBe(2)
    expect(mortalityAverage([{ date: '2026-10-29', mortality: 0 }, { date: '2026-10-30', mortality: 0 }, { date: '2026-10-31', mortality: 0 }], '2026-11-01')).toBeNull()
  })

  test('numbers, dates and the row span', () => {
    expect(parseNumber('3,2')).toBe(3.2)
    expect(parseNumber('', 5)).toBe(5)
    expect(isIsoDate('2026-02-30')).toBe(false)
    const span = rowSpan(
      [{ line: 2, cage: 'c-01', date: '2026-11-04' }, { line: 3, cage: 'X', date: '2026-11-01' }, { line: 4, cage: 'C-01', date: 'bad' }],
      [{ id: 'a', name: 'C-01' }],
    )
    expect(span).toEqual({ cageIds: ['a'], from: '2026-11-01', to: '2026-11-04' })
  })

  test('errors outrank warnings; a duplicate in the file is an error', () => {
    const rows = checkDailyRows(
      [
        { line: 2, cage: 'C-01', date: '2026-11-01', mortality: '1', doMgl: '2' },
        { line: 3, cage: 'C-01', date: '2026-11-01', mortality: '1' },
        { line: 4, cage: 'C-01', date: '2026-11-02', mortality: '1.5' },
        { line: 5, cage: 'C-01', date: '2026-11-03', feed: '5' },
      ],
      { cages: [{ id: 'a', name: 'C-01' }], today: '2026-11-15', siteName: null, feedTypes: [], history: new Map(), doMin: () => 4 },
    )
    expect(rows.map((r) => [r.status, r.reason?.code])).toEqual([
      ['warning', 'lowDo'],
      ['error', 'duplicateRow'],
      ['error', 'badWholeNumber'],
      ['error', 'feedTypeRequired'],
    ])
  })
})
