import { describe, expect, test } from 'vitest'
import { editDistance, foldLookalikes, fuzzyMatchUnit, rankUnits } from './unitMatch'

const units = [
  { _id: '1', name: 'Cage A1' },
  { _id: '2', name: 'Cage A2' },
  { _id: '3', name: 'C10', code: 'NORTH-10' },
  { _id: '4', name: 'Pond B12' },
  { _id: '5', name: 'Tank 3001' },
]

describe('BOT-006 unit matching', () => {
  test('exact name or code, ignoring "cage" and punctuation', () => {
    expect(fuzzyMatchUnit(units, 'A1')).toMatchObject({ unit: { _id: '1' }, confidence: 1 })
    expect(fuzzyMatchUnit(units, 'cage a-2')).toMatchObject({ unit: { _id: '2' }, confidence: 1 })
    expect(fuzzyMatchUnit(units, 'north 10')).toMatchObject({ unit: { _id: '3' }, confidence: 1 })
  })

  test('handwriting look-alikes match at lower confidence', () => {
    expect(foldLookalikes('cio')).toBe('c10')
    expect(fuzzyMatchUnit(units, 'CIO')).toMatchObject({ unit: { _id: '3' }, confidence: 0.8 })
    expect(fuzzyMatchUnit(units, 'Pond 8I2')).toMatchObject({ unit: { _id: '4' }, confidence: 0.8 })
  })

  test('one wrong character on a long code is a low-confidence match', () => {
    expect(editDistance('3001', '3007')).toBe(1)
    expect(fuzzyMatchUnit(units, '3007')).toMatchObject({ unit: { _id: '5' }, confidence: 0.6 })
  })

  test('a different short code never fuzzes into another unit', () => {
    // "A3" is one edit from A1 and A2: unmatched, flagged.
    expect(fuzzyMatchUnit(units, 'A3')).toMatchObject({ unit: null })
    // "A12" is not "A1" (the read is not part of A1's name).
    expect(fuzzyMatchUnit(units, 'A12')).toMatchObject({ unit: null })
  })

  test('ambiguous partial reads are unmatched with candidates', () => {
    const r = fuzzyMatchUnit(units, 'A')
    expect(r.unit).toBeNull()
    expect(fuzzyMatchUnit(units, '')).toMatchObject({ unit: null })
  })
})

describe('BOT-005 cage ranking for the picker', () => {
  const cages = [
    { _id: 'a8', name: 'A-08' },
    { _id: 'b8', name: 'B-08' },
    { _id: 'a3', name: 'A-03' },
    { _id: 'c7', name: 'C-07' },
  ]
  test('closest first; a heard number is a hint; nothing for empty text', () => {
    const r = rankUnits(cages, 'A8')
    expect(r.slice(0, 2).map((x) => x.unit._id)).toEqual(['a8', 'b8'])
    expect(r[0].score).toBeGreaterThan(r[1].score)
    expect(rankUnits(cages, 'cage seven 7')[0].unit._id).toBe('c7')
    expect(rankUnits(cages, '   ')).toEqual([])
    expect(rankUnits(cages, 'A8', 1)).toHaveLength(1)
  })
})
