import { describe, expect, test } from 'vitest'
import { parseCageScan, scanHref } from './qrTarget'

const cages = [
  { id: 'k1', name: 'A1', code: 'C-001' },
  { _id: 'k2', name: 'North 2', code: 'C-002' },
]

describe('parseCageScan', () => {
  test('printed label on any origin opens daily entry for that cage', () => {
    expect(parseCageScan('https://old.example.com/daily-entry?cage=k1', cages)).toEqual({
      cageIds: ['k1'],
      target: 'daily',
    })
  })

  test('biweekly links and several cages', () => {
    expect(parseCageScan('https://x.app/biweekly-entry?cages=k1,k2', cages)).toEqual({
      cageIds: ['k1', 'k2'],
      target: 'biweekly',
    })
  })

  test('cage page link, relative path, unknown ids dropped', () => {
    expect(parseCageScan('https://x.app/cages/k2', cages)).toEqual({ cageIds: ['k2'], target: null })
    expect(parseCageScan('/daily-entry?cage=k1', cages)?.cageIds).toEqual(['k1'])
    expect(parseCageScan('https://x.app/daily-entry?cage=zzz', cages)).toBeNull()
  })

  test('plain id, code or name; nothing for junk', () => {
    expect(parseCageScan('k2', cages)?.cageIds).toEqual(['k2'])
    expect(parseCageScan('c-001', cages)?.cageIds).toEqual(['k1'])
    expect(parseCageScan('north 2', cages)?.cageIds).toEqual(['k2'])
    expect(parseCageScan('nope', cages)).toBeNull()
    expect(parseCageScan('', cages)).toBeNull()
  })

  test('without a cage list, ids pass through', () => {
    expect(parseCageScan('https://x.app/daily-entry?cage=abc')?.cageIds).toEqual(['abc'])
  })
})

describe('scanHref', () => {
  test('uses the label target, else the fallback', () => {
    expect(scanHref({ cageIds: ['k1'], target: 'biweekly' })).toBe('/biweekly-entry?cage=k1')
    expect(scanHref({ cageIds: ['k1'], target: null }, 'biweekly')).toBe('/biweekly-entry?cage=k1')
    expect(scanHref({ cageIds: ['a', 'b'], target: 'daily' })).toBe('/daily-entry?cages=a,b')
    expect(scanHref(null)).toBeNull()
  })
})
