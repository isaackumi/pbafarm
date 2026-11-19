import { describe, expect, it } from 'vitest'
import { gradeShares, lastGradedHarvest, lotState, lotsByHarvest, monthTotals, readyCages } from './harvestView'

describe('harvestView', () => {
  it('totals this and last month with a weighted ABW', () => {
    const r = monthTotals(
      [
        { harvest_date: '2026-11-10', total_weight: 3000, estimated_count: 6000, average_body_weight: 500 },
        { harvest_date: '2026-11-02', total_weight: 1000, estimated_count: 2000, average_body_weight: 300 },
        { harvest_date: '2026-10-20', total_weight: 2000 },
        { harvest_date: '2026-09-20', total_weight: 9000 },
      ],
      '2026-11-18',
    )
    expect(r).toMatchObject({ thisMonth: 4000, lastMonth: 2000, changePct: 100, avgAbw: 450 })
    expect(monthTotals([{ harvest_date: '2026-01-05', total_weight: 5 }, { harvest_date: '2025-12-30', total_weight: 10 }], '2026-01-09').lastMonth).toBe(10)
  })

  it('shares size grades by weight and finds the last graded harvest', () => {
    const graded = { size_breakdown: [{ category: 'S1', weight: 75 }, { category: 'Rej', weight: 25 }, { category: 'S2', weight: 0 }] }
    expect(gradeShares(graded).map((g) => [g.key, g.pct])).toEqual([['S1', 75], ['Rej', 25]])
    expect(gradeShares({ size_breakdown: [{ category: 'S1', weight: 0 }] })).toEqual([])
    expect(lastGradedHarvest([{ size_breakdown: [] }, graded])).toBe(graded)
  })

  it('groups lots per harvest and names their state', () => {
    const map = lotsByHarvest([
      { harvest_id: 'h1', lot_code: 'L1', weight_kg: 100, dispatched_kg: 100, remaining_kg: 0 },
      { harvest_id: 'h1', lot_code: 'L2', weight_kg: 50, dispatched_kg: 10, remaining_kg: 40 },
      { harvest_id: 'h2', lot_code: 'L3', weight_kg: 50, dispatched_kg: 50, remaining_kg: 0 },
    ])
    expect(map.get('h1')).toEqual({ codes: ['L1', 'L2'], weight: 150, dispatched: 110, remaining: 40 })
    expect([lotState(map.get('h1')), lotState(map.get('h2')), lotState(undefined)]).toEqual(['open', 'out', 'none'])
  })

  it('lists ready cages by biomass with active withdrawal holds', () => {
    const rows = readyCages(
      [
        { id: 'a', name: 'A', current_count: 1000, current_weight: 600, stocking_date: '2026-08-20' },
        { id: 'b', name: 'B', current_count: 2000, current_weight: 650 },
      ],
      [{ cage_id: 'a', withdrawal_until: '2026-11-26' }, { cage_id: 'b', withdrawal_until: '2026-11-01' }],
      '2026-11-18',
    )
    expect(rows.map((r) => [r.id, r.biomassKg, r.holdUntil, r.doc])).toEqual([
      ['b', 1300, null, null],
      ['a', 600, '2026-11-26', 90],
    ])
  })
})
