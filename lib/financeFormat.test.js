import { describe, expect, test } from 'vitest'
import { paperMoney } from './financeFormat'

describe('paperMoney (Paper 10/19/24 money format)', () => {
  test('symbol, space, thousands separators', () => {
    expect(paperMoney(74400, 'GHS', { locale: 'en' })).toBe('GH₵ 74,400')
    expect(paperMoney(8.9, 'GHS', { decimals: 2, locale: 'en' })).toBe('GH₵ 8.90')
  })
  test('compact: three significant digits, lowercase k', () => {
    expect(paperMoney(1840000, 'GHS', { compact: true, locale: 'en' })).toBe('GH₵ 1.84M')
    expect(paperMoney(610000, 'GHS', { compact: true, locale: 'en' })).toBe('GH₵ 610k')
    expect(paperMoney(0, 'GHS', { compact: true, locale: 'en' })).toBe('GH₵ 0')
  })
  test('negative amounts lead with a minus sign', () => {
    expect(paperMoney(-1020000, 'GHS', { compact: true, locale: 'en' })).toBe('−GH₵ 1.02M')
  })
  test('not a number', () => {
    expect(paperMoney(undefined)).toBe('—')
  })
})
