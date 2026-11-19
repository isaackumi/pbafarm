import { describe, expect, it } from 'vitest'
import { batchArgs, harvestCreateArgs, harvestPatchArgs, stockingCreateArgs } from './recordArgs'

describe('recordArgs (UX-002)', () => {
  it('harvestCreateArgs maps snake_case, coerces numbers and drops a blank FCR', () => {
    const args = harvestCreateArgs({
      cage_id: 'c1',
      harvest_date: '2026-11-01',
      harvest_type: 'partial',
      total_weight: '120.5',
      average_body_weight: '350',
      estimated_count: '344.4',
      fcr: '',
      notes: '',
      clientMutationId: 'm1',
    })
    expect(args).toEqual({
      cageId: 'c1',
      harvestDate: '2026-11-01',
      harvestType: 'partial',
      totalWeight: 120.5,
      averageBodyWeight: 350,
      estimatedCount: 344,
      clientMutationId: 'm1',
    })
  })

  it('harvestCreateArgs rejects a missing required number', () => {
    expect(() => harvestCreateArgs({ cageId: 'c1', totalWeight: '', averageBodyWeight: 1, estimatedCount: 1 })).toThrow(
      /totalWeight/,
    )
  })

  it('harvestPatchArgs never moves the cage and leaves blank numbers unchanged', () => {
    expect(harvestPatchArgs({ cage_id: 'c2', total_weight: '', fcr: '1.4', notes: 'n' })).toEqual({ fcr: 1.4, notes: 'n' })
  })

  it('harvestPatchArgs maps a snake_case count edit to camelCase (PROD-000a)', () => {
    expect(harvestPatchArgs({ estimated_count: '9500' })).toEqual({ estimatedCount: 9500 })
  })

  it('stockingCreateArgs derives biomass when blank', () => {
    const args = stockingCreateArgs({ cageId: 'c1', fishCount: '1000', initialAbw: '20', initialBiomass: '', notes: '' })
    expect(args).toEqual({ cageId: 'c1', fishCount: 1000, initialAbw: 20, initialBiomass: 20 })
  })

  it('batchArgs strips nulls per line and only sends set flags', () => {
    expect(batchArgs({ date: 'd', records: [{ cageId: 'c', notes: null, mortality: 0 }] })).toEqual({
      date: 'd',
      records: [{ cageId: 'c', mortality: 0 }],
    })
  })
})
