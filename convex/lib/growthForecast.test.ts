import { describe, expect, test } from 'vitest'
import {
  abwAfter,
  accuracySummary,
  bandOn,
  bandSeries,
  effectiveTemp,
  forecastError,
  forecastGrowth,
  harvestPlan,
  priorTgc,
  type ForecastInput,
} from './growthForecast'

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const TILAPIA = { key: 'nile_tilapia', targetFcr: 1.6, targetHarvestAbwG: 500, expectedDailyGrowthG: 3 }

/** Biweekly samples of a fish growing at a known TGC at a constant temperature. */
function synthetic(tgc: number, tempC: number, samples: number, w0 = 20) {
  const opened = '2026-03-01'
  const eff = effectiveTemp('nile_tilapia', tempC)
  const out = []
  for (let i = 1; i <= samples; i++) {
    out.push({ date: addDays(opened, 14 * i), abwG: abwAfter(w0, tgc, eff * 14 * i) })
  }
  return { opened, samples: out, asOf: out[out.length - 1]?.date ?? opened }
}

function input(over: Partial<ForecastInput> = {}): ForecastInput {
  const s = synthetic(1.2, 28, 8)
  return {
    asOf: s.asOf,
    openedOn: s.opened,
    initialAbwG: 20,
    samples: s.samples,
    temps: [],
    feed: [],
    count: 10_000,
    deathsLast28: 0,
    efcr: 1.5,
    species: TILAPIA,
    ...over,
  }
}

describe('fit', () => {
  test('recovers the TGC of a known synthetic curve', () => {
    for (const tgc of [0.8, 1.2, 1.8]) {
      const s = synthetic(tgc, 28, 8)
      const f = forecastGrowth(input({ samples: s.samples, asOf: s.asOf, temps: [] }))!
      expect(f.method).toBe('fitted')
      expect(f.tgc.expected).toBeGreaterThan(tgc * 0.97)
      expect(f.tgc.expected).toBeLessThan(tgc * 1.03)
    }
  })

  test('recovers it from recorded temperatures too', () => {
    const s = synthetic(1.2, 24, 6)
    const temps = Array.from({ length: 6 * 14 + 1 }, (_, i) => ({ date: addDays(s.opened, i), value: 24 }))
    const f = forecastGrowth(input({ samples: s.samples, asOf: s.asOf, temps }))!
    expect(f.temperature).toEqual({ c: 24, source: 'recorded' })
    expect(f.tgc.expected).toBeCloseTo(1.2, 1)
    // Fitted with the default 28 °C instead, the same weights imply a lower TGC.
    const wrong = forecastGrowth(input({ samples: s.samples, asOf: s.asOf, temps: [] }))!
    expect(wrong.temperature.source).toBe('default')
    expect(wrong.tgc.expected).toBeLessThan(f.tgc.expected)
  })

  test('the projection continues the curve it was fitted to', () => {
    const s = synthetic(1.2, 28, 8)
    const f = forecastGrowth(input({ samples: s.samples, asOf: s.asOf }))!
    const truth = abwAfter(20, 1.2, effectiveTemp('nile_tilapia', 28) * (14 * 8 + 30))
    expect(bandOn(f, addDays(s.asOf, 30))!.expected).toBeGreaterThan(truth * 0.97)
    expect(bandOn(f, addDays(s.asOf, 30))!.expected).toBeLessThan(truth * 1.03)
  })
})

describe('temperature', () => {
  test('colder water grows slower; too cold to feed, no growth', () => {
    const at = (c: number) => {
      const temps = Array.from({ length: 14 }, (_, i) => ({ date: addDays('2026-06-01', -i), value: c }))
      const f = forecastGrowth(input({ temps, samples: [], asOf: '2026-06-01', openedOn: '2026-05-01', initialAbwG: 100 }))!
      return bandOn(f, '2026-07-01')!.expected
    }
    expect(at(28)).toBeGreaterThan(at(24))
    expect(at(24)).toBeGreaterThan(at(20))
    // Below 15 °C tilapia stop eating: the weight stays where it was.
    expect(at(12)).toBe(100)
  })
})

describe('feed cap', () => {
  test('growth cannot outrun the feed given', () => {
    const base = input()
    const free = forecastGrowth(base)!
    const startBiomass = (base.count * free.start.abwG) / 1000
    // Fed 0.5 % of body weight a day at FCR 1.5: at most 0.33 %/day.
    const feed = Array.from({ length: 14 }, (_, i) => ({ date: addDays(base.asOf, -i), value: startBiomass * 0.005 }))
    const capped = forecastGrowth({ ...base, feed })!
    expect(capped.feed.ratePctBw).toBeCloseTo(0.5, 2)
    expect(capped.feed.fcrSource).toBe('cycle')
    expect(capped.feed.limited).toBe(true)
    const in30 = addDays(base.asOf, 30)
    expect(bandOn(capped, in30)!.expected).toBeLessThan(bandOn(free, in30)!.expected)
    expect(bandOn(capped, in30)!.expected).toBeCloseTo(free.start.abwG * (1 + 0.005 / 1.5) ** 30, 0)
    // Generous feeding does not bind.
    const lots = feed.map((f) => ({ ...f, value: f.value * 10 }))
    expect(forecastGrowth({ ...base, feed: lots })!.feed.limited).toBe(false)
  })

  test('an implausible eFCR falls back to the species target', () => {
    const f = forecastGrowth(input({ efcr: 9 }))!
    expect(f.feed).toMatchObject({ fcr: 1.6, fcrSource: 'species' })
  })
})

describe('band', () => {
  test('low ≤ expected ≤ high on every day, with and without a feed cap', () => {
    const base = input()
    const feed = Array.from({ length: 14 }, (_, i) => ({ date: addDays(base.asOf, -i), value: 20 }))
    for (const f of [forecastGrowth(base)!, forecastGrowth({ ...base, feed })!]) {
      for (let i = 0; i < f.daily.expected.length; i++) {
        expect(f.daily.low[i]).toBeLessThanOrEqual(f.daily.expected[i])
        expect(f.daily.expected[i]).toBeLessThanOrEqual(f.daily.high[i])
      }
      expect(f.tgc.low).toBeLessThan(f.tgc.expected)
      expect(f.tgc.high).toBeGreaterThan(f.tgc.expected)
    }
  })

  test('noisy samples widen the band; more samples narrow it', () => {
    const s = synthetic(1.2, 28, 8)
    const noisy = s.samples.map((x, i) => ({ ...x, abwG: x.abwG * (i % 2 ? 1.12 : 0.9) }))
    const clean = forecastGrowth(input())!
    const rough = forecastGrowth(input({ samples: noisy }))!
    const width = (f: typeof clean) => f.tgc.high - f.tgc.low
    expect(width(rough)).toBeGreaterThan(width(clean))
    const few = forecastGrowth(input({ samples: s.samples.slice(0, 1), asOf: s.samples[0].date }))!
    expect(width(few) / few.tgc.expected).toBeGreaterThan(width(clean) / clean.tgc.expected)
  })
})

describe('sparse data', () => {
  test('no samples: the species curve from the stocking weight, said so', () => {
    const f = forecastGrowth(input({ samples: [], asOf: '2026-03-20' }))!
    expect(f.method).toBe('species_curve')
    expect(f.fewSamples).toBe(true)
    expect(f.tgc.expected).toBeCloseTo(priorTgc(TILAPIA), 3)
    expect(f.start).toEqual({ date: '2026-03-01', abwG: 20, measured: false })
  })

  test('one sample: fitted but flagged as few samples', () => {
    const s = synthetic(1.2, 28, 1)
    const f = forecastGrowth(input({ samples: s.samples, asOf: s.asOf }))!
    expect(f.method).toBe('fitted')
    expect(f.fewSamples).toBe(true)
  })

  test('nothing to start from: no forecast', () => {
    expect(forecastGrowth(input({ samples: [], initialAbwG: null }))).toBeNull()
  })

  test('samples after asOf or before stocking are ignored (back-testing)', () => {
    const s = synthetic(1.2, 28, 8)
    const madeOn = s.samples[3].date
    const f = forecastGrowth(input({ asOf: madeOn, samples: [...s.samples, { date: '2026-01-01', abwG: 900 }] }))!
    expect(f.start.date).toBe(madeOn)
    expect(f.points).toBe(5)
  })

  test('species prior from growth targets, else the group default', () => {
    expect(priorTgc(null)).toBe(1.0)
    expect(priorTgc({ key: 'african_catfish' })).toBe(1.6)
    expect(priorTgc(TILAPIA)).toBeGreaterThan(0.5)
    expect(priorTgc({ ...TILAPIA, expectedDailyGrowthG: 6 })).toBeGreaterThan(priorTgc(TILAPIA))
  })
})

describe('harvest plan', () => {
  test('date range to the target, earliest on the high line', () => {
    const f = forecastGrowth(input({ deathsLast28: 280 }))!
    const plan = harvestPlan(f, input().asOf, 400)
    expect(plan.ready).toBe(false)
    expect(plan.earliest! <= plan.expected!).toBe(true)
    expect(plan.expected! <= plan.latest!).toBe(true)
    expect(bandOn(f, plan.expected!)!.expected).toBeGreaterThanOrEqual(399.9)
    // Deaths continue at the 28-day trend.
    expect(plan.expectedCount!).toBeLessThan(10_000)
    expect(plan.expectedBiomassKg!).toBeGreaterThanOrEqual(Math.round((plan.expectedCount! * 400) / 1000))
    expect(plan.biomassLowKg!).toBeLessThanOrEqual(plan.biomassHighKg!)
  })

  test('already there, and out of reach', () => {
    const f = forecastGrowth(input())!
    const now = input().asOf
    expect(harvestPlan(f, now, 10)).toMatchObject({ ready: true, expected: now, earliest: now })
    const far = harvestPlan(f, now, 50_000)
    expect(far).toMatchObject({ expected: null, latest: null, expectedBiomassKg: null })
  })

  test('weekly series starts at the start point', () => {
    const f = forecastGrowth(input())!
    const pts = bandSeries(f, f.start.date, 4)
    expect(pts).toHaveLength(5)
    expect(pts[0].expected).toBeCloseTo(f.start.abwG, 0)
  })
})

describe('forecast error', () => {
  test('signed and absolute error, band hit, summary', () => {
    const p = { date: '2026-10-01', low: 380, expected: 420, high: 460 }
    expect(forecastError(p, 400)).toEqual({ errorPct: 5, absErrorPct: 5, withinBand: true })
    expect(forecastError(p, 500)).toEqual({ errorPct: -16, absErrorPct: 16, withinBand: false })
    expect(forecastError(p, 0)).toBeNull()
    expect(accuracySummary([])).toEqual({ n: 0, mapePct: null, biasPct: null, withinBandPct: null })
    expect(
      accuracySummary([
        { errorPct: 5, withinBand: true },
        { errorPct: -16, withinBand: false },
      ]),
    ).toEqual({ n: 2, mapePct: 10.5, biasPct: -5.5, withinBandPct: 50 })
  })
})
