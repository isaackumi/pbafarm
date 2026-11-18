import { describe, expect, test } from 'vitest'
import {
  abwAsOf,
  biologicalFcr,
  cumulativeMortalityPct,
  dailyMortalityPct,
  daysBetween,
  efcr,
  eggsPerKgFemale,
  fertilizationPct,
  flowsOf,
  fryPerKgFemale,
  hatchRatePct,
  nurserySurvivalPct,
  gainKg,
  periodGrowthPerDay,
  periodHarvestFcr,
  periodMortalityPct,
  pooledFcr,
  sampleGrowthPerDay,
  survivalPct,
  type LedgerEvent,
} from './kpi'

const ev = (p: Partial<LedgerEvent> & Pick<LedgerEvent, 'type' | 'qtyDelta' | 'eventDate'>): LedgerEvent => ({
  biomassKgDelta: 0,
  intraDayOrder: 0,
  recordedAt: 0,
  ...p,
})

describe('kpi definitions (doc 05 §6)', () => {
  test('survival and mortality exclude harvested and moved fish and include fish moved in', () => {
    const f = { count: 6000, harvestedCount: 2000, outCount: 1000, stockedCount: 10000, inCount: 0, mortalityCount: 1000 }
    expect(survivalPct(f)).toBe(90)
    expect(cumulativeMortalityPct(f)).toBe(10)
    // A top-up of 2,000 is in the base: survival cannot exceed 100 % because of it (C14).
    expect(survivalPct({ ...f, count: 8000, inCount: 2000 })).toBeCloseTo(91.67, 2)
    expect(survivalPct({ ...f, stockedCount: 0 })).toBeNull()
  })

  test('daily and period mortality use the population at risk', () => {
    expect(dailyMortalityPct(50, 1500)).toBeCloseTo(3.33, 2)
    expect(dailyMortalityPct(5, 0)).toBeNull()
    expect(periodMortalityPct(100, 900)).toBe(10)
  })

  test('FCR: economic, biological and pooled (weighted, not a mean of ratios)', () => {
    expect(efcr(1500, 1255)).toBeCloseTo(1.195, 3)
    expect(efcr(100, 0)).toBeNull()
    expect(biologicalFcr(1500, 1200, 300)).toBe(1)
    // 100 kg partial at FCR 3 and 10 t at FCR 1.5: pooled ≈ 1.51, not the mean 2.25.
    expect(pooledFcr([{ feedKg: 300, gainKg: 100 }, { feedKg: 15000, gainKg: 10000 }])).toBeCloseTo(1.515, 3)
  })

  test('gain credits harvested and transferred-out biomass and debits what came in', () => {
    expect(gainKg({ standingKg: 1005, harvestedKg: 0, outKg: 450, stockedKg: 200, inKg: 0 })).toBe(1255)
  })

  test('one DOC convention', () => {
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59)
    expect(daysBetween('2026-03-01', '2026-01-01')).toBe(0)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
  })

  test('growth per day uses one occupancy’s first and last samples', () => {
    expect(sampleGrowthPerDay([{ date: '2026-01-01', abwG: 20 }, { date: '2026-01-11', abwG: 40 }])).toBe(2)
    expect(sampleGrowthPerDay([{ date: '2026-01-01', abwG: 20 }])).toBeNull()
  })

  test('period FCR: latest stored inputs per occupancy, typed FCRs weighted by kg', () => {
    expect(
      periodHarvestFcr([
        // Two harvests of one occupancy: only the later (cumulative) inputs count.
        { cageId: 'c1', batchId: 'b1', harvestDate: '2026-06-01', totalWeight: 700, fcrInputs: { feedKg: 500, gainKg: 400 } },
        { cageId: 'c1', batchId: 'b1', harvestDate: '2026-07-15', totalWeight: 1720, fcrInputs: { feedKg: 3000, gainKg: 2000 } },
        // An older harvest with a typed FCR of 2 on 100 kg.
        { cageId: 'c2', harvestDate: '2026-05-01', totalWeight: 100, fcr: 2 },
        // FCR 0 is ignored, not averaged in.
        { cageId: 'c3', harvestDate: '2026-05-01', totalWeight: 50, fcr: 0 },
      ]),
    ).toBeCloseTo(3200 / 2100, 5)
  })

  test('period growth never joins samples of different cages or batches', () => {
    expect(
      periodGrowthPerDay([
        { cageId: 'c1', batchId: 'b1', date: '2026-01-01', abwG: 20 },
        { cageId: 'c1', batchId: 'b1', date: '2026-01-11', abwG: 40 },
        // Restocked: the new batch's small fish are not a negative slope.
        { cageId: 'c1', batchId: 'b2', date: '2026-01-21', abwG: 5 },
        { cageId: 'c1', batchId: 'b2', date: '2026-01-31', abwG: 15 },
        { cageId: 'c2', date: '2026-01-01', abwG: 500 },
      ]),
    ).toBe(1.5)
  })

  test('a reversal subtracts from the bucket of the event it reverses', () => {
    const events = [
      ev({ type: 'stock_in', qtyDelta: 1000, biomassKgDelta: 20, abwG: 20, eventDate: '2026-01-01' }),
      ev({ type: 'mortality', qtyDelta: -50, eventDate: '2026-01-05', intraDayOrder: 2 }),
      ev({ type: 'reversal', reversedType: 'mortality', qtyDelta: 50, eventDate: '2026-01-05', intraDayOrder: 2, recordedAt: 1 }),
      ev({ type: 'merge', qtyDelta: 200, biomassKgDelta: 10, abwG: 50, eventDate: '2026-01-10' }),
      ev({ type: 'reversal', reversedType: 'merge', qtyDelta: -200, biomassKgDelta: -10, eventDate: '2026-01-10', recordedAt: 1 }),
    ]
    const f = flowsOf(events)
    expect(f).toMatchObject({ count: 1000, mortalityCount: 0, inCount: 0, inKg: 0, stockedCount: 1000 })
  })

  test('ABW comes from this occupancy: samples, else count-weighted inflows', () => {
    const events = [
      ev({ type: 'stock_in', qtyDelta: 2450, abwG: 260, eventDate: '2026-04-15' }),
      ev({ type: 'merge', qtyDelta: 4000, abwG: 220, eventDate: '2026-05-01' }),
    ]
    expect(abwAsOf(events, [], '2026-04-30').abwG).toBe(260)
    const blended = abwAsOf(events, [{ date: '2026-04-28', abwG: 300 }], '2026-05-01')
    expect(blended.abwG).toBeCloseTo(250.39, 2)
    expect(blended.measured).toBe(false)
    expect(abwAsOf(events, [{ date: '2026-05-10', abwG: 280 }], '2026-05-20')).toMatchObject({ abwG: 280, measured: true })
  })
})

describe('hatchery KPIs (HAT-002, NUR-001)', () => {
  test('fertilization, hatch rate and fry per kg female', () => {
    expect(fertilizationPct(800, 1000)).toBe(80)
    expect(fertilizationPct(5, 0)).toBeNull()
    expect(hatchRatePct(40_000, 50_000)).toBe(80)
    expect(hatchRatePct(null, 50_000)).toBeNull()
    expect(fryPerKgFemale(40_000, 2)).toBe(20_000)
    expect(eggsPerKgFemale(60_000, 0)).toBeNull()
  })

  test('nursery survival counts survival-count adjustments as losses, not fish graded out', () => {
    const f = flowsOf([
      ev({ type: 'stock_in', qtyDelta: 10_000, eventDate: '2026-10-01' }),
      ev({ type: 'count_adjustment', qtyDelta: -2_000, eventDate: '2026-10-05' }),
      ev({ type: 'grading_split', qtyDelta: -3_000, eventDate: '2026-10-20' }),
    ])
    expect(nurserySurvivalPct(f)).toBe(80)
  })
})
