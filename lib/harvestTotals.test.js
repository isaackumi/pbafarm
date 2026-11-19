import { describe, expect, test } from 'vitest'
import { deriveHarvestTotals } from './harvestTotals'

const grades = (...weights) => weights.map((weight, i) => ({ category: `g${i}`, weight }))

describe('harvest form totals (PROD-903)', () => {
  test('blank grades count as 0 and are not a problem', () => {
    const r = deriveHarvestTotals({
      sizeBreakdown: grades('', '', null),
      totalWeight: '4500',
      averageBodyWeight: '450',
      estimatedCount: '10000',
    })
    expect(r).toMatchObject({ badGrade: undefined, gradeSum: 0, total: 4500, abw: 450, count: 10000, mismatch: false })
    expect(r.next).toEqual({})
  })

  test('a missing total is the sum of the grades, and a missing count is total / ABW', () => {
    const r = deriveHarvestTotals({
      sizeBreakdown: grades('1200.25', '', '3300.5'),
      totalWeight: '',
      averageBodyWeight: '450',
      estimatedCount: '',
    })
    expect(r.total).toBe(4500.75)
    expect(r.count).toBe(10002)
    expect(r.next).toEqual({ totalWeight: '4500.75', estimatedCount: '10002' })
    expect(r.mismatch).toBe(false)
  })

  test('grades that do not add up to the total, or a negative grade, are flagged', () => {
    expect(
      deriveHarvestTotals({ sizeBreakdown: grades('1000', '2000'), totalWeight: '4500', averageBodyWeight: '450', estimatedCount: '1' })
        .mismatch,
    ).toBe(true)
    expect(
      deriveHarvestTotals({ sizeBreakdown: grades('-5'), totalWeight: '4500', averageBodyWeight: '450', estimatedCount: '1' })
        .badGrade,
    ).toEqual({ category: 'g0', weight: '-5' })
  })

  test('nothing to derive from leaves the totals missing', () => {
    const r = deriveHarvestTotals({ sizeBreakdown: grades(''), totalWeight: '', averageBodyWeight: '', estimatedCount: '' })
    expect(r.total).toBeNull()
    expect(r.count).toBeNull()
    expect(r.next).toEqual({})
  })
})
