import { describe, expect, it } from 'vitest'
import { normalizeAlerts, purchaseCreateArgs, purchaseUpdateArgs, rangeToDates, summarizeCosts, summarizeUsage } from './feedData'

describe('feed data shaping', () => {
  it('turns a range into dates', () => {
    const now = new Date('2025-03-31T12:00:00Z')
    expect(rangeToDates('7d', now)).toEqual({ dateFrom: '2025-03-24', dateTo: '2025-03-31' })
    expect(rangeToDates('nonsense', now).dateFrom).toBe('2025-03-01')
  })

  it('totals usage by feed type and cage name', () => {
    const out = summarizeUsage(
      [
        { quantity: 10, feedTypeId: 'f1', cageId: 'c1' },
        { quantity: '5', feed_type_id: 'f1', cage_id: 'gone' },
        { quantity: 2 },
      ],
      [{ _id: 'f1', name: 'Grower' }],
      [{ id: 'c1', name: 'Cage 1' }],
    )
    expect(out.totalUsage).toBe(17)
    expect(out.byFeedType).toEqual({ Grower: 15, Unknown: 2 })
    expect(out.byCage).toEqual({ 'Cage 1': 10, gone: 5, Unassigned: 2 })
  })

  it('averages purchase cost per kg', () => {
    expect(summarizeCosts([{ quantity: 10, pricePerKg: 2 }, { quantity: 30, price_per_kg: 4 }])).toMatchObject({
      totalCost: 140,
      totalKg: 40,
      averageCostPerKg: 3.5,
    })
    expect(summarizeCosts(null).averageCostPerKg).toBe(0)
  })

  it('names alerts and fills stock levels', () => {
    expect(normalizeAlerts([{ feed_type_name: 'Starter', current_stock: 3 }])[0]).toMatchObject({
      name: 'Starter',
      currentStock: 3,
      minimumStock: 0,
    })
  })

  it('builds purchase arguments and requires a supplier', () => {
    expect(() => purchaseCreateArgs({ feedTypeId: 'f1' }, null)).toThrow('Supplier is required')
    expect(purchaseCreateArgs({ feed_type_id: 'f1', supplier_id: 's1', quantity: '', bags: '4', price_per_kg: '2.5' }, 'loc1')).toMatchObject({
      feedTypeId: 'f1',
      supplierId: 's1',
      quantity: undefined,
      bags: 4,
      pricePerKg: 2.5,
      locationId: 'loc1',
    })
    expect(purchaseUpdateArgs('p1', { supplierId: 's1', quantity: 12 })).toMatchObject({ id: 'p1', quantity: 12, pricePerKg: undefined })
  })
})
