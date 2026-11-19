import { describe, expect, test } from 'vitest'
import { buildFeedOverview } from './feedOverview'

describe('buildFeedOverview', () => {
  const levels = [
    { feed_type_id: 'a', feed_type_name: 'Grower 4mm', current_stock: 600, minimum_stock: 500, price_per_kg: 10, is_low_stock: false, stock_value: 6000 },
    { feed_type_id: 'b', feed_type_name: 'Starter 2mm', current_stock: 40, minimum_stock: 100, price_per_kg: 20, is_low_stock: true, stock_value: 800 },
    { feed_type_id: 'c', feed_type_name: 'Unused', current_stock: 100, price_per_kg: 5, active: false },
  ]
  const usage = [
    { feed_type_id: 'a', quantity: 600 },
    { feed_type_id: 'b', quantity: 300 },
  ]

  test('totals, cost and days of cover per feed', () => {
    const o = buildFeedOverview(levels, usage, 30)
    expect(o.totalKg).toBe(640)
    expect(o.usedKg).toBe(900)
    expect(o.dailyKg).toBe(30)
    expect(o.costValue).toBe(600 * 10 + 300 * 20)
    expect(o.costPerKg).toBeCloseTo(12000 / 900)
    expect(o.rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(o.rows[0].coverDays).toBe(30)
    expect(o.rows[0].tone).toBe('good')
    expect(o.rows[1].coverDays).toBe(4)
    expect(o.rows[1].tone).toBe('alert')
    expect(o.reorder.map((r) => r.id)).toEqual(['b'])
  })

  test('no usage means no cover figure rather than infinity', () => {
    const o = buildFeedOverview(levels, [], 30)
    expect(o.coverDays).toBeNull()
    expect(o.rows[0].coverDays).toBeNull()
    expect(o.costPerKg).toBe(0)
  })
})
