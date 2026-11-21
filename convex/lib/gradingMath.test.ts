import { describe, expect, test } from 'vitest'
import {
  classBounds,
  cleanRounds,
  daysToTarget,
  densityAfter,
  formatRounds,
  gradingCv,
  parseRounds,
  sampleStats,
  weeksToTarget,
} from './gradingMath'
import { DEFAULT_SETTINGS } from './farmRules'

const rules = DEFAULT_SETTINGS.farmRules

describe('parseRounds / formatRounds', () => {
  test('one round per line; spaces, commas and semicolons separate; decimal comma', () => {
    expect(parseRounds('200 210, 220;230\n\n 199,5 x -3 0 201')).toEqual([[200, 210, 220, 230], [199.5, 201]])
    expect(formatRounds([[200, 210], [], [199.5]])).toBe('200 210\n199.5')
    expect(cleanRounds([[1, -2, Number.NaN, 3], []])).toEqual([[1, 3]])
  })
})

describe('sampleStats', () => {
  test('mean, sample SD, CV, range and rounds', () => {
    const s = sampleStats([
      [2, 4, 4, 4],
      [5, 5, 7, 9],
    ])!
    expect(s.n).toBe(8)
    expect(s.rounds).toBe(2)
    expect(s.perRound).toBe(4)
    expect(s.mean).toBe(5)
    expect(s.sd).toBeCloseTo(Math.sqrt(32 / 7), 10)
    expect(s.cvPct).toBeCloseTo((Math.sqrt(32 / 7) / 5) * 100, 10)
    expect([s.min, s.max]).toEqual([2, 9])
  })

  test('uneven rounds have no per-round size; one fish has no spread; none is null', () => {
    expect(sampleStats([[1, 2], [3]])!.perRound).toBeNull()
    expect(sampleStats([[250]])).toMatchObject({ n: 1, sd: 0, cvPct: 0 })
    expect(sampleStats([])).toBeNull()
    expect(sampleStats(undefined)).toBeNull()
  })
})

describe('gradingCv', () => {
  test('before is the mixture of the classes; after is the count-weighted class CV', () => {
    const large = sampleStats([[280, 300, 320]])!
    const small = sampleStats([[110, 120, 130]])!
    const cv = gradingCv([
      { count: 1000, stats: large },
      { count: 3000, stats: small },
    ])!
    // Mixture: mean 165, E[x²] = (1000(400+90000) + 3000(100+14400)) / 4000.
    const mean = 165
    const second = (1000 * (400 + 90000) + 3000 * (100 + 14400)) / 4000
    expect(cv.beforePct).toBeCloseTo((Math.sqrt(second - mean ** 2) / mean) * 100, 8)
    expect(cv.afterPct).toBeCloseTo((1000 * large.cvPct + 3000 * small.cvPct) / 4000, 8)
    expect(cv.afterPct).toBeLessThan(cv.beforePct)
  })

  test('needs a sample of at least two fish in every class with fish', () => {
    const s = sampleStats([[100, 120]])
    expect(gradingCv([{ count: 10, stats: s }, { count: 5, stats: null }])).toBeNull()
    expect(gradingCv([{ count: 10, stats: s }, { count: 5, stats: sampleStats([[90]]) }])).toBeNull()
    expect(gradingCv([{ count: 10, stats: s }, { count: 0, stats: null }])).not.toBeNull()
    expect(gradingCv([])).toBeNull()
  })
})

describe('classBounds', () => {
  test('halfway between neighbouring samples, rounded to 10 g, heaviest first', () => {
    const b = classBounds([
      { abw: 214, stats: sampleStats([[170, 214, 250]]) },
      { abw: 298, stats: sampleStats([[270, 298, 330]]) },
      { abw: 121, stats: sampleStats([[90, 121, 150]]) },
    ])
    // above: the class's fish weigh more than this; below: less than this.
    expect(b).toEqual([
      { above: 160, below: 260 },
      { above: 260, below: null },
      { above: null, below: 160 },
    ])
  })

  test('falls back to class means; classes without a weight have no bounds', () => {
    expect(classBounds([{ abw: 300, stats: null }, { abw: 100, stats: null }, { abw: null, stats: null }])).toEqual([
      { above: 200, below: null },
      { above: null, below: 200 },
      { above: null, below: null },
    ])
  })
})

describe('weeks to market', () => {
  test('degree-days from the TGC model over the effective temperature', () => {
    const days = daysToTarget(300, 400, 2, 28)!
    expect(days).toBeCloseTo(((Math.cbrt(400) - Math.cbrt(300)) * 1000) / 2 / 28, 10)
    expect(weeksToTarget(300, 400, 2, 28)).toBe(Math.max(1, Math.round(days / 7)))
    expect(weeksToTarget(450, 400, 2, 28)).toBe(0)
    expect(weeksToTarget(300, 400, 0, 28)).toBeNull()
    expect(weeksToTarget(300, 400, 2, 0)).toBeNull()
  })
})

describe('densityAfter', () => {
  test('kg per m³ of net volume for cages, per m² for ponds, null without a size', () => {
    const rows = densityAfter(
      [
        { unit: { _id: 'a', netVolumeM3: 100, volumeM3: 200 }, count: 5000, abwG: 300 },
        { unit: { _id: 'b', unitType: 'pond', areaM2: 1000 }, count: 2000, abwG: 100 },
        { unit: { _id: 'c' }, count: 10, abwG: 100 },
      ],
      rules,
    )
    expect(rows[0]).toMatchObject({ unitId: 'a', kgPer: 15, measure: 'volume' })
    expect(rows[0].fish.density).toBe(50)
    expect(rows[1]).toMatchObject({ unitId: 'b', kgPer: 0.2, measure: 'area' })
    expect(rows[2].kgPer).toBeNull()
    expect(rows[2].fish.level).toBe('unknown')
  })

  test('flags a destination over its fish limit', () => {
    const [r] = densityAfter([{ unit: { _id: 'a', volumeM3: 10, maxDensity: 40 }, count: 500, abwG: 200 }], rules)
    expect(r.fish.level).toBe('over')
    expect(r.kgPer).toBe(10)
  })
})
