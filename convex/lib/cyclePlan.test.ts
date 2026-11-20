import { describe, expect, test } from 'vitest'
import { compareNote, cycleTgc, defaultAssumptions, planCycle, planProblems, tempOn, type PlanAssumptions, type PlanInputs } from './cyclePlan'
import { DEFAULT_SPECIES } from './species'

/**
 * Artboard 50 ("Cycle planner — What if"): Row A, 6 cages × 20,000 at 5 g,
 * stocked 2 Mar 2026, 86 % survival, FCR 1.42, harvest at 400 g, feed
 * GH₵375 per 25 kg bag, sold at GH₵38/kg. The artboard does not show the
 * fingerling price; GH₵0.60 a fish reproduces its cash and margin. The
 * growth curve is a TGC of 1.112 at 28 °C (the "last 3 cycles" figure),
 * which reaches 400 g on day 182.
 */
const planA: PlanInputs = {
  stockOn: '2026-03-02',
  units: 6,
  fishPerUnit: 20_000,
  stockAbwG: 5,
  harvestAbwG: 400,
  feedPricePerBag: 375,
  bagKg: 25,
  salePricePerKg: 38,
  fingerlingPrice: 0.6,
}
const history: PlanAssumptions = { speciesKey: 'nile_tilapia', survivalPct: 86, fcr: 1.42, tgc: 1.112, tempC: 28, monthlyTempC: null }

describe('planCycle (artboard 50)', () => {
  const r = planCycle(planA, history)

  test('harvest headline: 31 August 2026, day 182, 103,200 fish, 41.3 t', () => {
    expect(r).toMatchObject({ reached: true, days: 182, harvestDate: '2026-08-31', fish: 103_200, stockedFish: 120_000 })
    expect(r.harvestKg / 1000).toBeCloseTo(41.3, 1)
  })

  test('money strip: 57.8 t feed, GH₵939k cash, GH₵1.57m sales, GH₵630k margin (40 %)', () => {
    expect(r.feedKg / 1000).toBeCloseTo(57.8, 1)
    // 57,765.6 kg ÷ 25 kg = 2,310.6, so 2,311 bags; the artboard rounds to 2,312.
    expect(r.bags).toBe(2311)
    expect(Math.round(r.feedCost / 1000)).toBe(867)
    expect(Math.round(r.cashNeeded / 1000)).toBe(939)
    expect(r.sales / 1e6).toBeCloseTo(1.57, 2)
    expect(Math.round(r.margin / 1000)).toBe(630)
    expect(Math.round(r.marginPct!)).toBe(40)
    expect(r.cashLowOn).toBe('2026-08-30')
  })

  test('months: March to August, feed adds up, harvest in August, weight rises to 400 g', () => {
    expect(r.months.map((m) => m.month)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'])
    expect(r.months.reduce((s, m) => s + m.feedKg, 0)).toBeCloseTo(r.feedKg, 0)
    expect(r.months[r.months.length - 1]).toMatchObject({ harvest: true, fish: 103_200 })
    expect(r.months[r.months.length - 1]!.abwG).toBeGreaterThanOrEqual(400)
    for (let i = 1; i < r.months.length; i++) expect(r.months[i].abwG).toBeGreaterThan(r.months[i - 1].abwG)
    // Bigger fish eat more: the last full month carries several times the first.
    expect(r.months[4].feedKg).toBeGreaterThan(5 * r.months[0].feedKg)
    expect(r.months.reduce((s, m) => s + m.cashOut, 0)).toBeCloseTo(r.cashNeeded, -1)
    expect(r.curve[0]).toEqual({ date: '2026-03-02', abwG: 5 })
    expect(r.curve[r.curve.length - 1]!.date).toBe('2026-08-31')
  })

  test('plans B and C of the compare table', () => {
    const b = planCycle({ ...planA, stockOn: '2026-04-06', fishPerUnit: 16_000 }, history)
    expect(b.harvestDate).toBe('2026-10-05')
    expect(b.harvestKg / 1000).toBeCloseTo(33.0, 1)
    expect(Math.round(b.cashNeeded / 1000)).toBe(751) // artboard 750k
    expect(Math.round(b.margin / 1000)).toBe(504)
    const c = planCycle({ ...planA, harvestAbwG: 300 }, history)
    expect(c.harvestKg / 1000).toBeCloseTo(31.0, 1)
    expect(Math.round(c.cashNeeded / 1000)).toBe(719)
    expect(Math.round(c.margin / 1000)).toBe(458) // artboard 459k
    // The same growth curve reaches 300 g on 10 Aug; the artboard says 20 Jul.
    expect(c.harvestDate).toBe('2026-08-10')
  })

  test('a cold month slows growth; no growth means no harvest date within two years', () => {
    const monthlyTempC = [28, 28, 28, 28, 28, 22, 22, 22, 28, 28, 28, 28]
    expect(tempOn({ tempC: 28, monthlyTempC }, '2026-07-15')).toBe(22)
    expect(tempOn({ tempC: 27, monthlyTempC: null }, '2026-07-15')).toBe(27)
    expect(planCycle(planA, { ...history, monthlyTempC }).days).toBeGreaterThan(182)
    const stuck = planCycle(planA, { ...history, tempC: 10 })
    expect(stuck.reached).toBe(false)
    expect(stuck.days).toBe(730)
  })
})

describe('assumptions', () => {
  test('species defaults when there is no history', () => {
    const tilapia = DEFAULT_SPECIES.find((s) => s.key === 'nile_tilapia')!
    const d = defaultAssumptions({ key: 'nile_tilapia', targetFcr: tilapia.targetFcr, targetHarvestAbwG: tilapia.targetHarvestAbwG, expectedDailyGrowthG: tilapia.expectedDailyGrowthG })
    expect(d).toMatchObject({ speciesKey: 'nile_tilapia', survivalPct: 85, fcr: 1.6, tempC: 28, monthlyTempC: null })
    expect(d.tgc).toBeGreaterThan(0)
    expect(defaultAssumptions(null)).toMatchObject({ speciesKey: null, fcr: 1.6, tempC: 28 })
    expect(defaultAssumptions({ key: 'african_catfish' }).tempC).toBe(27)
    expect(planProblems(planA, d)).toEqual([])
  })

  test('a closed cycle\'s TGC round-trips through the planner', () => {
    const tgc = cycleTgc({ openedOn: '2026-03-02', days: 182, startAbwG: 5, endAbwG: 400 }, history)!
    expect(tgc).toBeCloseTo(1.11, 2)
    expect(cycleTgc({ openedOn: '2026-03-02', days: 0, startAbwG: 5, endAbwG: 400 }, history)).toBeNull()
    expect(cycleTgc({ openedOn: '2026-03-02', days: 100, startAbwG: 400, endAbwG: 5 }, history)).toBeNull()
  })

  test('planProblems names each bad field', () => {
    expect(planProblems({ ...planA, harvestAbwG: 4, units: 0, stockOn: '2026-02-30x' }, { ...history, fcr: 9, survivalPct: 0 })).toEqual([
      'stockOn',
      'units',
      'harvestAbwG',
      'survivalPct',
      'fcr',
    ])
  })
})

describe('compareNote', () => {
  const a = { name: 'A', result: planCycle(planA, history) }
  const c = { name: 'C', result: planCycle({ ...planA, harvestAbwG: 300 }, history) }

  test('the soonest sale against the best margin', () => {
    expect(compareNote([a, c])).toMatchObject({ kind: 'tradeoff', fast: 'C', best: 'A', weeks: 3 })
    const note = compareNote([a, c])
    if (note?.kind !== 'tradeoff') throw new Error('expected a trade-off')
    expect(note.marginGap).toBe(a.result.margin - c.result.margin)
    expect(['A', 'C']).toContain(note.perMonthLeader)
  })

  test('one plan, or one plan that wins on both, gives a short note or none', () => {
    expect(compareNote([a])).toBeNull()
    const cheap = { name: 'D', result: planCycle({ ...planA, harvestAbwG: 300, salePricePerKg: 60 }, history) }
    expect(compareNote([a, cheap])).toEqual({ kind: 'same', name: 'D' })
  })
})
