import { describe, expect, test } from 'vitest'
import { editDistance, foldLookalikes, fuzzyMatchUnit } from './unitMatch'

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
