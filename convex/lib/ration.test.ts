import { describe, expect, it } from 'vitest'
import { DEFAULT_FEED_TABLES, liveCount, rationFor, rationReasons, recommendRation, temperatureFactor } from './ration'

const tilapia = DEFAULT_FEED_TABLES.nile_tilapia.bands
const catfish = DEFAULT_FEED_TABLES.african_catfish.bands

describe('recommendRation', () => {
  it('ABW 180 g, 9,420 fish, 28 °C → 2.5% BW → 42.4 kg/day in 3 meals', () => {
    const r = recommendRation({ count: 9420, abwG: 180, bands: tilapia, speciesKey: 'nile_tilapia', tempC: 28 })
    expect(r).toMatchObject({ ok: true, biomassKg: 1695.6, bodyWeightPct: 2.5, tablePct: 2.5, tempFactor: 1, kgPerDay: 42.4, feedingsPerDay: 3, kgPerFeeding: 14.13 })
    if (!r.ok) throw new Error()
    expect(rationReasons(r, { count: 9420, abwG: 180, abwMeasuredOn: '2026-11-02', tempSource: 'sensor' }, 'en')).toBe(
      'ABW 180 g (sampled 2026-11-02), 9,420 fish, 28 °C (sensor) → 2.5% BW → 42.4 kg/day, split in 3 meals of 14.13 kg.',
    )
  })

  it('cuts the rate in cold or very warm water', () => {
    const cold = recommendRation({ count: 9420, abwG: 180, bands: tilapia, speciesKey: 'nile_tilapia', tempC: 23 })
    expect(cold).toMatchObject({ ok: true, tablePct: 2.5, tempFactor: 0.7, bodyWeightPct: 1.75, kgPerDay: 29.7 })
    if (!cold.ok) throw new Error()
    expect(rationReasons(cold, { count: 9420, abwG: 180 }, 'en')).toContain('2.5% × 0.7 = 1.75% BW')
    expect(rationReasons(cold, { count: 9420, abwG: 180 }, 'fr')).toMatch(/9\s420 poissons/u)
    const frozen = recommendRation({ count: 1000, abwG: 100, bands: tilapia, speciesKey: 'nile_tilapia', tempC: 12 })
    expect(frozen).toMatchObject({ ok: true, kgPerDay: 0 })
    if (!frozen.ok) throw new Error()
    expect(rationReasons(frozen, { count: 1000, abwG: 100 }, 'en')).toContain('Too cold to feed')
  })

  it('without a temperature it uses the table rate as is (rationFor unchanged)', () => {
    const r = recommendRation({ count: 5000, abwG: 300, bands: catfish, speciesKey: 'african_catfish' })
    const base = rationFor({ count: 5000, abwG: 300, bands: catfish })
    expect(r).toMatchObject({ ...base, tempFactor: 1, tempC: null })
  })

  it('species have their own temperature curve', () => {
    expect(temperatureFactor('nile_tilapia', 19)).toBe(0.3)
    expect(temperatureFactor('african_catfish', 19)).toBe(0.5)
    expect(temperatureFactor('african_catfish', null)).toBe(1)
  })

  it('reports why there is no ration', () => {
    expect(recommendRation({ count: 0, abwG: 100, bands: tilapia })).toEqual({ ok: false, reason: 'no_fish' })
    expect(recommendRation({ count: 10, abwG: null, bands: tilapia })).toEqual({ ok: false, reason: 'no_abw' })
    expect(recommendRation({ count: 10, abwG: 100, bands: null })).toEqual({ ok: false, reason: 'no_plan' })
  })
})

describe('liveCount', () => {
  it('stocked + in − out − harvested − deaths − unaccounted, never negative', () => {
    expect(liveCount({ stocked: 10000, transferredIn: 500, transferredOut: 200, harvested: 300, mortality: 580, unaccounted: 0 })).toBe(9420)
    expect(liveCount({ stocked: 100, transferredIn: 0, transferredOut: 0, harvested: 90, mortality: 20, unaccounted: 0 })).toBe(0)
  })
})
