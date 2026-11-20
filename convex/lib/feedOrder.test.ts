import { describe, expect, test } from 'vitest'
import { DEFAULT_BAG_KG, ORDER_COVER_DAYS, feedOrderQuantity } from './feedOrder'

describe('feedOrderQuantity', () => {
  test('14-day need summed over units, minus stock, rounded up to whole bags', () => {
    // 9 units: 120.7 kg/day in total → 1689.8 kg over 14 days.
    const dailyKg = [10, 12.5, 14, 15.2, 9, 11, 16, 18, 15]
    const r = feedOrderQuantity({ dailyKg, stockKg: 440, bagKg: 25 })
    expect(r.days).toBe(ORDER_COVER_DAYS)
    expect(r.needKg).toBe(1689.8)
    expect(r.shortKg).toBe(1249.8)
    expect(r.bags).toBe(50)
    expect(r.quantityKg).toBe(1250)
  })

  test('an exact multiple of the bag is not rounded up an extra bag', () => {
    const r = feedOrderQuantity({ dailyKg: [100], days: 10, stockKg: 0, bagKg: 25 })
    expect(r.needKg).toBe(1000)
    expect(r.bags).toBe(40)
    expect(r.quantityKg).toBe(1000)
  })

  test('stock that covers the need orders nothing', () => {
    const r = feedOrderQuantity({ dailyKg: [5, 5], stockKg: 500, bagKg: 25 })
    expect(r.needKg).toBe(140)
    expect(r.shortKg).toBe(0)
    expect(r.bags).toBe(0)
    expect(r.quantityKg).toBe(0)
  })

  test('default bag size, ignored bad rations and negative stock', () => {
    const r = feedOrderQuantity({ dailyKg: [3, Number.NaN, -2, 0], stockKg: -50, bagKg: null })
    expect(r.bagKg).toBe(DEFAULT_BAG_KG)
    expect(r.stockKg).toBe(0)
    expect(r.needKg).toBe(42)
    expect(r.bags).toBe(3)
    expect(r.quantityKg).toBe(60)
  })

  test('custom cover period', () => {
    const r = feedOrderQuantity({ dailyKg: [20], days: 7, stockKg: 30, bagKg: 20 })
    expect(r.needKg).toBe(140)
    expect(r.shortKg).toBe(110)
    expect(r.bags).toBe(6)
  })
})
