import { describe, expect, test } from 'vitest'
import { findCageByCode, labelUrl, parseCageScan, scanHref, shortCodeFor } from './qrTarget'

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

describe('stable short codes', () => {
  const farm = [
    { _id: 'jd7abc123xyz', name: 'A1', code: 'C-001' },
    { _id: 'jd7abc456uvw', name: 'A2', code: 'dup' },
    { _id: 'jd7abc789rst', name: 'A3', code: 'DUP' },
    { _id: 'jd7abc000qqq', name: 'A4' },
  ]

  test("label holds the cage's own code when unique, else ~ and the id tail", () => {
    expect(shortCodeFor(farm[0], farm)).toBe('C-001')
    expect(shortCodeFor(farm[1], farm)).toBe('~456uvw')
    expect(shortCodeFor(farm[3], farm)).toBe('~000qqq')
    expect(labelUrl('https://farm.app', farm[0], farm)).toBe('https://farm.app/scan?c=C-001')
  })

  test('a label scanned on any origin resolves back to its cage', () => {
    for (const cage of farm) {
      const url = labelUrl('https://old.example.com', cage, farm)
      expect(parseCageScan(url, farm)).toEqual({ cageIds: [cage._id], target: null })
    }
  })

  test('ambiguous or unknown codes resolve to nothing; no cage list means no guess', () => {
    expect(findCageByCode('dup', farm)).toBeNull()
    expect(findCageByCode('~zzzzzz', farm)).toBeNull()
    expect(findCageByCode('~', farm)).toBeNull()
    expect(parseCageScan('https://x.app/scan?c=C-001')).toBeNull()
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
