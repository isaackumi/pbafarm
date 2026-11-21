import { describe, expect, test } from 'vitest'
import {
  checkBiweeklyRows,
  checkDailyRows,
  datesByCage,
  historyWindows,
  isIsoDate,
  mortalityAverage,
  newCheckState,
  parseNumber,
  rowSpan,
  toCarry,
} from './bulkImport'

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

  test('history windows: the lookback before each date, overlaps merged, far dates apart', () => {
    expect(historyWindows(['2026-11-02', '2026-11-01', 'bad', '2026-11-01'], 30)).toEqual([{ from: '2026-10-02', to: '2026-11-02' }])
    expect(historyWindows(['2026-01-10', '2026-11-01'], 30)).toEqual([
      { from: '2025-12-11', to: '2026-01-10' },
      { from: '2026-10-02', to: '2026-11-01' },
    ])
    // Touching windows merge: Nov 01 ends where Dec 02's lookback starts the next day.
    expect(historyWindows(['2026-11-01', '2026-12-02'], 30)).toEqual([{ from: '2026-10-02', to: '2026-12-02' }])
    expect(historyWindows([])).toEqual([])
    const dates = datesByCage(
      [{ line: 2, cage: 'c-01', date: '2026-11-04' }, { line: 3, cage: 'X', date: '2026-11-01' }, { line: 4, cage: 'C-01', date: 'bad' }],
      [{ id: 'a', name: 'C-01' }],
    )
    expect([...dates]).toEqual([['a', ['2026-11-04']]])
  })

  test('the check state carries duplicates and feed use from one chunk to the next', () => {
    const ctx = {
      cages: [{ id: 'a', name: 'C-01' }],
      today: '2026-11-15',
      siteName: null,
      feedTypes: [{ id: 'f', name: 'Grower', currentStock: 100 }],
      history: new Map(),
      doMin: () => undefined,
      binKg: () => 10,
    }
    const state = newCheckState()
    const one = checkDailyRows([{ line: 2, cage: 'C-01', date: '2026-11-01', feed: '60', feedType: 'Grower' }], { ...ctx, state })
    expect(one.map((r) => r.status)).toEqual(['ok'])
    const carry = toCarry(state)
    // 10 kg came from the bin, 50 from the store.
    expect(carry).toEqual({ seen: ['a|2026-11-01'], feedUsed: [{ id: 'f', kg: 50 }], binUsed: [{ id: 'a|f', kg: 10 }] })
    const two = checkDailyRows(
      [
        { line: 3, cage: 'C-01', date: '2026-11-01', feed: '1', feedType: 'Grower' },
        { line: 4, cage: 'C-01', date: '2026-11-02', feed: '51', feedType: 'Grower' },
        { line: 5, cage: 'C-01', date: '2026-11-03', feed: '50', feedType: 'Grower' },
      ],
      { ...ctx, state: newCheckState(carry) },
    )
    expect(two.map((r) => r.reason?.code ?? r.status)).toEqual(['duplicateRow', 'notEnoughStock', 'ok'])
    const bw = newCheckState({ seen: ['smp-01'], feedUsed: [], binUsed: [] })
    const sampled = checkBiweeklyRows([{ line: 2, cage: 'C-01', date: '2026-11-01', abw: '100', batch: 'SMP-01' }], {
      ...ctx,
      takenBatchCodes: new Set(),
      state: bw,
    })
    expect(sampled[0].reason?.code).toBe('duplicateRow')
  })
})
