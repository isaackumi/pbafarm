import { describe, expect, it } from 'vitest'
import { biweeklyPatchArgs } from './biweeklyArgs'

describe('biweeklyPatchArgs', () => {
  it('maps form fields and drops empty ones', () => {
    expect(
      biweeklyPatchArgs('r1', { date: '2024-05-01', batch_code: '', average_body_weight: '120', total_fish_count: 0 }),
    ).toEqual({ id: 'r1', patch: { date: '2024-05-01', averageBodyWeight: 120, totalFishCount: 0 } })
  })
})
