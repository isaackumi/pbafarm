import { describe, expect, it } from 'vitest'
import { cageBars, costBreakdown, costBuildUp, splitDirect, summarizePnl } from './pnlSummary'

const rows = [
  { cage_id: 'a', cage_name: 'A-01', revenue: 1000, total_cost: 600, feed_cost: 400, harvest_kg: 100, expenses_by_category: { fingerlings: 150, labour: 50 } },
  { cage_id: 'b', cage_name: 'B-02', revenue: 0, total_cost: 200, feed_cost: 150, harvest_kg: 0, expenses_by_category: { feed: 10, labour: 40 } },
]

describe('summarizePnl', () => {
  it('adds overheads to cost and derives margin and cost per kg', () => {
    const s = summarizePnl(rows, { total: 200, by_category: { utilities: 200 } })
    expect(s.cost).toBe(1000)
    expect(s.net).toBe(0)
    expect(s.marginPct).toBe(0)
    expect(s.costPerKg).toBe(10)
  })

  it('has no margin or cost per kg without revenue or harvest', () => {
    const s = summarizePnl([], null)
    expect(s.marginPct).toBeNull()
    expect(s.costPerKg).toBeNull()
  })
})

describe('costBreakdown', () => {
  it('merges categories with overheads, folds feed expenses into feed, sorts by amount', () => {
    const lines = costBreakdown(rows, { total: 200, by_category: { utilities: 200 } })
    expect(lines.map((l) => l.key)).toEqual(['feed', 'utilities', 'fingerlings', 'labour'])
    expect(lines[0].amount).toBe(560)
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(1000)
    expect(lines[0].pct).toBe(56)
  })
})

describe('cageBars', () => {
  it('ranks by revenue and scales to the tallest bar', () => {
    const bars = cageBars(rows)
    expect(bars.map((b) => b.label)).toEqual(['A-01', 'B-02'])
    expect(bars[0].revenueH).toBe(1)
    expect(bars[1].costH).toBeCloseTo(0.2)
  })
})

describe('costBuildUp', () => {
  it('divides each cost line by harvested kg', () => {
    const b = costBuildUp(rows, null)
    expect(b.lines[0]).toEqual({ key: 'feed', perKg: 5.6 })
    expect(b.total).toBeCloseTo(8)
  })

  it('is empty without a harvest', () => {
    expect(costBuildUp([{ ...rows[1] }], null)).toEqual({ lines: [], total: null })
  })
})

describe('splitDirect', () => {
  it('splits cage-tagged from site-wide expenses', () => {
    const s = splitDirect([
      { cage_id: 'a', amount: 75 },
      { cage_id: null, amount: 25 },
    ])
    expect(s).toEqual({ direct: 75, overhead: 25, directPct: 75, overheadPct: 25 })
  })
})
