import { describe, expect, test } from 'vitest'
import { fcrSavings, formatAmount, formatTonnes } from './fcrSavings'

describe('FCR savings calculator (landing v4)', () => {
  test('Paper example: 24 cages × 4 t, 0.1 FCR, GH₵ 9.80/kg = GH₵ 94,080', () => {
    const r = fcrSavings({ cages: 24, tonnesPerCage: 4, improvement: 0.1, pricePerKg: 9.8 })
    expect(r).toEqual({ fishTonnes: 96, feedTonnes: 9.6, amount: 94080 })
    expect(formatAmount(r.amount)).toBe('94,080')
    expect(formatTonnes(r.feedTonnes)).toBe('9.6')
  })

  test('scales with every input and ignores bad values', () => {
    expect(fcrSavings({ cages: 1, tonnesPerCage: 0.5, improvement: 0.05, pricePerKg: 2 }).amount).toBe(50)
    expect(fcrSavings({ cages: 200, tonnesPerCage: 20, improvement: 0.5, pricePerKg: 30 }).amount).toBe(60_000_000)
    expect(fcrSavings({ cages: -3, tonnesPerCage: NaN, improvement: 0.1, pricePerKg: 9 })).toEqual({
      fishTonnes: 0,
      feedTonnes: 0,
      amount: 0,
    })
  })
})
